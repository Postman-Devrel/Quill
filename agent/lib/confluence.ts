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
  const spaceKey = params.spaceKey ?? process.env.CONFLUENCE_SPACE_KEY;
  if (!spaceKey) {
    throw new Error(
      'CONFLUENCE_SPACE_KEY is not set. This is the key of the shared "Quill Drafts" Confluence space where all blog drafts get saved. Set it via `ast project configure` (locally) or `ast secrets create CONFLUENCE_SPACE_KEY` (for deploy).',
    );
  }
  const parentId = params.parentPageId ?? process.env.CONFLUENCE_PARENT_PAGE_ID;

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

const PAGE_URL_RE = /\/pages\/(\d+)/;
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
