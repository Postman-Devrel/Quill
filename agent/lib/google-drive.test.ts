import { afterAll, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { readGoogleDoc } from './google-drive';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'quill-test@example.com';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
afterAll(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });

let calls: string[];
function mockDrive(status = 200, reason = '', mimeType = 'application/vnd.google-apps.document') {
  calls = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'test-token', expires_in: 3600 });
    }
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token');
    expect(url.startsWith('https://www.googleapis.com/drive/v3/files/')).toBe(true);
    if (status !== 200) return Response.json({ error: { errors: [{ reason }] } }, { status });
    if (url.includes('/export?')) return new Response('<h1>Private draft</h1><p>Hello team.</p>');
    return Response.json({ name: 'Private document', mimeType });
  }) as typeof fetch;
}

test('reads private Google Docs via authenticated metadata and HTML export', async () => {
  mockDrive();
  const doc = await readGoogleDoc('https://docs.google.com/document/d/abcdefghijklmnop/edit');
  expect(doc.title).toBe('Private document');
  expect(doc.markdown).toContain('Hello team.');
  expect(calls.some(url => url.includes('/export?mimeType=text%2Fhtml'))).toBe(true);
  expect(calls.some(url => url.startsWith('https://docs.google.com'))).toBe(false);
});
for (const status of [403, 404]) {
  test(`HTTP ${status} explains private service-account sharing`, async () => {
    mockDrive(status);
    await expect(readGoogleDoc('abcdefghijklmnop')).rejects.toThrow('share the document or its parent folder with quill-test@example.com as Viewer');
  });
}
for (const [status, reason, message] of [
  [403, 'accessNotConfigured', 'Enable the Google Drive API'],
  [401, '', 'Google rejected the credentials'],
  [403, 'rateLimitExceeded', 'rate or quota limit'],
  [429, '', 'rate or quota limit'],
] as const) {
  test(`reports ${status} ${reason} accurately`, async () => {
    mockDrive(status, reason);
    await expect(readGoogleDoc('abcdefghijklmnop')).rejects.toThrow(message);
  });
}
test('rejects non-Docs before attempting export', async () => {
  mockDrive(200, '', 'application/pdf');
  await expect(readGoogleDoc('abcdefghijklmnop')).rejects.toThrow('supports Google Docs only');
  expect(calls.some(url => url.includes('/export?'))).toBe(false);
});


test('normalizes real, escaped, and flattened PEM newlines without changing the key', async () => {
  const { normalizeGooglePrivateKey } = await import('./google-drive');
  const { createPrivateKey } = await import('node:crypto');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  for (const variant of [pem, pem.replace(/\n/g, '\\n'), pem.replace(/\n/g, ' ')]) {
    const parsed = createPrivateKey(normalizeGooglePrivateKey(variant));
    expect(parsed.export({ type: 'pkcs8', format: 'pem' }).toString()).toBe(pem);
  }
  expect(() => normalizeGooglePrivateKey('not a key')).toThrow('BEGIN/END');
});
