# Website update plan — move Plus to LemonSqueezy license keys

Context: Plus is switching from our server-minted Ed25519 keys to **LS-issued license keys**
with an **activation limit of 2** (device-locked, revocable) to stop key leaks. App-chat spec:
`~/Developer/voicequill-v2/HANDOVER_ls-licensing.md`. This is the website side.

## 1. Key delivery — the backend changes
Today `api/lemonsqueezy/webhook.js` mints an Ed25519 key on `order_created` and emails it.
With LS license keys enabled, **LS generates the key** — we stop minting for Plus. Two ways to
deliver it:

- **(Recommended) Keep our branded email, relay the LS key.** Switch the webhook to the
  **`license_key_created`** event, read the LS key string from the payload
  (`data.attributes.key`) + buyer email, and send it via Resend using our existing template.
  Keeps the on-brand email; drops the Ed25519 mint for Plus.
- **(Simplest) Let LS email it.** Enable LS's own license-key delivery email and remove our
  webhook email entirely. Less branded, zero code.

Either way, `api/_lib/license.js` (the Ed25519 signer) stays — it's still used for the **trial**
funnel (Phase 2).

> ⚠️ Confirm which webhook event carries the key string in current LS docs before wiring
> (`license_key_created` vs the key being embedded in `order_created`).

## 2. Marketing copy — make the flow clear (Felix's requirement)
With the **one-app** model (recommended), the site stays simple but must make the upgrade path
obvious so nobody thinks they need a second download:

- **Trial card:** "Download free trial" (unchanged).
- **Plus card:** "Get Plus — €39" → checkout → **"We email you a license key — enter it in the
  app to unlock everything."**
- Add one clarifying line near pricing / in the post-purchase email:
  *"Already running the trial? Plus unlocks the very same app — just enter your new key. No
  re-download."*
- If Felix instead chooses **two separate apps**, the Plus flow must say:
  *"After purchase, download the Plus app and enter your key"* — with a distinct download button
  and a clear label on each download so trial vs Plus is unmistakable.

## 3. Do NOT communicate the device limit
Per Felix: the **2-device** allowance is **not** mentioned anywhere on the site or pre-activation.
It only appears in-app after a key is registered ("Device 1/2 registered", Settings "Devices 1/2").
So: no "2 devices" text on the pricing card or checkout.

## 4. Sequencing (don't break the Plus sales that just went live)
1. App-chat ships app build with LS activation support (accepts LS keys; still accepts existing
   Ed25519 keys as legacy full access).
2. Felix enables **license keys + activation limit 2** on the LS Plus product.
3. Website: switch the webhook to relay the LS key (stop minting Ed25519 for Plus) + update copy.
4. The handful of Ed25519 Plus keys sold pre-switch keep working (app still accepts them) — no
   migration needed.

## 5. Still separate: Phase 2 trial funnel
Unchanged by this: build `/api/license/trial` (offline Ed25519, `t:trial` + 30-day exp) and
repoint the download modal off Formspree. Trials don't use LS licensing.
