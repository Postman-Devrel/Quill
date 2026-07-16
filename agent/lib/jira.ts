// Minimal Jira Cloud REST v3 client for Quill.
//
// Reuses the same service-account credentials as Confluence (CONFLUENCE_EMAIL
// + CONFLUENCE_API_TOKEN) — an Atlassian API token authorizes across all
// products the underlying user has access to, so one bot user with both
// Confluence *and* Jira product access covers everything.
//
// Base URL is derived from CONFLUENCE_BASE_URL by stripping the trailing
// "/wiki". Override with JIRA_BASE_URL if your instance is unusual.

interface JiraConfig {
  baseUrl: string;
  authHeader: string;
  identity: string;
}

function getJiraConfig(): JiraConfig {
  const email = process.env.CONFLUENCE_EMAIL;
  const token = process.env.CONFLUENCE_API_TOKEN;
  if (!email || !token) {
    throw new Error(
      'Jira reuses Confluence credentials — CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN must be set. Ensure the Atlassian API token has Jira product access.',
    );
  }
  let baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    const confluenceBase = process.env.CONFLUENCE_BASE_URL ?? 'https://postmanlabs.atlassian.net/wiki';
    baseUrl = confluenceBase.replace(/\/wiki\/?$/, '').replace(/\/+$/, '');
  } else {
    baseUrl = baseUrl.replace(/\/+$/, '');
  }
  return {
    baseUrl,
    authHeader: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'),
    identity: email,
  };
}

async function jiraFetch(
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {},
): Promise<Response> {
  const { baseUrl, authHeader } = getJiraConfig();
  const headers: Record<string, string> = {
    Authorization: authHeader,
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  let body = init.body;
  if (init.jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.jsonBody);
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers, body });
}

// ─────────────────────────────────────────────────────────────────────────────
// ADF (Atlassian Document Format) helpers — Jira v3 expects descriptions in
// this JSON shape, not plain text or markdown.
// ─────────────────────────────────────────────────────────────────────────────

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

function adfText(text: string): AdfNode {
  return { type: 'text', text };
}

function adfLink(text: string, href: string): AdfNode {
  return { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] };
}

function adfBold(text: string): AdfNode {
  return { type: 'text', text, marks: [{ type: 'strong' }] };
}

function adfMention(accountId: string, displayName: string): AdfNode {
  // A mention node both renders as a clickable @name and triggers a Jira
  // notification to that user when the issue is created.
  return { type: 'mention', attrs: { id: accountId, text: `@${displayName}` } };
}

function adfParagraph(...children: AdfNode[]): AdfNode {
  return { type: 'paragraph', content: children };
}

function adfDoc(...paragraphs: AdfNode[]): AdfNode {
  return { type: 'doc', version: 1, content: paragraphs };
}

// ─────────────────────────────────────────────────────────────────────────────
// User lookup + watchers — used to tag the requester so they follow progress.
// ─────────────────────────────────────────────────────────────────────────────

export interface JiraUser {
  accountId: string;
  displayName: string;
}

// Resolve a person to their Jira accountId by email (preferred) or name.
// Returns null if nothing matches or the service account lacks "Browse users"
// permission — callers must treat tagging as best-effort, never fatal.
export async function findJiraAccountId(query: string): Promise<JiraUser | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const resp = await jiraFetch(`/rest/api/3/user/search?query=${encodeURIComponent(q)}`);
    if (!resp.ok) {
      console.log(`[jira] user search for ${JSON.stringify(q)} failed: HTTP ${resp.status}`);
      return null;
    }
    const users = (await resp.json()) as Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
      accountType?: string;
    }>;
    const humans = users.filter((u) => u.accountType !== 'app');
    if (humans.length === 0) return null;
    // If the query looks like an email, prefer an exact (case-insensitive) match.
    const lower = q.toLowerCase();
    const exact = q.includes('@')
      ? humans.find((u) => u.emailAddress?.toLowerCase() === lower)
      : undefined;
    const chosen = exact ?? humans[0];
    return { accountId: chosen.accountId, displayName: chosen.displayName };
  } catch (e) {
    console.log(`[jira] user search error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// Add a user as a watcher so they get notified of every change to the issue.
// POST body is the bare accountId string. Returns true on success (204).
async function addWatcher(issueKey: string, accountId: string): Promise<boolean> {
  try {
    const resp = await jiraFetch(`/rest/api/3/issue/${issueKey}/watchers`, {
      method: 'POST',
      jsonBody: accountId,
    });
    if (!resp.ok) {
      console.log(`[jira] add watcher to ${issueKey} failed: HTTP ${resp.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.log(`[jira] add watcher error: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create issue
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateHeaderRequestParams {
  blogTitle: string;
  confluenceUrl: string;
  author?: string;
  // Who asked for the ticket. They get @mentioned in the description and added
  // as a watcher so they can follow progress. Email is the most reliable key;
  // name is a fallback. If neither is given, the author name is used.
  requesterEmail?: string;
  requesterName?: string;
  projectKey?: string;
  issueType?: string;
  // Who the ticket is assigned to. Resolution order: explicit accountId, then
  // email, then name. Email is the most reliable key. If none resolve, the
  // ticket is left unassigned for the team to triage.
  assigneeAccountId?: string;
  assigneeEmail?: string;
  assigneeName?: string;
  labels?: string[];
  marketingTeam?: string;
  dueDate?: string;
}

export interface CreatedJiraIssue {
  key: string;
  id: string;
  ticketUrl: string;
  summary: string;
  projectKey: string;
  issueType: string;
  identity: string;
  // Set when a requester was resolved and added as a watcher / mentioned.
  requesterTagged: boolean;
  requesterDisplayName?: string;
  // Set when an assignee was resolved and applied to the ticket.
  assigneeSet: boolean;
  assigneeDisplayName?: string;
}

export async function createHeaderRequestIssue(
  params: CreateHeaderRequestParams,
): Promise<CreatedJiraIssue> {
  const { baseUrl, identity } = getJiraConfig();
  const projectKey =
    params.projectKey ?? process.env.JIRA_PROJECT_KEY ?? 'MKTG';
  const issueType =
    params.issueType ?? process.env.JIRA_HEADER_ISSUE_TYPE ?? 'Task';
  const labels = params.labels ?? ['blog', 'quill', 'header-image'];
  const marketingTeam =
    params.marketingTeam ?? process.env.JIRA_MARKETING_TEAM ?? 'Creative';

  const summary = `Header image request for blog: ${params.blogTitle}`;

  const authorParagraph = params.author
    ? adfParagraph(adfBold('Author: '), adfText(params.author))
    : adfParagraph(adfBold('Author: '), adfText('Unknown'));

  // Resolve the requester so we can tag them. Prefer email, then an explicit
  // name, then fall back to the author (the common self-authored case).
  const requesterQuery = params.requesterEmail ?? params.requesterName ?? params.author;
  const requester = requesterQuery ? await findJiraAccountId(requesterQuery) : null;

  // "Requested by" line: a real @mention when resolved (fires a notification),
  // otherwise plain text so the name is still recorded.
  const requesterFallbackName = params.requesterName ?? params.requesterEmail ?? params.author;
  const requesterParagraph = requester
    ? adfParagraph(adfBold('Requested by: '), adfMention(requester.accountId, requester.displayName))
    : requesterFallbackName
      ? adfParagraph(adfBold('Requested by: '), adfText(requesterFallbackName))
      : null;

  const descParagraphs: AdfNode[] = [
    adfParagraph(adfText('Header image request for blog: '), adfBold(params.blogTitle)),
    authorParagraph,
  ];
  if (requesterParagraph) descParagraphs.push(requesterParagraph);

  // Resolve the assignee. An explicit accountId (param or env default) wins;
  // otherwise resolve an email or name via user search. Left unassigned if
  // nothing resolves, so the team can triage.
  const explicitAccountId =
    params.assigneeAccountId ?? process.env.JIRA_HEADER_ASSIGNEE_ACCOUNT_ID;
  const assigneeQuery = params.assigneeEmail ?? params.assigneeName;
  const resolvedAssignee = explicitAccountId
    ? { accountId: explicitAccountId, displayName: undefined as string | undefined }
    : assigneeQuery
      ? await findJiraAccountId(assigneeQuery)
      : null;

  descParagraphs.push(
    adfParagraph(adfText('Confluence draft: '), adfLink(params.confluenceUrl, params.confluenceUrl)),
    adfParagraph(
      adfBold('Please note: '),
      adfText('This is a feature request. Please attach the final header image to this ticket when ready.'),
    ),
    adfParagraph(adfText('This ticket was created automatically by Quill 🪶.')),
  );
  const description = adfDoc(...descParagraphs);

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary,
    description,
    issuetype: { name: issueType },
    labels,
    // customfield_13620 = "Marketing Team" — required by the MKTG project.
    // Set via JIRA_MARKETING_TEAM env var or the marketingTeam param; defaults
    // to "Creative" (the team that owns blog header design).
    customfield_13620: { value: marketingTeam },
  };
  if (resolvedAssignee) {
    fields.assignee = { accountId: resolvedAssignee.accountId };
  }
  if (params.dueDate) {
    fields.duedate = params.dueDate;
  }

  const resp = await jiraFetch('/rest/api/3/issue', {
    method: 'POST',
    jsonBody: { fields },
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Jira create issue failed: HTTP ${resp.status} — ${err.slice(0, 500)}`);
  }
  const created = (await resp.json()) as { id: string; key: string; self: string };

  // Add the requester as a watcher so they're notified of every update. Done
  // after creation because the watchers endpoint needs the issue key. The
  // @mention above already fired the first notification; the watcher keeps them
  // in the loop for the rest of the ticket's life. Best-effort — never fails
  // the create.
  let requesterTagged = false;
  if (requester) {
    requesterTagged = await addWatcher(created.key, requester.accountId);
  }

  return {
    key: created.key,
    id: created.id,
    ticketUrl: `${baseUrl}/browse/${created.key}`,
    summary,
    projectKey,
    issueType,
    identity,
    requesterTagged,
    requesterDisplayName: requester?.displayName,
    assigneeSet: Boolean(resolvedAssignee),
    assigneeDisplayName: resolvedAssignee?.displayName,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update issue
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateJiraIssueParams {
  issueKey: string;
  summary?: string;
  author?: string;
  confluenceUrl?: string;
  dueDate?: string;
  assigneeAccountId?: string;
  labels?: string[];
  comment?: string;
}

export interface UpdatedJiraIssue {
  key: string;
  ticketUrl: string;
  identity: string;
}

export async function updateJiraIssue(params: UpdateJiraIssueParams): Promise<UpdatedJiraIssue> {
  const { baseUrl, identity } = getJiraConfig();
  console.log(`[jira] update ${params.issueKey} as ${identity}`);

  const fields: Record<string, unknown> = {};
  if (params.summary) fields.summary = params.summary;
  if (params.dueDate) fields.duedate = params.dueDate;
  if (params.assigneeAccountId) fields.assignee = { accountId: params.assigneeAccountId };
  if (params.labels) fields.labels = params.labels;

  if (params.author !== undefined || params.confluenceUrl !== undefined) {
    const currentResp = await jiraFetch(
      `/rest/api/3/issue/${params.issueKey}?fields=summary,description`,
    );
    if (!currentResp.ok) {
      const err = await currentResp.text();
      throw new Error(`Jira fetch issue failed: HTTP ${currentResp.status} — ${err.slice(0, 500)}`);
    }
    const current = (await currentResp.json()) as {
      fields: { summary?: string; description?: unknown };
    };

    const blogTitle = params.summary ?? (current.fields.summary ?? '').replace(/^Header image request for blog:\s*/, '');
    const author = params.author ?? 'Unknown';
    const confluenceUrl = params.confluenceUrl ?? '';

    const descParagraphs: AdfNode[] = [
      adfParagraph(adfText('Header image request for blog: '), adfBold(blogTitle)),
      adfParagraph(adfBold('Author: '), adfText(author)),
    ];
    if (confluenceUrl) {
      descParagraphs.push(
        adfParagraph(adfText('Confluence draft: '), adfLink(confluenceUrl, confluenceUrl)),
      );
    }
    descParagraphs.push(
      adfParagraph(
        adfBold('Please note: '),
        adfText('This is a feature request. Please attach the final header image to this ticket when ready.'),
      ),
      adfParagraph(adfText('This ticket was created automatically by Quill 🪶.')),
    );
    fields.description = adfDoc(...descParagraphs);
  }

  if (Object.keys(fields).length > 0) {
    const putResp = await jiraFetch(`/rest/api/3/issue/${params.issueKey}`, {
      method: 'PUT',
      jsonBody: { fields },
    });
    if (!putResp.ok) {
      const err = await putResp.text();
      throw new Error(`Jira update issue failed: HTTP ${putResp.status} — ${err.slice(0, 500)}`);
    }
  }

  if (params.comment) {
    const commentResp = await jiraFetch(`/rest/api/3/issue/${params.issueKey}/comment`, {
      method: 'POST',
      jsonBody: {
        body: adfDoc(adfParagraph(adfText(params.comment))),
      },
    });
    if (!commentResp.ok) {
      const err = await commentResp.text();
      throw new Error(`Jira add comment failed: HTTP ${commentResp.status} — ${err.slice(0, 500)}`);
    }
  }

  return {
    key: params.issueKey,
    ticketUrl: `${baseUrl}/browse/${params.issueKey}`,
    identity,
  };
}
