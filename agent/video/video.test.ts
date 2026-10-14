import { test, expect, afterAll } from 'bun:test';
import { parseVideoUrl, cuesToText, fetchYouTubeTranscript, fetchLoomTranscript, getTranscript } from './transcript';
import { formatVideoArticle } from './draft';
import { videoToBlog } from './pipeline';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
process.env.ANTHROPIC_API_KEY = 'test-key';
afterAll(async () => { globalThis.fetch = originalFetch; process.env = originalEnv; });
const transcript = { source: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'API testing', text: '[00:00] Send a request and check the response.' };
const article = { title: 'Test an API', metaDescription: 'Learn how to test an API.', slug: 'test-an-api', primaryKeyword: 'API testing', secondaryKeywords: [], answerSummary: 'Send a request and verify the response.', markdown: '# Test an API\n\n' + 'A grounded explanation. '.repeat(15), reviewNotes: [] };
const LOOM_ID = 'a'.repeat(32);

test('normalizes YouTube and Loom URLs and rejects everything else', () => {
  for (const url of ['https://youtu.be/abcdefghijk?t=4', 'https://www.youtube.com/watch?v=abcdefghijk&list=abc', 'https://youtube.com/shorts/abcdefghijk']) {
    expect(parseVideoUrl(url)).toEqual({ kind: 'youtube', id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  }
  expect(parseVideoUrl(`https://www.loom.com/share/${LOOM_ID}?sid=x`)).toEqual({ kind: 'loom', id: LOOM_ID, url: `https://www.loom.com/share/${LOOM_ID}` });
  for (const url of ['http://youtube.com/watch?v=abcdefghijk', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://127.0.0.1/video', 'file:///etc/passwd',
    'https://youtube.com/playlist?list=abc', 'https://user:pass@youtube.com/watch?v=abcdefghijk', 'https://loom.com.evil.test/share/' + LOOM_ID, 'https://www.loom.com/share/short', 'not a url']) {
    expect(() => parseVideoUrl(url)).toThrow();
  }
});

test('cuesToText adds a timestamp marker about every 30 seconds and skips blanks', () => {
  const text = cuesToText([{ startMs: 1000, text: 'Hello  there' }, { startMs: 5000, text: ' ' }, { startMs: 20000, text: 'again' }, { startMs: 65000, text: 'later' }]);
  expect(text).toBe('[00:01] Hello there again\n[01:05] later');
});

function youtubeFetch(tracks: unknown[], playability = 'OK') {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('youtubei/v1/player')) return Response.json({ playabilityStatus: { status: playability }, videoDetails: { title: 'My video' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } });
    expect(u).toContain('fmt=json3');
    return Response.json({ events: [{ tStartMs: 1200, segs: [{ utf8: 'All right, ' }, { utf8: 'so here we are' }] }, { tStartMs: 500 }] });
  }) as unknown as typeof fetch;
}
test('fetches YouTube captions, preferring author-written English', async () => {
  globalThis.fetch = youtubeFetch([
    { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&kind=asr', languageCode: 'en', kind: 'asr' },
    { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', languageCode: 'en' },
  ]);
  const result = await fetchYouTubeTranscript('abcdefghijk');
  expect(result).toEqual({ source: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'My video', text: '[00:01] All right, so here we are' });
});
test('YouTube failures tell the user to paste a transcript', async () => {
  globalThis.fetch = youtubeFetch([]);
  await expect(fetchYouTubeTranscript('abcdefghijk')).rejects.toThrow('no captions');
  globalThis.fetch = youtubeFetch([], 'LOGIN_REQUIRED');
  await expect(fetchYouTubeTranscript('abcdefghijk')).rejects.toThrow('blocking caption requests');
  globalThis.fetch = youtubeFetch([{ baseUrl: 'https://evil.test/timedtext', languageCode: 'en' }]);
  await expect(fetchYouTubeTranscript('abcdefghijk')).rejects.toThrow('Unexpected');
});

test('YouTube falls back to another client when the first is blocked from this server', async () => {
  const tried: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('youtubei/v1/player')) {
      const client = JSON.parse(String(init?.body)).context.client.clientName;
      tried.push(client);
      if (client === 'ANDROID' || client === 'IOS') return Response.json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } });
      return Response.json({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Cloud video' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', languageCode: 'en' }] } } });
    }
    return Response.json({ events: [{ tStartMs: 0, segs: [{ utf8: 'Worked from the cloud' }] }] });
  }) as unknown as typeof fetch;
  const result = await fetchYouTubeTranscript('abcdefghijk');
  expect(tried).toEqual(['ANDROID', 'IOS', 'TVHTML5_SIMPLY_EMBEDDED_PLAYER']);
  expect(result.text).toBe('[00:00] Worked from the cloud');
});

function withYouTubeOAuth() {
  process.env.YOUTUBE_CLIENT_ID = 'id'; process.env.YOUTUBE_CLIENT_SECRET = 'secret'; process.env.YOUTUBE_REFRESH_TOKEN = 'refresh';
}
function clearYouTubeOAuth() {
  delete process.env.YOUTUBE_CLIENT_ID; delete process.env.YOUTUBE_CLIENT_SECRET; delete process.env.YOUTUBE_REFRESH_TOKEN;
}

test('YouTube OAuth downloads the standard English track via the official API', async () => {
  withYouTubeOAuth();
  const urls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); urls.push(u);
    if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok' });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    if (u.includes('/captions?')) return Response.json({ items: [{ id: 'asr1', snippet: { language: 'en', trackKind: 'ASR' } }, { id: 'std1', snippet: { language: 'en', trackKind: 'standard' } }] });
    if (u.includes('/captions/std1')) return new Response('WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nHello from the API\n');
    if (u.includes('/videos?')) return Response.json({ items: [{ snippet: { title: 'Owned video' } }] });
    throw new Error(`unexpected ${u}`);
  }) as unknown as typeof fetch;
  try {
    const result = await getTranscript({ url: 'https://youtu.be/abcdefghijk' });
    expect(result).toEqual({ source: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Owned video', text: '[00:02] Hello from the API' });
    expect(urls.some(u => u.includes('youtubei/v1/player'))).toBe(false);
  } finally { clearYouTubeOAuth(); }
});

test('YouTube OAuth de-duplicates rolling auto-caption cues', async () => {
  withYouTubeOAuth();
  const vtt = `WEBVTT

00:00:00.160 --> 00:00:02.149 align:start position:0%

AI<00:00:00.560><c> models</c><00:00:00.880><c> are</c><00:00:01.120><c> frozen</c>

00:00:02.149 --> 00:00:02.159 align:start position:0%
AI models are frozen


00:00:02.159 --> 00:00:06.150 align:start position:0%
AI models are frozen
Claude,<00:00:03.200><c> GPT,</c><00:00:04.319><c> Gemini</c>

00:00:06.150 --> 00:00:06.160 align:start position:0%
Claude, GPT, Gemini

`;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok' });
    if (u.includes('/captions?')) return Response.json({ items: [{ id: 'asr1', snippet: { language: 'en', trackKind: 'asr' } }] });
    if (u.includes('/captions/asr1')) return new Response(vtt);
    return Response.json({ items: [] });
  }) as unknown as typeof fetch;
  try {
    expect((await getTranscript({ url: 'https://youtu.be/abcdefghijk' })).text).toBe('[00:00] AI models are frozen Claude, GPT, Gemini');
  } finally { clearYouTubeOAuth(); }
});

test('YouTube OAuth failure falls back to the keyless fetch and explains both failures', async () => {
  withYouTubeOAuth();
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok' });
    if (u.includes('/captions?')) return new Response('', { status: 403 });
    return Response.json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } });
  }) as unknown as typeof fetch;
  try {
    await expect(getTranscript({ url: 'https://youtu.be/abcdefghijk' })).rejects.toThrow(/blocking caption requests.*YouTube API: .*can't access/);
    const keyless = youtubeFetch([{ baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', languageCode: 'en' }]);
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => String(url).includes('oauth2.googleapis.com')
      ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : keyless(url, init)) as unknown as typeof fetch;
    expect((await getTranscript({ url: 'https://youtu.be/abcdefghijk' })).text).toContain('so here we are');
  } finally { clearYouTubeOAuth(); }
});

test('fetches a Loom transcript from VTT captions', async () => {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith('/graphql')) return Response.json({ data: { fetchVideoTranscript: { video_id: LOOM_ID, captions_source_url: 'https://cdn.loom.com/t.vtt', source_url: null } } });
    return new Response('WEBVTT\n\n1\n00:00:02.000 --> 00:00:04.000\nFirst <b>line</b>\n\n2\n00:01:05.500 --> 00:01:07.000\nSecond line\n');
  }) as unknown as typeof fetch;
  expect((await fetchLoomTranscript(LOOM_ID)).text).toBe('[00:02] First line\n[01:05] Second line');
});
test('Loom falls back to JSON phrases, and private/empty videos ask for a paste', async () => {
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/graphql')) return Response.json({ data: { fetchVideoTranscript: { source_url: 'https://cdn.loom.com/t.json' } } });
    return Response.json({ phrases: [{ ts: 3, value: 'Hello Loom' }] });
  }) as unknown as typeof fetch;
  expect((await fetchLoomTranscript(LOOM_ID)).text).toBe('[00:03] Hello Loom');
  globalThis.fetch = (async () => Response.json({ data: { fetchVideoTranscript: {} } })) as unknown as typeof fetch;
  await expect(fetchLoomTranscript(LOOM_ID)).rejects.toThrow('Paste the transcript');
  globalThis.fetch = (async () => Response.json({ data: { fetchVideoTranscript: { message: 'Password required' } } })) as unknown as typeof fetch;
  await expect(fetchLoomTranscript(LOOM_ID)).rejects.toThrow('Password required');
  globalThis.fetch = (async (url: string | URL | Request) => String(url).endsWith('/graphql')
    ? Response.json({ data: { fetchVideoTranscript: { captions_source_url: 'https://evil.test/t.vtt' } } }) : new Response('')) as unknown as typeof fetch;
  await expect(fetchLoomTranscript(LOOM_ID)).rejects.toThrow('Unexpected');
});

test('getTranscript accepts pasted text without network, and enforces input rules', async () => {
  globalThis.fetch = (async () => { throw new Error('no network expected'); }) as unknown as typeof fetch;
  expect(await getTranscript({ transcript: ' hello world ', title: 'T' })).toEqual({ source: 'pasted transcript', title: 'T', text: 'hello world' });
  await expect(getTranscript({})).rejects.toThrow('Provide');
  await expect(getTranscript({ transcript: 'x'.repeat(120_001) })).rejects.toThrow('too long');
});

test('formats deterministic SEO/AEO metadata and rejects malformed articles', () => {
  const result = formatVideoArticle(article, 'https://www.youtube.com/watch?v=abcdefghijk');
  expect(result.draft).toContain('answer_summary:');
  expect(result.draft).toContain('source_video:');
  expect(result.draft).not.toContain('seo_score');
  expect(() => formatVideoArticle({ ...article, slug: '../bad' })).toThrow();
});

const page = { pageId: '123', pageUrl: 'https://example.atlassian.net/wiki/spaces/X/pages/123', title: 'Test an API', spaceKey: 'X', identity: 'bot' };
test('videoToBlog fetches, drafts, and saves to Confluence in one call', async () => {
  const saved: { title: string; markdown: string }[] = [];
  const result = await videoToBlog({ url: transcript.source, audience: 'Developers' }, {
    getTranscript: async () => transcript,
    draft: async () => formatVideoArticle(article, transcript.source),
    save: async (p: any) => { saved.push(p); return page; },
  });
  expect(result).toMatchObject({ success: true, pageUrl: page.pageUrl, title: 'Test an API', source: transcript.source });
  expect(saved).toHaveLength(1);
  expect(saved[0].markdown).toContain('source_video:');
  expect(saved[0].markdown).toContain('# Test an API');
});
test('videoToBlog keeps the draft when Confluence fails', async () => {
  const result = await videoToBlog({ transcript: 'hi', audience: 'Developers' }, {
    getTranscript: async () => transcript,
    draft: async () => formatVideoArticle(article),
    save: async () => { throw new Error('Confluence 401'); },
  });
  expect(result).toMatchObject({ success: false, saveError: 'Confluence 401' });
  expect((result as { draft: string }).draft).toContain('# Test an API');
});
test('videoToBlog surfaces transcript errors and requires the Anthropic key', async () => {
  await expect(videoToBlog({ url: transcript.source, audience: 'Developers' }, {
    getTranscript: async () => { throw new Error('This YouTube video has no captions. Paste the transcript into the chat instead.'); },
    draft: async () => formatVideoArticle(article), save: async () => page,
  } as any)).rejects.toThrow('no captions');
  const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  await expect(videoToBlog({ transcript: 'hi', audience: 'Developers' })).rejects.toThrow('ANTHROPIC_API_KEY');
  process.env.ANTHROPIC_API_KEY = key;
});
