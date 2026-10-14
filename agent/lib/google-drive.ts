import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import TurndownService from 'turndown';
import { markdownToHtml } from './markdown.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quill's Google integration
//
// Reads and writes use the Google Drive API authenticated as a service account.
// Enable Drive API and share private source docs/folders with that account.
// Credentials: GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
// or GOOGLE_APPLICATION_CREDENTIALS pointing to a service-account JSON key locally.
// Optional, purely organizational (every new doc is shared "anyone with the link can edit"
// on creation regardless, so this isn't required for access):
//   GOOGLE_DRIVE_FOLDER_ID              — files new docs under this Drive folder ID
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Exchange the service account's credentials for a short-lived Drive API
 * access token (JWT-bearer flow), signing the assertion with node:crypto —
 * no googleapis/google-auth-library dependency, matching the hand-rolled
 * fetch clients used elsewhere in this repo (wordpress.ts, confluence.ts, jira.ts).
 */
interface ServiceAccountCredentials {
  email: string;
  privateKey: string;
}

/**
 * Resolve service-account credentials from either the plain string env vars
 * (required for the deployed container) or a local GOOGLE_APPLICATION_CREDENTIALS
 * JSON key file (local-dev convenience, matching Google's own ADC convention).
 */
export function normalizeGooglePrivateKey(raw: string): string {
  const decoded = raw.replace(/\\n/g, '\n').trim();
  const match = decoded.match(/^-----BEGIN PRIVATE KEY-----([\s\S]+)-----END PRIVATE KEY-----$/);
  if (!match) throw new Error('Google service-account private key must contain BEGIN/END PRIVATE KEY markers.');
  const body = match[1].replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new Error('Google service-account private key contains invalid PEM data.');
  }
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

function resolveServiceAccountCredentials(): ServiceAccountCredentials {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email && rawKey) {
    return { email, privateKey: normalizeGooglePrivateKey(rawKey) };
  }

  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credsPath) {
    let parsed: { type?: string; client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(readFileSync(credsPath, 'utf8'));
    } catch (e) {
      throw new Error(
        `Could not read GOOGLE_APPLICATION_CREDENTIALS at "${credsPath}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS at "${credsPath}" is not a service account key file.`);
    }
    return { email: parsed.client_email, privateKey: normalizeGooglePrivateKey(parsed.private_key) };
  }

  throw new Error(
    'Google Drive not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (required for deploy) or GOOGLE_APPLICATION_CREDENTIALS pointing at a service account JSON key file (local dev only) via `ast project configure` (locally) or `ast secrets create` (for deploy).',
  );
}

async function getGoogleAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const { email, privateKey } = resolveServiceAccountCredentials();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: email,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google token exchange failed: HTTP ${resp.status} — ${err.slice(0, 500)}`);
  }
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read a Google Doc using authenticated Drive API requests
// ─────────────────────────────────────────────────────────────────────────────

const DOC_ID_RE = /(?:\/document\/d\/|\/file\/d\/|[?&]id=)([a-zA-Z0-9_-]{15,})/;
const RAW_ID_RE = /^[a-zA-Z0-9_-]{15,}$/;

export function extractGoogleDocId(input: string): string {
  const m = input.match(DOC_ID_RE);
  if (m) return m[1];
  if (RAW_ID_RE.test(input.trim())) return input.trim();
  throw new Error(
    `Could not extract a Google Doc ID from "${input.slice(0, 80)}". Paste the full Google Docs URL.`,
  );
}

export interface FetchedGoogleDoc {
  docId: string;
  title: string;
  markdown: string;
  sourceUrl: string;
  charCount: number;
}

function unwrapGoogleRedirects(markdown: string): string {
  return markdown.replace(/https:\/\/www\.google\.com\/url\?q=([^&\s)]+)[^)\s]*/g, (_m, q) => {
    try {
      return decodeURIComponent(q);
    } catch {
      return q;
    }
  });
}

async function driveRead(docId: string, suffix: string, token: string): Promise<Response> {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.ok) return resp;
  const payload = await resp.json().catch(() => ({})) as {
    error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
  };
  const reasons = [...(payload.error?.errors ?? []), ...(payload.error?.details ?? [])]
    .map(e => e.reason ?? '').join(' ');
  const detail = payload.error?.message ?? '';
  let guidance: string;
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reasons) || /API.*(disabled|not.*used)/i.test(detail)) {
    guidance = 'Enable the Google Drive API in the service account Google Cloud project.';
  } else if (resp.status === 401) {
    guidance = 'Google rejected the credentials. Check the configured service-account key.';
  } else if (resp.status === 429 || /rateLimit|quota/i.test(reasons)) {
    guidance = 'Google rate or quota limit reached. Try again later.';
  } else if (resp.status === 403 || resp.status === 404) {
    const { email } = resolveServiceAccountCredentials();
    guidance = `Check the document ID and share the document or its parent folder with ${email} as Viewer. ` +
      'Public link sharing is not required. If already shared, check Workspace policies and download/export restrictions.';
  } else {
    guidance = 'Check the Google Drive API response and try again after resolving the error.';
  }
  throw new Error(`Google Drive read failed: HTTP ${resp.status}. ${guidance}${detail ? ` Google: ${detail.slice(0, 300)}` : ''}`);
}

/** Fallback title source when the Drive API lookup isn't available/fails: the first H1/H2 in the converted markdown. */
function titleFromMarkdown(markdown: string): string | null {
  const m = markdown.match(/^#{1,2}\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * Read a Google Doc and return its contents as markdown. Mirrors
 * readConfluencePage's shape so callers can treat both sources the same way.
 */
export async function readGoogleDoc(urlOrId: string): Promise<FetchedGoogleDoc> {
  const docId = extractGoogleDocId(urlOrId);
  console.log(`[google-drive] read ${docId}`);

  const token = await getGoogleAccessToken();
  const metadataResponse = await driveRead(docId, '?fields=name,mimeType&supportsAllDrives=true', token);
  const metadata = await metadataResponse.json() as { name?: string; mimeType?: string };
  if (metadata.mimeType !== 'application/vnd.google-apps.document') {
    throw new Error(`This file is ${metadata.mimeType ?? 'an unknown type'}. read_google_doc supports Google Docs only.`);
  }
  const exportResponse = await driveRead(docId, '/export?mimeType=text%2Fhtml', token);
  const html = await exportResponse.text();
  const driveTitle = metadata.name?.trim();

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  const markdown = unwrapGoogleRedirects(turndown.turndown(html).trim());

  const title = driveTitle ?? titleFromMarkdown(markdown) ?? 'Untitled';

  return {
    docId,
    title,
    markdown,
    sourceUrl: `https://docs.google.com/document/d/${docId}/edit`,
    charCount: markdown.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create a Google Doc (requires the service account)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateGoogleDocParams {
  title: string;
  markdown: string;
  folderId?: string;
}

export interface CreatedGoogleDoc {
  docId: string;
  title: string;
  docUrl: string;
  /** Whether the "anyone with the link can edit" permission was applied. */
  shared: boolean;
  /** Set when sharing failed — the doc still exists, but may only be visible to the service account. */
  shareWarning?: string;
}

/**
 * Grant "anyone with the link can edit" on a Drive file, best-effort. Without
 * this (or a shared destination folder), a file created by the service account
 * would only be visible to the service account itself — nobody else could open
 * the link. Never throws; failures are reported back to the caller instead.
 */
async function shareFileWithAnyone(fileId: string, token: string): Promise<{ shared: boolean; warning?: string }> {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'writer' }),
  });
  if (resp.ok) return { shared: true };
  const err = await resp.text();
  console.log(`[google-drive] sharing ${fileId} failed: HTTP ${resp.status} — ${err.slice(0, 300)}`);
  return {
    shared: false,
    warning: `Created the doc, but couldn't make it link-shareable (HTTP ${resp.status}) — it may only be visible to the service account. Share it manually from Drive, or set GOOGLE_DRIVE_FOLDER_ID to a pre-shared folder.`,
  };
}

/**
 * Create a new Google Doc via a Drive API multipart upload, then share it as
 * "anyone with the link can edit" so the requester can actually open it.
 * `folderId` (GOOGLE_DRIVE_FOLDER_ID by default) is purely organizational —
 * sharing no longer depends on it. Drive auto-converts the HTML body into
 * native Google Docs formatting.
 */
export async function createGoogleDoc(params: CreateGoogleDocParams): Promise<CreatedGoogleDoc> {
  const token = await getGoogleAccessToken();
  const folderId = params.folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID;
  console.log(`[google-drive] create "${params.title}"${folderId ? ` in folder ${folderId}` : ''}`);

  const html = await markdownToHtml(params.markdown);

  const metadata: Record<string, unknown> = {
    name: params.title,
    mimeType: 'application/vnd.google-apps.document',
  };
  if (folderId) metadata.parents = [folderId];

  const boundary = `quill-${Date.now()}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n` +
    `--${boundary}--`;

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google Drive create failed: HTTP ${resp.status} — ${err.slice(0, 500)}`);
  }
  const file = (await resp.json()) as { id: string; name: string; webViewLink?: string };
  const { shared, warning } = await shareFileWithAnyone(file.id, token);

  return {
    docId: file.id,
    title: file.name,
    docUrl: file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`,
    shared,
    ...(warning ? { shareWarning: warning } : {}),
  };
}
