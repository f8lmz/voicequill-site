// LemonSqueezy webhook → mint a VoiceQuill license key → email it via Resend.
//
// LemonSqueezy is the merchant of record (it handles EU VAT). It's payment +
// trigger only — the app's offline Ed25519 licensing is unchanged. Runs on
// Vercel's Edge runtime for the raw request body (needed for HMAC verification).
//
// Required env vars (Vercel → Project → Settings → Environment Variables):
//   VQ_PRIVATE_KEY                base64 32-byte Ed25519 seed (the ROTATED key)
//   LEMONSQUEEZY_WEBHOOK_SECRET   signing secret set on the LS webhook
//   RESEND_API_KEY                Resend transactional email API key
//   LEMONSQUEEZY_PLUS_VARIANT_ID  variant id of VoiceQuill Plus → tier "plus" (perpetual)
// Optional (add when Pro ships):
//   LEMONSQUEEZY_PRO_VARIANT_ID   variant id of VoiceQuill Pro  → tier "pro"  (perpetual)

import { mintKey } from '../_lib/license.js';

export const config = { runtime: 'edge' };

const DOWNLOAD_URL = 'https://github.com/f8lmz/voicequill-releases/releases/latest';

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// LemonSqueezy signs the raw body: X-Signature = hex HMAC-SHA256(secret, rawBody).
async function verifyLemon(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return timingSafeEqual(toHex(mac), signatureHeader.trim());
}

function tierForVariant(variantId) {
  const v = String(variantId ?? '');
  if (v && v === String(process.env.LEMONSQUEEZY_PLUS_VARIANT_ID)) return 'plus';
  if (v && v === String(process.env.LEMONSQUEEZY_PRO_VARIANT_ID)) return 'pro';
  return null;
}

const TIER_LABEL = { plus: 'Plus', pro: 'Pro', trial: 'Trial' };

function keyEmailHtml(name, licenseKey, tier) {
  const label = TIER_LABEL[tier] || 'Plus';
  return `<!DOCTYPE html><html><body style="margin:0;background:#100E0B;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#F2EFE7;padding:32px 20px;">
  <div style="max-width:480px;margin:0 auto;">
    <div style="font-weight:900;font-size:26px;letter-spacing:-1px;margin-bottom:28px;">Voice<span style="color:#FE5530;">Quill</span></div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 12px;">You&rsquo;re in, ${name}.</h1>
    <p style="color:#B8B3A8;font-size:15px;line-height:1.55;margin:0 0 24px;">Thanks for buying VoiceQuill ${label}. Here&rsquo;s your license key &mdash; yours forever, no subscription, no account.</p>
    <div style="background:#1A1816;border:1px solid #2A2622;border-radius:12px;padding:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all;color:#F2EFE7;margin-bottom:24px;">${licenseKey}</div>
    <p style="color:#B8B3A8;font-size:15px;line-height:1.55;margin:0 0 8px;"><strong style="color:#F2EFE7;">To activate:</strong></p>
    <ol style="color:#B8B3A8;font-size:15px;line-height:1.6;margin:0 0 24px;padding-left:20px;">
      <li>Download the app: <a href="${DOWNLOAD_URL}" style="color:#FE5530;">latest release</a></li>
      <li>Open VoiceQuill and paste the key above when prompted.</li>
    </ol>
    <p style="color:#6E6B63;font-size:13px;line-height:1.5;margin:0;">Keep this email &mdash; it&rsquo;s your proof of purchase. Questions? Just reply, or write to <a href="mailto:hello@voicequill.studio" style="color:#8C887F;">hello@voicequill.studio</a>.</p>
  </div></body></html>`;
}

async function sendKeyEmail(to, name, licenseKey, tier) {
  const label = TIER_LABEL[tier] || 'Plus';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'VoiceQuill <hello@voicequill.studio>',
      to,
      subject: `Your VoiceQuill ${label} license key`,
      html: keyEmailHtml(name, licenseKey, tier),
    }),
  });
  if (!r.ok) throw new Error(`Resend failed: ${r.status} ${await r.text()}`);
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = await req.text();
  const ok = await verifyLemon(
    raw,
    req.headers.get('x-signature'),
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  );
  if (!ok) return new Response('Invalid signature', { status: 401 });

  let event;
  try { event = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }

  if (event?.meta?.event_name !== 'order_created') {
    return new Response('ignored', { status: 200 });
  }
  const attr = event?.data?.attributes || {};
  if (attr.status && attr.status !== 'paid') {
    return new Response('ignored (unpaid)', { status: 200 });
  }

  const tier = tierForVariant(attr?.first_order_item?.variant_id);
  if (tier !== 'plus' && tier !== 'pro') {
    return new Response('ignored (unmapped product)', { status: 200 });
  }

  const email = attr.user_email;
  const name = (attr.user_name || '').trim() || (email ? email.split('@')[0] : 'there');
  if (!email) return new Response('no email on order', { status: 200 });

  try {
    const licenseKey = await mintKey(process.env.VQ_PRIVATE_KEY, name, null, tier); // perpetual
    await sendKeyEmail(email, name, licenseKey, tier);
  } catch (err) {
    // 500 → LemonSqueezy retries the webhook.
    return new Response(`error: ${err.message}`, { status: 500 });
  }
  return new Response('ok', { status: 200 });
}
