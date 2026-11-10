// Mints a Drive-scoped access token from the service account in the environment, using the
// same JWT-bearer flow as agent/lib/google-drive.ts. Prints only the token on stdout.
import { createSign } from 'node:crypto';

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const raw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
if (!email || !raw) {
  console.error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not set');
  process.exit(2);
}

const b64u = (v) => Buffer.from(v).toString('base64url');
const pem = raw.replace(/\\n/g, '\n').trim();
const m = pem.match(/^-----BEGIN PRIVATE KEY-----([\s\S]+)-----END PRIVATE KEY-----$/);
if (!m) {
  console.error('Private key is missing BEGIN/END PRIVATE KEY markers');
  process.exit(2);
}
const key = `-----BEGIN PRIVATE KEY-----\n${m[1].replace(/\s/g, '').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;

const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({
  iss: email,
  scope: 'https://www.googleapis.com/auth/drive',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
}))}`;
const assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url')}`;

const resp = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
});
const body = await resp.json().catch(() => ({}));
if (!resp.ok || body.token_type !== 'Bearer' || typeof body.access_token !== 'string') {
  console.error(`Google token endpoint failed: HTTP ${resp.status} ${body.error ?? ''} ${body.error_description ?? ''}`);
  process.exit(1);
}
process.stdout.write(body.access_token);
