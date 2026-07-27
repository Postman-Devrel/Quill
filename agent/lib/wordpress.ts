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
 * Returns the resolved tag IDs in the same order. Tags are limited to 3 to keep
 * posts focused, matching the blog-wordpress-stage skill ("choose 3 tags").
 */
export async function findOrCreateTags(tagNames: string[]): Promise<ResolvedTag[]> {
  const resolved: ResolvedTag[] = [];
  for (const name of tagNames.slice(0, 3)) {
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

/**
 * Look up a WordPress user by display name or login slug.
 *
 * Uses the default `context=view`, which any authenticated account can call —
 * NOT `context=edit`, which needs the `list_users` capability (admin/editor
 * only). Using `edit` here meant a lower-privilege service account silently got
 * a 403 and no author was ever set. See the header note on capabilities.
 *
 * Returns an exact (case-insensitive) name/slug match, or the sole result when
 * the search is unambiguous. Returns null when there's no match or the result
 * is ambiguous (multiple non-exact hits) — better to warn than misattribute.
 * Throws on an HTTP error so the caller can surface a permission problem.
 */
export async function findWpUserByName(name: string): Promise<{ id: number; name: string; slug: string } | null> {
  const resp = await wpFetch(`/users?search=${encodeURIComponent(name)}&per_page=10`);
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`User lookup for "${name}" failed: HTTP ${resp.status} — ${err}`);
  }
  const users = (await resp.json()) as Array<{ id: number; name: string; slug: string }>;
  if (users.length === 0) return null;
  const needle = name.trim().toLowerCase();
  const exact = users.find(
    (u) => u.name.toLowerCase() === needle || u.slug.toLowerCase() === needle,
  );
  if (exact) return exact;
  // No exact match: accept a single result, else bail rather than guess.
  return users.length === 1 ? users[0] : null;
}

export interface CreateOrUpdatePostParams {
  title: string;
  htmlContent: string;
  metaDescription: string;
  focusKeyphrase?: string;
  tagIds?: number[];
  postId?: number; // omit to create new
  authorId?: number;
}

export interface CreatedOrUpdatedPost {
  id: number;
  title: string;
  status: string;
  link: string;
  editLink: string;
  authorId: number; // the author WordPress actually saved (may differ from requested)
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
  ymd: string; // YYYY-MM-DD creation date (in WP's local timezone — PT for blog.postman.com)
  modifiedYmd: string; // YYYY-MM-DD last-modified date (PT)
  isoDate: string;
  link: string;
}

/**
 * Fetch posts of a given status with optional date-range filter. Paginates
 * automatically. `afterYmd` / `beforeYmd` are inclusive day boundaries filtered
 * on the post's creation date (site-local PT), matching the blog-wordpress-*
 * skills. `orderBy` controls the sort field — use 'modified' for drafts so the
 * most recently touched ones come first.
 */
export async function getPostsByStatus(opts: {
  status: 'publish' | 'future' | 'draft' | 'pending';
  afterYmd?: string;
  beforeYmd?: string;
  order?: 'asc' | 'desc';
  orderBy?: 'date' | 'modified';
}): Promise<WpPost[]> {
  const order = opts.order ?? 'asc';
  const orderBy = opts.orderBy ?? 'date';
  const query: string[] = [
    `status=${opts.status}`,
    `per_page=100`,
    `orderby=${orderBy}`,
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
      modified: string;
      link: string;
    }>;
    for (const p of posts) {
      all.push({
        id: p.id,
        title: decodeHtmlEntities(p.title?.rendered ?? ''),
        status: p.status,
        ymd: (p.date ?? '').slice(0, 10),
        modifiedYmd: (p.modified ?? p.date ?? '').slice(0, 10),
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

// NOTE: Quill is staging-only for WordPress — it creates drafts (status=draft)
// but never schedules (status=future) or publishes (status=publish). Scheduling
// and publishing are human editor actions done in the WP admin panel. (An
// earlier schedulePost() was removed per the locked editorial policy.)

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
  if (params.authorId) postData.author = params.authorId;

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
    author: number;
  };
  return {
    id: post.id,
    title: decodeHtmlEntities(post.title?.rendered ?? ''),
    status: post.status,
    link: post.link,
    editLink: `https://blog.postman.com/wp-admin/post.php?post=${post.id}&action=edit`,
    authorId: post.author,
  };
}
