import { wpFetch } from './wordpress.js';

// ─────────────────────────────────────────────────────────────────────────────
// Jetpack Stats (WordPress.com stats) for blog.postman.com.
//
// Read through the site's own REST API with the same Application Password the
// rest of Quill uses — Jetpack proxies WordPress.com stats under
// /wp-json/jetpack/v4/stats-app/sites/<blog id>/. No extra credentials. Read-only.
// ─────────────────────────────────────────────────────────────────────────────

const JETPACK_BLOG_ID = 199676833;
const STATS_BASE = `https://blog.postman.com/wp-json/jetpack/v4/stats-app/sites/${JETPACK_BLOG_ID}`;

export type StatsUnit = 'day' | 'week' | 'month';

async function statsGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const resp = await wpFetch(`${STATS_BASE}${path}?${qs}`);
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 300);
    throw new Error(`Jetpack Stats ${path} failed: HTTP ${resp.status} — ${body}`);
  }
  return (await resp.json()) as T;
}

export interface VisitPoint {
  period: string;
  views: number;
  visitors: number;
}

/** Site-wide views + visitors per day/week/month, newest last. */
export async function getSiteVisits(unit: StatsUnit, quantity: number, endYmd: string): Promise<VisitPoint[]> {
  const data = await statsGet<{ fields: string[]; data: Array<Array<string | number>> }>('/stats/visits', {
    unit,
    quantity,
    date: endYmd,
  });
  const iv = data.fields.indexOf('views');
  const ivis = data.fields.indexOf('visitors');
  return data.data.map((row) => ({
    period: String(row[0]),
    views: Number(row[iv]),
    visitors: Number(row[ivis]),
  }));
}

export interface TopPost {
  id: number;
  title: string;
  link: string;
  publishedYmd: string;
  views: number;
}

/**
 * Most-viewed blog posts across the `days` ending at `endYmd`. Jetpack also
 * returns the homepage and static pages in this list — those are dropped so
 * the result is posts only.
 */
export async function getTopPosts(days: number, endYmd: string, limit: number): Promise<TopPost[]> {
  const data = await statsGet<{
    summary: { postviews: Array<{ id: number; href: string; title: string; type: string; date: string | null; views: number }> };
  }>('/stats/top-posts', {
    period: 'day',
    num: days,
    date: endYmd,
    max: 100,
    summarize: 1,
  });
  return data.summary.postviews
    .filter((p) => p.type === 'post')
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      title: p.title,
      link: p.href,
      publishedYmd: (p.date ?? '').slice(0, 10),
      views: p.views,
    }));
}

export interface PostPerformance {
  id: number;
  title: string;
  link: string;
  publishedYmd: string;
  totalViews: number;
  last7Days: number;
  last30Days: number;
  bestDay: { ymd: string; views: number } | null;
}

/**
 * Lifetime and recent views for one post. Jetpack's per-post response embeds the
 * full post body — only the numbers are kept.
 */
export async function getPostPerformance(postId: number): Promise<PostPerformance> {
  const d = await statsGet<{
    views: number;
    data: Array<[string, number]>;
    post: { post_title: string; permalink: string; post_date: string };
  }>(`/stats/post/${postId}`, {});
  const daily = d.data ?? [];
  const sumLast = (n: number) => daily.slice(-n).reduce((s, [, v]) => s + v, 0);
  const best = daily.reduce<[string, number] | null>((b, row) => (!b || row[1] > b[1] ? row : b), null);
  return {
    id: postId,
    title: d.post.post_title,
    link: d.post.permalink,
    publishedYmd: d.post.post_date.slice(0, 10),
    totalViews: d.views,
    last7Days: sumLast(7),
    last30Days: sumLast(30),
    bestDay: best ? { ymd: best[0], views: best[1] } : null,
  };
}

export interface ReferrerGroup {
  source: string;
  views: number;
  top: Array<{ name: string; views: number }>;
}

export async function getReferrers(days: number, endYmd: string, limit: number): Promise<ReferrerGroup[]> {
  const data = await statsGet<{
    // `results` is a list for grouped sources (search engines, social) but a bare { views } object for single domains.
    summary: { groups: Array<{ name: string; total: number; results: Array<{ name: string; views: number }> | { views: number } }> };
  }>('/stats/referrers', { period: 'day', num: days, date: endYmd, max: 100, summarize: 1 });
  return data.summary.groups.slice(0, limit).map((g) => ({
    source: g.name,
    views: g.total,
    top: Array.isArray(g.results) ? g.results.slice(0, 3).map((r) => ({ name: r.name, views: r.views })) : [],
  }));
}

export interface SearchTerms {
  terms: Array<{ term: string; views: number }>;
  encryptedViews: number;
}

export async function getSearchTerms(days: number, endYmd: string, limit: number): Promise<SearchTerms> {
  const data = await statsGet<{
    summary: { search_terms: Array<{ term: string; views: number }>; encrypted_search_terms: number };
  }>('/stats/search-terms', { period: 'day', num: days, date: endYmd, max: 100, summarize: 1 });
  return {
    terms: data.summary.search_terms.slice(0, limit),
    encryptedViews: data.summary.encrypted_search_terms,
  };
}

/** Resolve a blog.postman.com URL (or bare slug) to its published WordPress post ID. */
export async function resolvePostId(urlOrSlug: string): Promise<number | null> {
  const slug = urlOrSlug
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .pop();
  if (!slug) return null;
  const resp = await wpFetch(`/posts?slug=${encodeURIComponent(slug)}&status=publish&_fields=id`);
  if (!resp.ok) throw new Error(`Post lookup for "${slug}" failed: HTTP ${resp.status}`);
  const posts = (await resp.json()) as Array<{ id: number }>;
  return posts[0]?.id ?? null;
}
