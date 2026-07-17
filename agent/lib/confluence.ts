import { marked } from 'marked';
import TurndownService from 'turndown';

// ─────────────────────────────────────────────────────────────────────────────
// Quill's Confluence config
//
// One shared service-account identity (e.g. quill-bot@postman.com) writes to
// one shared space. All blog drafts end up in the same place regardless of
// which team member asked Quill to save. Everyone using Quill is authorized
// via ONE token, no per-user setup.
//
// Required env vars:
//   CONFLUENCE_EMAIL       — bot email (e.g. quill@postman.com)
//   CONFLUENCE_API_TOKEN   — the bot's Atlassian API token
//   CONFLUENCE_SPACE_KEY   — the shared 'Quill Drafts' space key
//
// Optional env vars:
//   CONFLUENCE_BASE_URL    — defaults below; only override if your instance
//                            isn't on postmanlabs.atlassian.net
//   CONFLUENCE_PARENT_PAGE_ID — nest drafts under a parent page in the space
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_BASE_URL = 'https://postmanlabs.atlassian.net/wiki';

interface ConfluenceConfig {
  baseUrl: string;
  authHeader: string;
  /** Which identity is making the call — for logging. */
  identity: string;
}

function getConfluenceConfig(): ConfluenceConfig {
  const baseUrl = (process.env.CONFLUENCE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const email = process.env.CONFLUENCE_EMAIL;
  const token = process.env.CONFLUENCE_API_TOKEN;

  if (!email || !token) {
    throw new Error(
      'Confluence not configured. Set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN via `ast project configure` (locally) or `ast secrets create` (for deploy).',
    );
  }

  return {
    baseUrl,
    authHeader: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'),
    identity: email,
  };
}

async function confluenceFetch(
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {},
): Promise<Response> {
  const { baseUrl, authHeader } = getConfluenceConfig();
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
// Create a page
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateConfluencePageParams {
  title: string;
  markdown: string;
  spaceKey?: string;
  parentPageId?: string;
}

export interface ConfluencePage {
  pageId: string;
  title: string;
  pageUrl: string;
  spaceKey: string;
}

/**
 * Convert a markdown blog draft to Confluence-compatible HTML. Strips YAML
 * frontmatter from the visible body, pins it as a metadata block at the top.
 */
async function markdownToConfluenceHtml(markdown: string): Promise<string> {
  let body = markdown;
  let metaBlock = '';

  if (body.startsWith('---')) {
    const parts = body.split('---');
    if (parts.length >= 3) {
      metaBlock = `<p><em>SEO metadata:</em></p><pre>${parts[1].trim()}</pre><hr/>`;
      body = parts.slice(2).join('---').trim();
    }
  }

  const bodyHtml = await marked.parse(body, { gfm: true });
  return `${metaBlock}${bodyHtml}`;
}

/**
 * Create a new Confluence page in the configured space. Returns page ID and
 * full URL. The page is created as a child of CONFLUENCE_PARENT_PAGE_ID if set,
 * otherwise at the space root.
 */
export async function createConfluencePage(
  params: CreateConfluencePageParams,
): Promise<ConfluencePage & { identity: string }> {
  const { baseUrl, identity } = getConfluenceConfig();
  console.log(`[confluence] create as ${identity}`);
  // Postman DevRel-specific defaults — the shared "Quill Drafts" space and
  // its homepage. Env vars can still override, but users of the deployed
  // agent don't need to configure them.
  const spaceKey = params.spaceKey ?? process.env.CONFLUENCE_SPACE_KEY ?? 'Quill';
  const parentId =
    params.parentPageId ?? process.env.CONFLUENCE_PARENT_PAGE_ID ?? '8244560849';

  const html = await markdownToConfluenceHtml(params.markdown);

  const requestBody: Record<string, unknown> = {
    type: 'page',
    title: params.title,
    space: { key: spaceKey },
    body: {
      storage: {
        value: html,
        representation: 'storage',
      },
    },
  };
  if (parentId) {
    requestBody.ancestors = [{ id: parentId }];
  }

  const resp = await confluenceFetch('/rest/api/content', {
    method: 'POST',
    jsonBody: requestBody,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Confluence create failed: HTTP ${resp.status} — ${err.slice(0, 500)}`);
  }
  const page = (await resp.json()) as {
    id: string;
    title: string;
    space?: { key: string };
    _links?: { webui?: string };
  };
  const webui = page._links?.webui ?? `/spaces/${spaceKey}/pages/${page.id}`;
  return {
    pageId: page.id,
    title: page.title,
    pageUrl: `${baseUrl}${webui}`,
    spaceKey: page.space?.key ?? spaceKey,
    identity,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read a page
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_URL_RE = /\/pages\/(?:edit-v2\/)?(\d+)/;
const RAW_ID_RE = /^\d+$/;

export function extractConfluencePageId(input: string): string {
  const m = input.match(PAGE_URL_RE);
  if (m) return m[1];
  if (RAW_ID_RE.test(input.trim())) return input.trim();
  throw new Error(
    `Could not extract a Confluence page ID from "${input.slice(0, 80)}". Paste the full page URL.`,
  );
}

export interface FetchedConfluencePage {
  pageId: string;
  title: string;
  markdown: string;
  sourceUrl: string;
  spaceKey: string;
  version: number;
  charCount: number;
}

/**
 * Read a Confluence page and return its contents as markdown.
 * Fetches the page in 'storage' format (Confluence's HTML-ish format),
 * then converts to markdown with turndown.
 */
export async function readConfluencePage(idOrUrl: string): Promise<FetchedConfluencePage> {
  const pageId = extractConfluencePageId(idOrUrl);
  const { baseUrl, identity } = getConfluenceConfig();
  console.log(`[confluence] read as ${identity}`);

  const resp = await confluenceFetch(
    `/rest/api/content/${pageId}?expand=body.storage,space,version`,
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Confluence read failed: HTTP ${resp.status} — ${err.slice(0, 500)}`);
  }
  const page = (await resp.json()) as {
    id: string;
    title: string;
    space?: { key: string };
    version?: { number: number };
    body?: { storage?: { value: string } };
    _links?: { webui?: string };
  };

  const html = page.body?.storage?.value ?? '';
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  const markdown = turndown.turndown(html).trim();

  const webui = page._links?.webui ?? `/spaces/${page.space?.key ?? ''}/pages/${page.id}`;
  return {
    pageId: page.id,
    title: page.title,
    markdown,
    sourceUrl: `${baseUrl}${webui}`,
    spaceKey: page.space?.key ?? '',
    version: page.version?.number ?? 1,
    charCount: markdown.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read comments on a page (inline + footer)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfluenceComment {
  commentId: string;
  /** 'inline' = anchored to highlighted text; 'footer' = page-level. */
  type: 'inline' | 'footer';
  /** The comment text, converted to plain markdown. */
  text: string;
  /** Display name of whoever left the comment, if available. */
  author: string;
  /** For inline comments: the page text the comment is anchored to. */
  highlightedText?: string;
  /** Resolution status for inline comments: 'open' | 'resolved' | 'dangling'. */
  resolution?: string;
}

/**
 * Read all comments on a Confluence page — both inline (anchored to highlighted
 * text) and footer (page-level). Returns them oldest-first as structured markdown
 * so the agent can iterate over them one by one.
 */
export async function readConfluenceComments(idOrUrl: string): Promise<{
  pageId: string;
  comments: ConfluenceComment[];
}> {
  const pageId = extractConfluencePageId(idOrUrl);
  const { identity } = getConfluenceConfig();
  console.log(`[confluence] read comments as ${identity}`);

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  const resp = await confluenceFetch(
    `/rest/api/content/${pageId}/child/comment` +
      `?expand=body.storage,extensions.inlineProperties,extensions.resolution,history.createdBy` +
      `&depth=all&limit=100`,
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(
      `Confluence read comments failed: HTTP ${resp.status} — ${err.slice(0, 500)}`,
    );
  }
  const data = (await resp.json()) as {
    results?: Array<{
      id: string;
      body?: { storage?: { value: string } };
      history?: { createdBy?: { displayName?: string } };
      extensions?: {
        location?: string;
        inlineProperties?: { originalSelection?: string };
        resolution?: { status?: string };
      };
    }>;
  };

  const comments: ConfluenceComment[] = (data.results ?? []).map((c) => {
    const html = c.body?.storage?.value ?? '';
    const text = turndown.turndown(html).trim();
    const isInline = c.extensions?.location === 'inline';
    return {
      commentId: c.id,
      type: isInline ? 'inline' : 'footer',
      text,
      author: c.history?.createdBy?.displayName ?? 'Unknown',
      highlightedText: c.extensions?.inlineProperties?.originalSelection,
      resolution: c.extensions?.resolution?.status,
    };
  });

  return { pageId, comments };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update an existing page in place
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Overwrite an existing Confluence page with new markdown, bumping the version.
 * Confluence keeps the previous version in its page history, so the original
 * content is never lost. If `title` is omitted the current title is kept.
 */
export async function updateConfluencePage(params: {
  idOrUrl: string;
  markdown: string;
  title?: string;
}): Promise<ConfluencePage & { version: number; identity: string }> {
  const pageId = extractConfluencePageId(params.idOrUrl);
  const { baseUrl, identity } = getConfluenceConfig();
  console.log(`[confluence] update ${pageId} as ${identity}`);

  // Fetch current version + title so we can bump the version and preserve title.
  const current = await confluenceFetch(
    `/rest/api/content/${pageId}?expand=version,space`,
  );
  if (!current.ok) {
    const err = await current.text();
    throw new Error(
      `Confluence update (fetch current) failed: HTTP ${current.status} — ${err.slice(0, 500)}`,
    );
  }
  const currentPage = (await current.json()) as {
    title: string;
    space?: { key: string };
    version?: { number: number };
  };
  const nextVersion = (currentPage.version?.number ?? 1) + 1;
  const title = params.title ?? currentPage.title;

  const html = await markdownToConfluenceHtml(params.markdown);

  const resp = await confluenceFetch(`/rest/api/content/${pageId}`, {
    method: 'PUT',
    jsonBody: {
      id: pageId,
      type: 'page',
      title,
      version: { number: nextVersion },
      body: { storage: { value: html, representation: 'storage' } },
    },
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Confluence update failed: HTTP ${resp.status} — ${err.slice(0, 500)}`);
  }
  const page = (await resp.json()) as {
    id: string;
    title: string;
    space?: { key: string };
    _links?: { webui?: string };
  };
  const spaceKey = page.space?.key ?? currentPage.space?.key ?? '';
  const webui = page._links?.webui ?? `/spaces/${spaceKey}/pages/${page.id}`;
  return {
    pageId: page.id,
    title: page.title,
    pageUrl: `${baseUrl}${webui}`,
    spaceKey,
    version: nextVersion,
    identity,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reply to a comment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Post a reply to an existing Confluence comment (inline or footer). The reply
 * is nested under the parent comment so reviewers see the response in context.
 */
export async function replyToConfluenceComment(params: {
  commentId: string;
  markdown: string;
}): Promise<{ replyId: string; identity: string }> {
  const { identity } = getConfluenceConfig();
  console.log(`[confluence] reply to comment ${params.commentId} as ${identity}`);

  // Look up the parent comment's container (the page) so the reply attaches
  // to the same page and nests under the comment.
  const parent = await confluenceFetch(
    `/rest/api/content/${params.commentId}?expand=container`,
  );
  if (!parent.ok) {
    const err = await parent.text();
    throw new Error(
      `Confluence reply (fetch parent) failed: HTTP ${parent.status} — ${err.slice(0, 500)}`,
    );
  }
  const parentComment = (await parent.json()) as {
    container?: { id?: string; type?: string };
  };
  const containerId = parentComment.container?.id;
  const containerType = parentComment.container?.type ?? 'page';

  const html = await marked.parse(params.markdown, { gfm: true });

  const requestBody: Record<string, unknown> = {
    type: 'comment',
    ancestors: [{ id: params.commentId }],
    body: { storage: { value: html, representation: 'storage' } },
  };
  if (containerId) {
    requestBody.container = { id: containerId, type: containerType };
  }

  const resp = await confluenceFetch('/rest/api/content', {
    method: 'POST',
    jsonBody: requestBody,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Confluence reply failed: HTTP ${resp.status} — ${err.slice(0, 500)}`);
  }
  const reply = (await resp.json()) as { id: string };
  return { replyId: reply.id, identity };
}
