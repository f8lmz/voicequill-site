// Self-serve trial: email → mint a limited 30-day trial key → email it (Resend).
//
// Replaces the old manual Formspree step. The key is our offline Ed25519 format with
// `t:"trial"` + a 30-day expiry; the app enforces the trial limits (3 voices, 3000 chars).
// Paid Plus/Pro keys go through the LemonSqueezy path instead — this is trial only.
//
// Env: VQ_PRIVATE_KEY, RESEND_API_KEY (both already set).
//      RESEND_AUDIENCE_ID (optional) — if set, opt-in emails are added to that Resend audience.

import { mintKey, expiryInDays } from '../_lib/license.js';

export const config = { runtime: 'edge' };

const DOWNLOAD_URL = 'https://github.com/f8lmz/voicequill-releases/releases/latest';
const ALLOWED_ORIGIN = 'https://voicequill.studio';

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function emailValid(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function trialEmailHtml(key) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#100E0B;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#F2EFE7;padding:32px 20px;">
  <div style="max-width:480px;margin:0 auto;">
    <div style="font-weight:900;font-size:26px;letter-spacing:-1px;margin-bottom:28px;">Voice<span style="color:#FE5530;">Quill</span></div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 12px;">Your free month starts now.</h1>
    <p style="color:#B8B3A8;font-size:15px;line-height:1.55;margin:0 0 24px;">Here&rsquo;s your trial key &mdash; good for 30 days. It runs entirely on your Mac: no account, nothing uploaded.</p>
    <div style="background:#1A1816;border:1px solid #2A2622;border-radius:12px;padding:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all;color:#F2EFE7;margin-bottom:24px;">${key}</div>
    <p style="color:#B8B3A8;font-size:15px;line-height:1.55;margin:0 0 8px;"><strong style="color:#F2EFE7;">To start:</strong></p>
    <ol style="color:#B8B3A8;font-size:15px;line-height:1.6;margin:0 0 24px;padding-left:20px;">
      <li>Download the app: <a href="${DOWNLOAD_URL}" style="color:#FE5530;">latest release</a></li>
      <li>Open VoiceQuill and paste the key above when prompted.</li>
    </ol>
    <p style="color:#B8B3A8;font-size:14px;line-height:1.55;margin:0 0 20px;">Your trial includes 3 voices and up to 3,000 characters per script. <a href="https://voicequill.studio/#pricing" style="color:#FE5530;">VoiceQuill Plus</a> unlocks all 10 voices with no cap &mdash; one payment, yours forever.</p>
    <p style="color:#6E6B63;font-size:13px;line-height:1.5;margin:0;">Questions? Just reply, or write to <a href="mailto:hello@voicequill.studio" style="color:#8C887F;">hello@voicequill.studio</a>.</p>
  </div></body></html>`;
}

async function sendTrialEmail(to, key) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'VoiceQuill <hello@voicequill.studio>',
      to,
      subject: 'Your VoiceQuill trial key',
      html: trialEmailHtml(key),
    }),
  });
  if (!r.ok) throw new Error(`Resend failed: ${r.status} ${await r.text()}`);
}

// Optional marketing opt-in — only when the visitor ticked "keep me posted".
async function addToAudience(email) {
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!audienceId) return;
  try {
    await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
  } catch (e) { /* non-fatal — the key email is what matters */ }
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Only accept requests from our own site (soft anti-abuse; absent origin allowed for testing).
  const origin = req.headers.get('origin');
  if (origin && origin !== ALLOWED_ORIGIN) return json({ error: 'forbidden' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  // Honeypot: bots tick the hidden box. Pretend success, do nothing.
  if (body.hp) return json({ ok: true, download: DOWNLOAD_URL }, 200);

  const email = (body.email || '').trim();
  if (!emailValid(email)) return json({ error: 'invalid email' }, 400);

  try {
    const key = await mintKey(process.env.VQ_PRIVATE_KEY, email, expiryInDays(30), 'trial');
    await sendTrialEmail(email, key);
    if (body.updates) await addToAudience(email);
    return json({ ok: true, download: DOWNLOAD_URL }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
