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

// Move an issue to a target status by name (case-insensitive), matching on the
// destination status first, then the transition label. Status can't be set at
// create time, so this runs right after creation. Best-effort — returns the
// resolved status name on success, or null if no matching transition is
// available or the call fails (never throws / never fails the create).
async function transitionIssueToStatus(
  issueKey: string,
  statusName: string,
): Promise<string | null> {
  try {
    const listResp = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`);
    if (!listResp.ok) {
      console.log(`[jira] list transitions for ${issueKey} failed: HTTP ${listResp.status}`);
      return null;
    }
    const { transitions } = (await listResp.json()) as {
      transitions: Array<{ id: string; name: string; to?: { name?: string } }>;
    };
    const target = statusName.trim().toLowerCase();
    const match =
      transitions.find((t) => t.to?.name?.toLowerCase() === target) ??
      transitions.find((t) => t.name?.toLowerCase() === target);
    if (!match) {
      console.log(
        `[jira] no "${statusName}" transition for ${issueKey} (available: ${transitions.map((t) => t.to?.name ?? t.name).join(', ')})`,
      );
      return null;
    }
    const doResp = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`, {
      method: 'POST',
      jsonBody: { transition: { id: match.id } },
    });
    if (!doResp.ok) {
      console.log(`[jira] transition ${issueKey} → ${statusName} failed: HTTP ${doResp.status}`);
      return null;
    }
    return match.to?.name ?? statusName;
  } catch (e) {
    console.log(`[jira] transition error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// Public wrapper around the transition helper — move an issue to a status by
// name and return a small result. Used by the WordPress staging flow to flip
// the linked blog ticket to "In Review" when a draft is staged.
export async function moveJiraIssueToStatus(
  issueKey: string,
  statusName: string,
): Promise<{ key: string; status: string | null; moved: boolean; ticketUrl: string }> {
  const { baseUrl } = getJiraConfig();
  const resolved = await transitionIssueToStatus(issueKey, statusName);
  return {
    key: issueKey,
    status: resolved,
    moved: Boolean(resolved),
    ticketUrl: `${baseUrl}/browse/${issueKey}`,
  };
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
  // Parent epic the ticket is nested under. Defaults to MKTG-8442
  // ("Technical Content"), the DevRel epic — parenting the ticket to it makes it
  // roll up onto the DevRel board. Override via JIRA_PARENT_EPIC_KEY.
  parentKey?: string;
  // Status to move the ticket to right after creation. Defaults to "In Progress".
  // Override via JIRA_INITIAL_STATUS.
  status?: string;
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
  // The parent epic the ticket was nested under (e.g. MKTG-8442).
  parentKey: string;
  // Whether the post-create status transition succeeded, and the resulting
  // status name (e.g. "In Progress"). statusSet is false if the transition
  // wasn't available — the ticket then sits in the workflow's initial status.
  statusSet: boolean;
  status?: string;
}

export async function createHeaderRequestIssue(
  params: CreateHeaderRequestParams,
): Promise<CreatedJiraIssue> {
  const { baseUrl, identity } = getJiraConfig();
  const projectKey =
    params.projectKey ?? process.env.JIRA_PROJECT_KEY ?? 'MKTG';
  const issueType =
    params.issueType ?? process.env.JIRA_HEADER_ISSUE_TYPE ?? 'Blog content';
  const labels = params.labels ?? ['blog', 'quill'];
  const marketingTeam =
    params.marketingTeam ?? process.env.JIRA_MARKETING_TEAM ?? 'DevRel';
  const parentKey =
    params.parentKey ?? process.env.JIRA_PARENT_EPIC_KEY ?? 'MKTG-8442';
  const targetStatus =
    params.status ?? process.env.JIRA_INITIAL_STATUS ?? 'In Progress';

  // The ticket summary is just the blog title.
  const summary = params.blogTitle;

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
    adfParagraph(adfText('Blog: '), adfBold(params.blogTitle)),
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
    adfParagraph(adfText('This ticket was created automatically by Quill 🪶.')),
  );
  const description = adfDoc(...descParagraphs);

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary,
    description,
    issuetype: { name: issueType },
    labels,
    // Parent epic (MKTG-8442 "Technical Content" by default) so header requests
    // roll up onto the DevRel board.
    parent: { key: parentKey },
    // customfield_13620 = "Marketing Team" — required by the MKTG project.
    // Set via JIRA_MARKETING_TEAM env var or the marketingTeam param; defaults
    // to "DevRel" (the team that owns the blog).
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

  // Move the freshly-created ticket to its target status (default "In Progress").
  // Best-effort: a failed transition leaves the ticket in the workflow's initial
  // status but never fails the create.
  const resolvedStatus = await transitionIssueToStatus(created.key, targetStatus);

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
    parentKey,
    statusSet: Boolean(resolvedStatus),
    status: resolvedStatus ?? undefined,
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
  // Assignee resolution order: explicit accountId, then email, then name.
  assigneeAccountId?: string;
  assigneeEmail?: string;
  assigneeName?: string;
  labels?: string[];
  comment?: string;
  // Move the ticket to this status (by name, e.g. "In Review"). Best-effort.
  status?: string;
}

export interface UpdatedJiraIssue {
  key: string;
  ticketUrl: string;
  identity: string;
  // Present only when a status transition was requested.
  statusSet?: boolean;
  status?: string;
  // Present only when an assignee was requested.
  assigneeSet?: boolean;
  assigneeDisplayName?: string;
}

export async function updateJiraIssue(params: UpdateJiraIssueParams): Promise<UpdatedJiraIssue> {
  const { baseUrl, identity } = getJiraConfig();
  console.log(`[jira] update ${params.issueKey} as ${identity}`);

  const fields: Record<string, unknown> = {};
  if (params.summary) fields.summary = params.summary;
  if (params.dueDate) fields.duedate = params.dueDate;
  if (params.labels) fields.labels = params.labels;

  // Resolve the assignee: explicit accountId wins, else look up by email/name.
  const assigneeRequested = Boolean(
    params.assigneeAccountId || params.assigneeEmail || params.assigneeName,
  );
  let resolvedAssignee: JiraUser | null = null;
  if (params.assigneeAccountId) {
    fields.assignee = { accountId: params.assigneeAccountId };
    resolvedAssignee = { accountId: params.assigneeAccountId, displayName: '' };
  } else if (params.assigneeEmail || params.assigneeName) {
    resolvedAssignee = await findJiraAccountId(
      (params.assigneeEmail ?? params.assigneeName) as string,
    );
    if (resolvedAssignee) fields.assignee = { accountId: resolvedAssignee.accountId };
  }

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

    // Tolerate the legacy "Header image request for blog:" prefix on older
    // tickets when deriving the blog title from the current summary.
    const blogTitle = params.summary ?? (current.fields.summary ?? '').replace(/^Header image request for blog:\s*/, '');
    const author = params.author ?? 'Unknown';
    const confluenceUrl = params.confluenceUrl ?? '';

    const descParagraphs: AdfNode[] = [
      adfParagraph(adfText('Blog: '), adfBold(blogTitle)),
      adfParagraph(adfBold('Author: '), adfText(author)),
    ];
    if (confluenceUrl) {
      descParagraphs.push(
        adfParagraph(adfText('Confluence draft: '), adfLink(confluenceUrl, confluenceUrl)),
      );
    }
    descParagraphs.push(
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

  let resolvedStatus: string | null = null;
  if (params.status) {
    resolvedStatus = await transitionIssueToStatus(params.issueKey, params.status);
  }

  return {
    key: params.issueKey,
    ticketUrl: `${baseUrl}/browse/${params.issueKey}`,
    identity,
    ...(params.status ? { statusSet: Boolean(resolvedStatus), status: resolvedStatus ?? undefined } : {}),
    ...(assigneeRequested
      ? {
          assigneeSet: Boolean(fields.assignee),
          assigneeDisplayName: resolvedAssignee?.displayName || undefined,
        }
      : {}),
  };
}
