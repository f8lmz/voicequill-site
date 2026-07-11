// VoiceQuill offline license signer (server side).
//
// Produces a key in the EXACT format the macOS app verifies (License.swift):
//     b64url(payloadJSON) + "." + b64url(ed25519Signature)
// where payloadJSON is {"n": name} or {"n": name, "exp": <unix-seconds int>}.
//
// The app verifies the signature against whatever bytes sit in the key, so JSON
// key order / spacing are irrelevant — only that we sign exactly the bytes we
// encode. Verified byte-compatible against `vqlicense.swift verify`.
//
// The private key is a 32-byte Ed25519 seed (CryptoKit rawRepresentation),
// base64, supplied via the VQ_PRIVATE_KEY env var. NEVER ship it to the client.

import * as ed from '@noble/ed25519';

function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function seedFromB64(b64) {
  const seed = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (seed.length !== 32) {
    throw new Error(`VQ_PRIVATE_KEY must decode to 32 bytes (got ${seed.length})`);
  }
  return seed;
}

/**
 * Mint a license key.
 * @param {string} privateSeedB64  base64 32-byte Ed25519 seed (VQ_PRIVATE_KEY)
 * @param {string} name            licensee name shown in the app
 * @param {number|null} expEpoch   expiry in unix seconds, or null for perpetual
 * @param {string|null} tier       "trial" | "plus" | "pro" (omitted if null)
 * @returns {Promise<string>} the license key
 *
 * Payload is {"n": name} plus optional integer "exp" and optional string "t"
 * (tier). The current shipped app reads only n/exp and ignores t, so tiered
 * keys stay valid today; a future app build enforces the per-tier limits.
 */
export async function mintKey(privateSeedB64, name, expEpoch = null, tier = null) {
  if (!privateSeedB64) throw new Error('VQ_PRIVATE_KEY is not set');
  const seed = seedFromB64(privateSeedB64);
  const payload = { n: name };
  if (expEpoch) payload.exp = Math.floor(expEpoch);
  if (tier) payload.t = tier;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await ed.signAsync(payloadBytes, seed); // 64-byte Uint8Array
  return b64url(payloadBytes) + '.' + b64url(sig);
}

/** Unix-seconds expiry `days` from now, end-of-day-ish (matches the CLI's +1 day − 1s feel). */
export function expiryInDays(days) {
  return Math.floor(Date.now() / 1000) + days * 86400;
}
