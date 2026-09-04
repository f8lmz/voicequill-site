#!/usr/bin/env node
// One-off: give every EXISTING Plus customer their €29 Pro-upgrade discount + email
// the upgrade link. New buyers are handled automatically by the webhook; this covers
// people who bought Plus before the mechanism existed.
//
// Safe to re-run: a discount that already exists is skipped (LS 422), and we only
// email customers whose discount we created on THIS run.
//
// Usage (from the voicequill-site repo root):
//   DRY_RUN=1 \
//   LEMONSQUEEZY_API_KEY=... LEMONSQUEEZY_STORE_ID=... LEMONSQUEEZY_PRO_VARIANT_ID=2091613 \
//   LEMONSQUEEZY_PLUS_PRODUCT_ID=<live plus product id> RESEND_API_KEY=... \
//   node scripts/backfill-upgrade-discounts.mjs
//
// Review the DRY_RUN output first. Then re-run WITHOUT DRY_RUN to actually create
// discounts and send emails.

const {
  LEMONSQUEEZY_API_KEY: API_KEY,
  LEMONSQUEEZY_STORE_ID: STORE_ID,
  LEMONSQUEEZY_PRO_VARIANT_ID: PRO_VARIANT_ID,
  LEMONSQUEEZY_PLUS_PRODUCT_ID: PLUS_PRODUCT_ID,
  RESEND_API_KEY,
  DRY_RUN,
} = process.env;

const dry = !!DRY_RUN;
for (const [k, v] of Object.entries({ API_KEY, STORE_ID, PRO_VARIANT_ID, PLUS_PRODUCT_ID })) {
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
}
if (!dry && !RESEND_API_KEY) { console.error('Missing RESEND_API_KEY (needed to email; set DRY_RUN=1 to skip)'); process.exit(1); }

const LS = 'https://api.lemonsqueezy.com/v1';
const lsHeaders = {
  Authorization: `Bearer ${API_KEY}`,
  Accept: 'application/vnd.api+json',
  'Content-Type': 'application/vnd.api+json',
};

async function* plusLicenseKeys() {
  let url = `${LS}/license-keys?filter[store_id]=${STORE_ID}&page[size]=100&page[number]=1`;
  while (url) {
    const r = await fetch(url, { headers: lsHeaders });
    if (!r.ok) throw new Error(`list license-keys ${r.status} ${await r.text()}`);
    const json = await r.json();
    for (const row of json.data || []) {
      const a = row.attributes || {};
      if (String(a.product_id) === String(PLUS_PRODUCT_ID) && a.key && a.user_email) {
        yield { key: a.key, email: a.user_email, orderId: a.order_id, status: a.status };
      }
    }
    url = json.links && json.links.next ? json.links.next : null;
  }
}

async function createDiscount(key, orderId) {
  const code = key.replace(/-/g, '').toUpperCase();
  const body = {
    data: {
      type: 'discounts',
      attributes: {
        name: `Pro upgrade · ${orderId ?? code.slice(0, 8)}`,
        code, amount: 2900, amount_type: 'fixed',
        is_limited_to_products: true, is_limited_redemptions: true,
        max_redemptions: 1, duration: 'once',
      },
      relationships: {
        store: { data: { type: 'stores', id: String(STORE_ID) } },
        variants: { data: [{ type: 'variants', id: String(PRO_VARIANT_ID) }] },
      },
    },
  };
  const r = await fetch(`${LS}/discounts`, { method: 'POST', headers: lsHeaders, body: JSON.stringify(body) });
  if (r.ok) return 'created';
  const txt = await r.text();
  if (r.status === 422 && /code/i.test(txt)) return 'exists';
  throw new Error(`discount ${r.status} ${txt}`);
}

function emailHtml(link) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#100E0B;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#F2EFE7;padding:32px 20px;">
  <div style="max-width:480px;margin:0 auto;">
    <div style="font-weight:900;font-size:26px;letter-spacing:-1px;margin-bottom:28px;">Voice<span style="color:#FE5530;">Quill</span></div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 12px;">Your Pro upgrade — €29 off</h1>
    <p style="color:#B8B3A8;font-size:15px;line-height:1.55;margin:0 0 24px;">VoiceQuill Pro is here: 47 voices, seven languages, on-device Translate and two-voice Dialogue. As a Plus owner you get <strong>€29 off</strong> — Pro for €30. Your discount is built into your key.</p>
    <a href="${link}" style="display:inline-block;background:#FE5530;color:#100E0B;font-weight:700;font-size:15px;border-radius:999px;padding:14px 26px;text-decoration:none;">Upgrade to Pro</a>
    <p style="color:#6E6B63;font-size:13px;line-height:1.5;margin:24px 0 0;">One-time discount, single use — yours to keep or pass on. Questions? Just reply.</p>
  </div></body></html>`;
}

async function sendEmail(to, link) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VoiceQuill <hello@voicequill.studio>',
      to, subject: 'Your VoiceQuill Pro upgrade — €29 off', html: emailHtml(link),
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status} ${await r.text()}`);
}

let seen = 0, created = 0, existed = 0, emailed = 0;
for await (const { key, email, orderId } of plusLicenseKeys()) {
  seen++;
  const link = `https://www.voicequill.studio/upgrade?key=${encodeURIComponent(key)}`;
  if (dry) { console.log(`[dry] would discount+email ${email} (${orderId ?? '—'})`); continue; }
  const outcome = await createDiscount(key, orderId);
  if (outcome === 'created') {
    created++;
    await sendEmail(email, link);
    emailed++;
    console.log(`created + emailed ${email}`);
  } else {
    existed++;
    console.log(`skip (discount exists) ${email}`);
  }
}
console.log(`\nDone. Plus keys seen: ${seen} · discounts created: ${created} · already existed: ${existed} · emails sent: ${emailed}${dry ? ' (DRY RUN — nothing changed)' : ''}`);
