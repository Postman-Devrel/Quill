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

function adfParagraph(...children: AdfNode[]): AdfNode {
  return { type: 'paragraph', content: children };
}

function adfDoc(...paragraphs: AdfNode[]): AdfNode {
  return { type: 'doc', version: 1, content: paragraphs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create issue
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateHeaderRequestParams {
  blogTitle: string;
  confluenceUrl: string;
  author?: string;
  projectKey?: string;
  issueType?: string;
  assigneeAccountId?: string;
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
}

export async function createHeaderRequestIssue(
  params: CreateHeaderRequestParams,
): Promise<CreatedJiraIssue> {
  const { baseUrl, identity } = getJiraConfig();
  const projectKey =
    params.projectKey ?? process.env.JIRA_PROJECT_KEY ?? 'MKTG';
  const issueType =
    params.issueType ?? process.env.JIRA_HEADER_ISSUE_TYPE ?? 'Task';
  const assigneeAccountId =
    params.assigneeAccountId ?? process.env.JIRA_HEADER_ASSIGNEE_ACCOUNT_ID;
  const labels = params.labels ?? ['blog', 'quill', 'header-image'];
  const marketingTeam =
    params.marketingTeam ?? process.env.JIRA_MARKETING_TEAM ?? 'Creative';

  const summary = `Header image request for blog: ${params.blogTitle}`;

  const authorParagraph = params.author
    ? adfParagraph(adfBold('Author: '), adfText(params.author))
    : adfParagraph(adfBold('Author: '), adfText('Unknown'));

  const description = adfDoc(
    adfParagraph(
      adfText('Header image request for blog: '),
      adfBold(params.blogTitle),
    ),
    authorParagraph,
    adfParagraph(
      adfText('Confluence draft: '),
      adfLink(params.confluenceUrl, params.confluenceUrl),
    ),
    adfParagraph(
      adfBold('Please note: '),
      adfText('This is a feature request. Please attach the final header image to this ticket when ready.'),
    ),
    adfParagraph(
      adfText('This ticket was created automatically by Quill 🪶.'),
    ),
  );

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
  if (assigneeAccountId) {
    fields.assignee = { accountId: assigneeAccountId };
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
  return {
    key: created.key,
    id: created.id,
    ticketUrl: `${baseUrl}/browse/${created.key}`,
    summary,
    projectKey,
    issueType,
    identity,
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
