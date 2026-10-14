// Transcript sources for video-to-blog: YouTube captions, Loom transcripts, or pasted text.
// By default no API keys: the fetchers use the public, unauthenticated endpoints the players themselves use.
// These are undocumented and can change, so every failure points the user at pasting a transcript.
// Optionally, YouTube OAuth credentials (YOUTUBE_*) enable the official API for videos on your own channel.

export interface Transcript {
  source: string;
  title?: string;
  /** Plain transcript text, with [MM:SS] markers when timestamps are known. */
  text: string;
}

export const MAX_TRANSCRIPT_CHARS = 120_000;
const PASTE_HINT = 'Paste the transcript into the chat instead.';

export type VideoSource = { kind: 'youtube' | 'loom'; id: string; url: string };

export function parseVideoUrl(input: string): VideoSource {
  let u: URL;
  try { u = new URL(input.trim()); } catch { throw new Error('Use a full YouTube or Loom video URL.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('Use an HTTPS YouTube or Loom video URL.');
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be' || ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    let id: string | undefined;
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (u.pathname === '/watch') id = u.searchParams.get('v') ?? undefined;
    else id = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Use a single YouTube video URL, not a playlist or channel.');
    return { kind: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === 'loom.com' || host === 'www.loom.com') {
    const id = u.pathname.match(/^\/(?:share|embed)\/([a-f0-9]{32})\/?$/i)?.[1];
    if (!id) throw new Error('Use a Loom share link like https://www.loom.com/share/<id>.');
    return { kind: 'loom', id: id.toLowerCase(), url: `https://www.loom.com/share/${id.toLowerCase()}` };
  }
  throw new Error('Only YouTube and Loom URLs are supported. For anything else, paste the transcript.');
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Join caption cues into text, adding a [MM:SS] marker at most once per ~30 seconds. */
export function cuesToText(cues: { startMs: number; text: string }[]): string {
  const out: string[] = [];
  let lastMarker = -Infinity;
  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (cue.startMs - lastMarker >= 30_000) { out.push(`\n[${formatTimestamp(cue.startMs)}]`); lastMarker = cue.startMs; }
    out.push(text);
  }
  return out.join(' ').replace(/ ?\n ?/g, '\n').trim();
}

async function getJson(url: string, init: RequestInit, label: string): Promise<any> {
  const resp = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`${label} returned HTTP ${resp.status}. ${PASTE_HINT}`);
  return resp.json();
}

// YouTube refuses some client identities from cloud/data-center IPs (LOGIN_REQUIRED) while serving others,
// and which ones changes over time. Try several in order and keep the first that returns captions.
const YOUTUBE_CLIENTS: { name: string; userAgent: string; context: Record<string, unknown>; thirdParty?: Record<string, string> }[] = [
  { name: 'ANDROID', userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)', context: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34 } },
  { name: 'IOS', userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)', context: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' } },
  { name: 'TV_EMBEDDED', userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15', context: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0' }, thirdParty: { embedUrl: 'https://www.google.com/' } },
  { name: 'MWEB', userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1', context: { clientName: 'MWEB', clientVersion: '2.20250219.00.00' } },
];

class YouTubeAttemptError extends Error {
  constructor(message: string, readonly kind: 'blocked' | 'no-captions' | 'other') { super(message); }
}

async function youtubeAttempt(videoId: string, client: (typeof YOUTUBE_CLIENTS)[number]): Promise<Transcript> {
  const player = await getJson('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': client.userAgent },
    body: JSON.stringify({ context: { client: { ...client.context, hl: 'en' }, ...(client.thirdParty ? { thirdParty: client.thirdParty } : {}) }, videoId }),
  }, 'YouTube');
  const status = player.playabilityStatus?.status;
  if (status && status !== 'OK') throw new YouTubeAttemptError(`YouTube refused the request (${status}).`, status === 'LOGIN_REQUIRED' ? 'blocked' : 'other');
  const tracks: { baseUrl: string; languageCode: string; kind?: string }[] = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) throw new YouTubeAttemptError('No caption tracks.', 'no-captions');
  // Prefer author-written English captions, then auto-generated English, then whatever exists.
  const track = tracks.find(t => t.languageCode.startsWith('en') && t.kind !== 'asr')
    ?? tracks.find(t => t.languageCode.startsWith('en')) ?? tracks[0];
  const captionUrl = new URL(track.baseUrl);
  if (captionUrl.protocol !== 'https:' || !/(^|\.)youtube\.com$/.test(captionUrl.hostname)) throw new YouTubeAttemptError('Unexpected YouTube caption URL.', 'other');
  captionUrl.searchParams.set('fmt', 'json3');
  const resp = await fetch(captionUrl, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': client.userAgent } });
  const body = resp.ok ? await resp.text() : '';
  const data = body ? JSON.parse(body) : {};
  const cues = (data.events ?? [])
    .filter((e: any) => Array.isArray(e.segs))
    .map((e: any) => ({ startMs: Number(e.tStartMs) || 0, text: e.segs.map((s: any) => s.utf8 ?? '').join('') }));
  const text = cuesToText(cues);
  if (!text) throw new YouTubeAttemptError(`Caption download returned nothing (HTTP ${resp.status}).`, 'other');
  return { source: `https://www.youtube.com/watch?v=${videoId}`, title: player.videoDetails?.title, text };
}

export async function fetchYouTubeTranscript(videoId: string, clients = YOUTUBE_CLIENTS): Promise<Transcript> {
  const failures: YouTubeAttemptError[] = [];
  for (const client of clients) {
    try {
      const result = await youtubeAttempt(videoId, client);
      if (failures.length) console.log(`[transcript] YouTube ${client.name} client worked after ${failures.length} failed attempt(s)`);
      return result;
    } catch (e) {
      const err = e instanceof YouTubeAttemptError ? e : new YouTubeAttemptError(e instanceof Error ? e.message : String(e), 'other');
      console.log(`[transcript] YouTube ${client.name} client failed: ${err.message.slice(0, 200)}`);
      failures.push(err);
    }
  }
  if (failures.some(f => f.kind === 'no-captions')) throw new Error(`This YouTube video has no captions. ${PASTE_HINT}`);
  if (failures.some(f => f.kind === 'blocked')) {
    throw new Error(`YouTube is blocking caption requests from this server (the video itself may be fine). ${PASTE_HINT}`);
  }
  throw new Error(`Could not fetch YouTube captions (${failures.at(-1)?.message.slice(0, 120)}). ${PASTE_HINT}`);
}

// Official YouTube Data API, authorized as a channel owner/manager via an OAuth refresh token. Unlike the
// scraper above it isn't blocked on cloud IPs, but captions.download only works for videos that account can edit.
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

export function youtubeOAuthConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);
}

async function youtubeAccessToken(): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!, client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN!, grant_type: 'refresh_token',
    }),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`Google rejected the YouTube refresh token (${data.error ?? `HTTP ${resp.status}`}); it may have expired or been revoked.`);
  }
  return data.access_token;
}

async function youtubeApi(path: string, token: string): Promise<Response> {
  return fetch(`${YOUTUBE_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
}

export async function fetchYouTubeOAuthTranscript(videoId: string): Promise<Transcript> {
  const token = await youtubeAccessToken();
  const list = await youtubeApi(`/captions?part=snippet&videoId=${videoId}`, token);
  if (list.status === 403 || list.status === 404) throw new Error(`The authorized YouTube account can't access this video's captions (HTTP ${list.status}); it must be a video that account owns or manages.`);
  if (!list.ok) throw new Error(`YouTube captions.list returned HTTP ${list.status}.`);
  const tracks: { id: string; snippet?: { language?: string; trackKind?: string } }[] = ((await list.json()) as any).items ?? [];
  const usable = tracks.filter(t => t.snippet?.trackKind?.toLowerCase() !== 'forced');
  if (!usable.length) throw new YouTubeAttemptError('No caption tracks.', 'no-captions');
  const isEn = (t: (typeof usable)[number]) => (t.snippet?.language ?? '').startsWith('en');
  const track = usable.find(t => isEn(t) && t.snippet?.trackKind?.toLowerCase() === 'standard') ?? usable.find(isEn) ?? usable[0];
  const dl = await youtubeApi(`/captions/${encodeURIComponent(track.id)}?tfmt=vtt`, token);
  if (dl.status === 403) throw new Error('YouTube refused the caption download (HTTP 403); the authorized account needs edit access to this video.');
  if (!dl.ok) throw new Error(`YouTube captions.download returned HTTP ${dl.status}.`);
  const text = vttToText(await dl.text());
  if (!text) throw new Error('YouTube returned an empty caption track.');
  const meta = await youtubeApi(`/videos?part=snippet&id=${videoId}`, token).then(r => r.ok ? r.json() : null).catch(() => null) as any;
  return { source: `https://www.youtube.com/watch?v=${videoId}`, title: meta?.items?.[0]?.snippet?.title, text };
}

/** Official API first when configured, then the keyless scraper. */
async function getYouTubeTranscript(videoId: string): Promise<Transcript> {
  if (!youtubeOAuthConfigured()) return fetchYouTubeTranscript(videoId);
  try {
    return await fetchYouTubeOAuthTranscript(videoId);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.log(`[transcript] YouTube OAuth failed, trying keyless fetch: ${reason.slice(0, 200)}`);
    try {
      return await fetchYouTubeTranscript(videoId);
    } catch (scrapeErr) {
      throw new Error(`${scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr)} (YouTube API: ${reason})`);
    }
  }
}

const LOOM_QUERY =`query FetchVideoTranscript($videoId: ID!, $password: String) {
  fetchVideoTranscript(videoId: $videoId, password: $password) {
    ... on VideoTranscriptDetails { video_id source_url captions_source_url }
    ... on GenericError { message }
    ... on InvalidRequestWarning { message }
  }
}`;

function loomUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/(^|\.)loom\.com$/.test(u.hostname)) throw new Error(`Unexpected Loom transcript URL. ${PASTE_HINT}`);
  return u;
}

function vttToText(vtt: string): string {
  const cues: { startMs: number; text: string }[] = [];
  // YouTube auto-captions are "rolling": every cue repeats the previous cue's last line, and new words carry
  // inline <00:00:01.000> timing tags. Drop lines already shown by the previous cue so text isn't repeated.
  const rolling = /<\d{2}:\d{2}:\d{2}\.\d{3}>/.test(vtt);
  let prevLines = new Set<string>();
  for (const block of vtt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const m = lines[i].match(/(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/);
    if (!m) continue;
    const startMs = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
    const cueLines = lines.slice(i + 1).map(l => l.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const fresh = rolling ? cueLines.filter(l => !prevLines.has(l)) : cueLines;
    prevLines = new Set(cueLines);
    cues.push({ startMs, text: fresh.join(' ') });
  }
  return cuesToText(cues);
}

export async function fetchLoomTranscript(videoId: string): Promise<Transcript> {
  const data = await getJson('https://www.loom.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-loom-request-source': 'loom_web', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ operationName: 'FetchVideoTranscript', query: LOOM_QUERY, variables: { videoId, password: null } }),
  }, 'Loom');
  const result = data.data?.fetchVideoTranscript;
  if (result?.message) throw new Error(`Loom could not return a transcript ("${String(result.message).slice(0, 200)}"). A private or workspace-only video can't be read without a login. ${PASTE_HINT}`);
  if (!result?.captions_source_url && !result?.source_url) {
    throw new Error(`Loom returned no transcript. The video may be private, password-protected, or not transcribed yet. ${PASTE_HINT}`);
  }
  let text = '';
  if (result.captions_source_url) {
    const resp = await fetch(loomUrl(result.captions_source_url), { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (resp.ok) text = vttToText(await resp.text());
  }
  if (!text && result.source_url) {
    const resp = await fetch(loomUrl(result.source_url), { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (resp.ok) {
      const json: any = await resp.json().catch(() => null);
      const phrases: any[] = json?.phrases ?? json?.transcript ?? [];
      text = cuesToText(phrases.map(p => ({ startMs: (Number(p.ts ?? p.start) || 0) * 1000, text: String(p.value ?? p.text ?? '') })));
    }
  }
  if (!text) throw new Error(`Loom's transcript was empty or in an unexpected format. ${PASTE_HINT}`);
  return { source: `https://www.loom.com/share/${videoId}`, text };
}

export async function getTranscript(args: { url?: string; transcript?: string; title?: string }): Promise<Transcript> {
  let result: Transcript;
  if (args.transcript?.trim()) {
    result = { source: args.url?.trim() ? parseVideoUrl(args.url).url : 'pasted transcript', title: args.title, text: args.transcript.trim() };
  } else if (args.url) {
    const src = parseVideoUrl(args.url);
    result = src.kind === 'youtube' ? await getYouTubeTranscript(src.id) : await fetchLoomTranscript(src.id);
    if (args.title) result.title = args.title;
  } else {
    throw new Error('Provide a YouTube/Loom URL or paste the transcript.');
  }
  if (result.text.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(`The transcript is too long (${result.text.length} characters; limit ${MAX_TRANSCRIPT_CHARS}). Split it into parts or paste the relevant sections.`);
  }
  return result;
}
