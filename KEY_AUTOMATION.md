# VoiceQuill — Automated key generation (LemonSqueezy)

**Goal:** a customer buys **VoiceQuill Plus (€39)** via LemonSqueezy → a perpetual, tiered
license key is minted server-side and emailed automatically. No manual minting.

**LemonSqueezy is the merchant of record — it handles EU VAT for you.** It's payment + trigger
only; the app's offline Ed25519 licensing is unchanged. The server reproduces
`vqlicense.swift`'s key format, now with a tier field. Verified byte-compatible against the
app's real verifier; the HMAC signature check is unit-tested (accepts valid, rejects
tampered / wrong-secret).

```
Buyer → LemonSqueezy checkout → order_created webhook → /api/lemonsqueezy/webhook (Edge)
      → verify X-Signature (HMAC) → map variant id → tier → mint perpetual key → Resend email
```

## Products & tiers
| Product | Price | Sold via | Key tier | App limits (enforced later) |
|---|---|---|---|---|
| VoiceQuill – Trial | Free | free download (email-gated) | `trial` | 3000 chars, top-3 voices |
| **VoiceQuill Plus** | **€39** | **LemonSqueezy (this integration)** | `plus` | none |
| VoiceQuill Pro | €59 | LemonSqueezy (later) | `pro` | — |

The key payload carries an optional `"t"` field (`"plus"`/`"pro"`/`"trial"`). The **current
shipped app ignores it** (still validates), so Plus keys work today with full features.
Enforcing trial limits is app-build work — see the app-chat handover, Task 5.

## Files (in this repo)
- `api/_lib/license.js` — signer: `mintKey(seed, name, expEpoch|null, tier|null)`.
- `api/lemonsqueezy/webhook.js` — LemonSqueezy webhook (Vercel **Edge**). Manual HMAC verify, no SDK.
- `package.json` — `@noble/ed25519` dependency.

---

## PREREQUISITE — rotate the keypair (app-chat task)
The old private key was exposed in chat, so it can't sign paid keys. The app-build chat runs
`HANDOVER_keypair-rotation.md` (in ~/Developer/voicequill-v2): mint a new pair, make
`License.swift` accept both old+new public keys, release. It hands back the **new PRIVATE key**
→ that becomes `VQ_PRIVATE_KEY` here.

---

## LemonSqueezy setup (Felix, app.lemonsqueezy.com)
1. **Store + product:** VoiceQuill Plus, €39, one-time. Note the **variant id** (Products →
   the product → the variant; the numeric id, e.g. `123456`).
2. **Checkout link:** copy the product's hosted checkout/buy URL → send me (I wire it to the
   Plus button on the site). Keep email collection on (LS collects it by default).
3. **Webhook:** Settings → Webhooks → add:
   - URL: `https://voicequill.studio/api/lemonsqueezy/webhook`
   - Signing secret: any long random string → this becomes `LEMONSQUEEZY_WEBHOOK_SECRET`
   - Events: at least **`order_created`**
4. VAT/invoicing is handled by LemonSqueezy as MoR — nothing for you to file.

## Resend setup (Felix)
- Verify the `voicequill.studio` domain (I'll give the Cloudflare DNS records), create an API key.
- Sender is `hello@voicequill.studio` — must be allowed on the verified domain.

## Vercel env vars (Production)
| Name | Value |
|---|---|
| `VQ_PRIVATE_KEY` | new base64 Ed25519 seed (from the app-chat rotation) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | the signing secret from the webhook |
| `LEMONSQUEEZY_PLUS_VARIANT_ID` | the Plus variant id (step 1) |
| `RESEND_API_KEY` | Resend key |
| `LEMONSQUEEZY_PRO_VARIANT_ID` | *(later, when Pro ships)* |

---

## Deploy note (watch the first functions deploy)
This repo was pure-static. Committing `package.json` + `api/` turns on Vercel functions. Confirm
after the first push: (a) the homepage still loads, (b) `POST /api/lemonsqueezy/webhook` returns
**401** for an unsigned request. If static serving breaks, we add a small `vercel.json` — ping me.

## Testing (LemonSqueezy test mode)
1. LS has a **test mode** — make a test purchase of Plus.
2. Confirm: webhook 200, email arrives with a key, key unlocks the app as "Licensed to: <name>".
3. Unsigned check: `curl -X POST https://voicequill.studio/api/lemonsqueezy/webhook` → **401**.

## Go-live ordering (hard rule)
**App released trusting the new public key → set Vercel env → enable the LemonSqueezy webhook.**
Otherwise a buyer gets a key the shipped app can't validate.

## Known limitations (fine for launch)
- **Duplicate webhooks:** LS retries. Minted key is deterministic (same buyer → same key), so
  retries are harmless bar a possible duplicate email. Real dedupe = a ledger (later).
- **No revocation:** offline keys can't be killed remotely — the trade for staying fully local.

## Phase 2 (next) — self-serve trial keys on download
Repoint the download modal from Formspree to `/api/license/trial` (same signer,
`mintKey(seed, name, expiryInDays(30), 'trial')`), email a 1-month `trial` key, return the `.zip`.
Dedupe by email. Trial limits (3000 chars / top-3 voices) are enforced app-side.
