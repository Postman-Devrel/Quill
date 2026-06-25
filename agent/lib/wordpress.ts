const WP_BASE = 'https://blog.postman.com/wp-json/wp/v2';
const USER_AGENT = 'Quill/1.0 (Postman DevRel)';

function getWpAuthHeader(): string {
  const username = process.env.WP_USERNAME;
  const password = process.env.WP_APP_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'WP_USERNAME and WP_APP_PASSWORD must be set. Run: ast project configure',
    );
  }
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function wpFetch(
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {},
): Promise<Response> {
  const auth = getWpAuthHeader();
  const headers: Record<string, string> = {
    Authorization: auth,
    'User-Agent': USER_AGENT,
    ...((init.headers as Record<string, string>) ?? {}),
  };
  let body = init.body;
  if (init.jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.jsonBody);
  }
  return fetch(`${WP_BASE}${path}`, { ...init, headers, body });
}

export interface ResolvedTag {
  name: string;
  id: number;
  created: boolean;
}

/**
 * For each tag name: find a case-insensitive exact match in WP, otherwise create it.
 * Returns the resolved tag IDs in the same order. Tags are limited to 5 to keep posts focused.
 */
export async function findOrCreateTags(tagNames: string[]): Promise<ResolvedTag[]> {
  const resolved: ResolvedTag[] = [];
  for (const name of tagNames.slice(0, 5)) {
    const searchResp = await wpFetch(`/tags?search=${encodeURIComponent(name)}&per_page=5`);
    if (!searchResp.ok) {
      throw new Error(`Tag lookup failed for "${name}": HTTP ${searchResp.status}`);
    }
    const existing = (await searchResp.json()) as Array<{ id: number; name: string }>;
    const match = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (match) {
      resolved.push({ name, id: match.id, created: false });
      continue;
    }
    const createResp = await wpFetch('/tags', { method: 'POST', jsonBody: { name } });
    if (!createResp.ok) {
      throw new Error(`Tag create failed for "${name}": HTTP ${createResp.status}`);
    }
    const created = (await createResp.json()) as { id: number; name: string };
    resolved.push({ name, id: created.id, created: true });
  }
  return resolved;
}

export interface ExistingPost {
  id: number;
  title: string;
  status: string;
  link: string;
}

export interface BlogSearchResult {
  id: number;
  title: string;
  status: string;
  ymd: string;
  link: string;
  excerpt: string;
}

/**
 * Fuzzy-search blog.postman.com across published, scheduled, draft, and pending posts.
 * Used by check_blog_coverage to avoid accidentally writing duplicate content.
 * WP REST orders by relevance when `search` is provided.
 */
export async function searchWordPressPosts(
  query: string,
  limit = 5,
): Promise<BlogSearchResult[]> {
  const resp = await wpFetch(
    `/posts?search=${encodeURIComponent(query)}&status=publish,future,draft,pending&per_page=${limit}`,
  );
  if (!resp.ok) {
    throw new Error(`WP search failed: HTTP ${resp.status}`);
  }
  const posts = (await resp.json()) as Array<{
    id: number;
    title: { rendered: string };
    status: string;
    date: string;
    link: string;
    excerpt: { rendered: string };
  }>;
  return posts.map((p) => ({
    id: p.id,
    title: decodeHtmlEntities(p.title?.rendered ?? ''),
    status: p.status,
    ymd: (p.date ?? '').slice(0, 10),
    link: p.link,
    excerpt: decodeHtmlEntities(p.excerpt?.rendered ?? '')
      .replace(/<[^>]+>/g, '')
      .trim()
      .slice(0, 240),
  }));
}

/**
 * Find a WP post by exact (case-insensitive) title match across draft/pending/future/publish.
 * Returns null if no exact match — substring matches do NOT count.
 */
export async function findPostByExactTitle(title: string): Promise<ExistingPost | null> {
  const url = `/posts?search=${encodeURIComponent(title)}&status=draft,pending,future,publish&per_page=10`;
  const resp = await wpFetch(url);
  if (!resp.ok) {
    throw new Error(`Post search failed: HTTP ${resp.status}`);
  }
  const posts = (await resp.json()) as Array<{
    id: number;
    title: { rendered: string };
    status: string;
    link: string;
  }>;
  const needle = title.trim().toLowerCase();
  const match = posts.find(
    (p) => decodeHtmlEntities(p.title?.rendered ?? '').trim().toLowerCase() === needle,
  );
  return match
    ? {
        id: match.id,
        title: decodeHtmlEntities(match.title?.rendered ?? ''),
        status: match.status,
        link: match.link,
      }
    : null;
}

export interface CreateOrUpdatePostParams {
  title: string;
  htmlContent: string;
  metaDescription: string;
  focusKeyphrase?: string;
  tagIds?: number[];
  postId?: number; // omit to create new
}

export interface CreatedOrUpdatedPost {
  id: number;
  title: string;
  status: string;
  link: string;
  editLink: string;
}

/**
 * Create a new WP draft post, or update an existing one by ID. Always status=draft.
 * Sets Yoast SEO meta description + focus keyphrase when provided.
 */
export interface ScheduledPost {
  id: number;
  title: string;
  status: string;
  ymd: string; // YYYY-MM-DD in PST
  isoDate: string; // original ISO string from WP
  link: string;
}

export interface WpPost {
  id: number;
  title: string;
  status: string;
  ymd: string; // YYYY-MM-DD (in WP's local timezone — PT for blog.postman.com)
  isoDate: string;
  link: string;
}

/**
 * Fetch posts of a given status with optional date-range filter. Paginates
 * automatically. `afterYmd` / `beforeYmd` are inclusive day boundaries.
 */
export async function getPostsByStatus(opts: {
  status: 'publish' | 'future' | 'draft' | 'pending';
  afterYmd?: string;
  beforeYmd?: string;
  order?: 'asc' | 'desc';
}): Promise<WpPost[]> {
  const order = opts.order ?? 'asc';
  const query: string[] = [
    `status=${opts.status}`,
    `per_page=100`,
    `orderby=date`,
    `order=${order}`,
  ];
  if (opts.afterYmd) query.push(`after=${opts.afterYmd}T00:00:00`);
  if (opts.beforeYmd) query.push(`before=${opts.beforeYmd}T23:59:59`);

  const all: WpPost[] = [];
  let page = 1;
  while (true) {
    const resp = await wpFetch(`/posts?${query.join('&')}&page=${page}`);
    if (!resp.ok) {
      throw new Error(`Posts fetch (status=${opts.status}) failed: HTTP ${resp.status}`);
    }
    const posts = (await resp.json()) as Array<{
      id: number;
      title: { rendered: string };
      status: string;
      date: string;
      link: string;
    }>;
    for (const p of posts) {
      all.push({
        id: p.id,
        title: decodeHtmlEntities(p.title?.rendered ?? ''),
        status: p.status,
        ymd: (p.date ?? '').slice(0, 10),
        isoDate: p.date,
        link: p.link,
      });
    }
    if (posts.length < 100) break;
    page++;
  }
  return all;
}

/**
 * Fetch posts with status=future (already scheduled). Used to detect same-day
 * conflicts when finding the next open slot.
 */
export async function getScheduledPosts(): Promise<ScheduledPost[]> {
  const all: ScheduledPost[] = [];
  let page = 1;
  while (true) {
    const resp = await wpFetch(
      `/posts?status=future&per_page=100&page=${page}&orderby=date&order=asc`,
    );
    if (!resp.ok) {
      throw new Error(`Scheduled posts fetch failed: HTTP ${resp.status}`);
    }
    const posts = (await resp.json()) as Array<{
      id: number;
      title: { rendered: string };
      status: string;
      date: string;
      link: string;
    }>;
    for (const p of posts) {
      all.push({
        id: p.id,
        title: decodeHtmlEntities(p.title?.rendered ?? ''),
        status: p.status,
        ymd: (p.date ?? '').slice(0, 10),
        isoDate: p.date,
        link: p.link,
      });
    }
    if (posts.length < 100) break;
    page++;
  }
  return all;
}

/**
 * Set a post's date and flip it from draft → future (scheduled). The dateIsoLocal
 * argument should be like "2026-07-02T08:00:00" — interpreted in WP's configured
 * timezone (PST/PT for blog.postman.com).
 */
export async function schedulePost(
  postId: number,
  dateIsoLocal: string,
): Promise<CreatedOrUpdatedPost> {
  const resp = await wpFetch(`/posts/${postId}`, {
    method: 'PUT',
    jsonBody: {
      status: 'future',
      date: dateIsoLocal,
    },
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Schedule failed: HTTP ${resp.status} — ${err}`);
  }
  const post = (await resp.json()) as {
    id: number;
    title: { rendered: string };
    status: string;
    link: string;
  };
  return {
    id: post.id,
    title: decodeHtmlEntities(post.title?.rendered ?? ''),
    status: post.status,
    link: post.link,
    editLink: `https://blog.postman.com/wp-admin/post.php?post=${post.id}&action=edit`,
  };
}

export async function createOrUpdatePost(
  params: CreateOrUpdatePostParams,
): Promise<CreatedOrUpdatedPost> {
  const postData: Record<string, unknown> = {
    title: params.title,
    content: params.htmlContent,
    status: 'draft',
    excerpt: params.metaDescription,
    meta: {
      _yoast_wpseo_metadesc: params.metaDescription,
      ...(params.focusKeyphrase && { _yoast_wpseo_focuskw: params.focusKeyphrase }),
    },
  };
  if (params.tagIds?.length) postData.tags = params.tagIds;

  const path = params.postId ? `/posts/${params.postId}` : '/posts';
  const method = params.postId ? 'PUT' : 'POST';

  const resp = await wpFetch(path, { method, jsonBody: postData });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`WP ${method} ${path} failed: HTTP ${resp.status} — ${err}`);
  }

  const post = (await resp.json()) as {
    id: number;
    title: { rendered: string };
    status: string;
    link: string;
  };
  return {
    id: post.id,
    title: decodeHtmlEntities(post.title?.rendered ?? ''),
    status: post.status,
    link: post.link,
    editLink: `https://blog.postman.com/wp-admin/post.php?post=${post.id}&action=edit`,
  };
}
