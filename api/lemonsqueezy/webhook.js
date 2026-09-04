// LemonSqueezy webhook → deliver a VoiceQuill license key by branded email (Resend).
//
// Two modes, chosen by the LICENSE_MODE env var, so we can cut over safely:
//
//   LICENSE_MODE = "ed25519"  (default, current)
//     Handles `order_created`: mints our own offline Ed25519 key and emails it.
//     Unlimited devices, no revocation — fine as a stopgap.
//
//   LICENSE_MODE = "lemonsqueezy"  (after cutover)
//     Handles `license_key_created`: LemonSqueezy generates the key (device-locked via
//     an activation limit, revocable); we just relay it in the same branded email.
//     Requires "license keys" enabled on the LS product.
//
// Cut over only once the app supports LS-key activation. Flip LICENSE_MODE the same
// moment you enable license keys on the product, so buyers never get both kinds of key.
//
// Env:
//   VQ_PRIVATE_KEY                 (ed25519 mode) base64 Ed25519 seed
//   LEMONSQUEEZY_WEBHOOK_SECRET    signing secret (both modes)
//   RESEND_API_KEY                 Resend key (both modes)
//   LEMONSQUEEZY_PLUS_VARIANT_ID   (ed25519 mode) variant → "plus"
//   LEMONSQUEEZY_PLUS_PRODUCT_ID   (lemonsqueezy mode) product → "plus"  (e.g. 1210583)
//   LEMONSQUEEZY_PRO_VARIANT_ID / LEMONSQUEEZY_PRO_PRODUCT_ID  (Pro)
//   LICENSE_MODE                   "ed25519" | "lemonsqueezy"  (default "ed25519")
//
// Plus→Pro upgrade discount (see maybeCreateUpgradeDiscount) also needs:
//   LEMONSQUEEZY_API_KEY           LS API key (Settings → API; shown once)
//   LEMONSQUEEZY_STORE_ID          numeric store id
//   LEMONSQUEEZY_PRO_VARIANT_ID    Pro variant (e.g. 2091613) — the discount is limited to it
//   LEMONSQUEEZY_PLUS_PRODUCT_ID   LIVE Plus product id — identifies Plus purchases to discount
// and the webhook must be subscribed to `license_key_created`.

import { mintKey } from '../_lib/license.js';

export const config = { runtime: 'edge' };

const DOWNLOAD_URL = 'https://www.voicequill.studio/api/download';

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
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
function tierForProduct(productId) {
  const p = String(productId ?? '');
  if (p && p === String(process.env.LEMONSQUEEZY_PLUS_PRODUCT_ID)) return 'plus';
  if (p && p === String(process.env.LEMONSQUEEZY_PRO_PRODUCT_ID)) return 'pro';
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

function nameFrom(attr) {
  return (attr.user_name || '').trim() || (attr.user_email ? attr.user_email.split('@')[0] : 'there');
}

// ─── Plus → Pro upgrade discount ───
// On a Plus purchase, mint a single-use, Pro-only €29 discount whose CODE is the
// buyer's license key (dashes removed, uppercased) — so /upgrade?key=… can derive
// the same code with no database. Dormant until all three env vars are set:
//   LEMONSQUEEZY_API_KEY · LEMONSQUEEZY_STORE_ID · LEMONSQUEEZY_PRO_VARIANT_ID
// and it only fires for the Plus product (LEMONSQUEEZY_PLUS_PRODUCT_ID). Idempotent:
// a retried webhook re-POSTs the same code and LS rejects the duplicate, which we swallow.
async function maybeCreateUpgradeDiscount(attr) {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const proVariantId = process.env.LEMONSQUEEZY_PRO_VARIANT_ID;
  if (!apiKey || !storeId || !proVariantId) return;        // feature off until configured
  if (tierForProduct(attr.product_id) !== 'plus') return;  // only Plus buyers get the Pro discount
  const licenseKey = attr.key;
  if (!licenseKey) return;

  const code = licenseKey.replace(/-/g, '').toUpperCase(); // 32 chars, A–Z/0–9 — valid LS code
  const body = {
    data: {
      type: 'discounts',
      attributes: {
        name: `Pro upgrade · ${attr.order_id ?? code.slice(0, 8)}`,
        code,
        amount: 2900,
        amount_type: 'fixed',
        is_limited_to_products: true,
        is_limited_redemptions: true,
        max_redemptions: 1,
        duration: 'once',
      },
      relationships: {
        store: { data: { type: 'stores', id: String(storeId) } },
        variants: { data: [{ type: 'variants', id: String(proVariantId) }] },
      },
    },
  };
  const r = await fetch('https://api.lemonsqueezy.com/v1/discounts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    // 422 mentioning the code = it already exists (a retried webhook) → done.
    if (r.status === 422 && /code/i.test(txt)) return;
    throw new Error(`discount create ${r.status} ${txt}`);
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = await req.text();
  const ok = await verifyLemon(raw, req.headers.get('x-signature'), process.env.LEMONSQUEEZY_WEBHOOK_SECRET);
  if (!ok) return new Response('Invalid signature', { status: 401 });

  let event;
  try { event = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }

  const eventName = event?.meta?.event_name;
  const attr = event?.data?.attributes || {};
  const mode = process.env.LICENSE_MODE || 'ed25519';

  try {
    // Plus → Pro upgrade discount — independent of key-delivery mode. No-op unless
    // configured and the purchase is Plus. Runs before delivery so a retry still reaches it.
    if (eventName === 'license_key_created') {
      await maybeCreateUpgradeDiscount(attr);
    }

    if (mode === 'lemonsqueezy') {
      // LS generated the key; relay it. Device-locked + revocable on the LS side.
      if (eventName !== 'license_key_created') return new Response('ignored', { status: 200 });
      const tier = tierForProduct(attr.product_id);
      if (!tier) return new Response('ignored (unmapped product)', { status: 200 });
      const key = attr.key;
      const email = attr.user_email;
      if (!key || !email) return new Response('missing key/email', { status: 200 });
      await sendKeyEmail(email, nameFrom(attr), key, tier);
      return new Response('ok', { status: 200 });
    }

    // default "ed25519": mint our own key on a paid order (current behaviour)
    if (eventName !== 'order_created') return new Response('ignored', { status: 200 });
    if (attr.status && attr.status !== 'paid') return new Response('ignored (unpaid)', { status: 200 });
    const tier = tierForVariant(attr?.first_order_item?.variant_id);
    if (tier !== 'plus' && tier !== 'pro') return new Response('ignored (unmapped product)', { status: 200 });
    const email = attr.user_email;
    if (!email) return new Response('no email on order', { status: 200 });
    const licenseKey = await mintKey(process.env.VQ_PRIVATE_KEY, nameFrom(attr), null, tier);
    await sendKeyEmail(email, nameFrom(attr), licenseKey, tier);
    return new Response('ok', { status: 200 });
  } catch (err) {
    return new Response(`error: ${err.message}`, { status: 500 }); // 500 → LS retries
  }
}
