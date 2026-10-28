import nacl from "tweetnacl";
import * as Crypto from "expo-crypto";

/**
 * Household encryption: everything a phone sends through the relay is sealed here, so the relay
 * (and anyone between) only ever sees opaque bytes. Design: docs/HOUSEHOLD_PHASE1_DESIGN.md §4.
 *
 *   household key   32 random bytes, shared by the household's phones; seals every op
 *   member keys     X25519 (receives keys) + Ed25519 (signs ops), one pair each per member
 *   relay token     derived from the household key; the relay keeps only its hash
 *   invite secret   32 random bytes in the QR / link fragment; never sent to the relay
 *
 * tweetnacl: secretbox = XSalsa20-Poly1305, box = X25519 + XSalsa20-Poly1305, sign = Ed25519.
 * Keyed values are derived as SHA-512(label ‖ secret), cut to 32 bytes: a distinct label per use, so
 * no derived value reveals another.
 */

// tweetnacl looks for crypto.getRandomValues, which React Native doesn't have: use the OS's.
nacl.setPRNG((out: Uint8Array, n: number) => {
  out.set(Crypto.getRandomBytes(n));
});

export const ENVELOPE_VERSION = 1;

// ─── Encoding ───

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (/[^A-Za-z0-9+/]/.test(clean)) throw new Error("Not base64");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

export const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export function fromUtf8(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let c: number;
    if (b < 0x80) c = b;
    else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    out += String.fromCodePoint(c);
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** SHA-512(label ‖ secret), first 32 bytes. */
function derive(label: string, secret: Uint8Array): Uint8Array {
  return nacl.hash(concat(utf8(label), secret)).subarray(0, 32);
}

// ─── Keys and IDs ───

export const randomBytes = (n: number) => nacl.randomBytes(n);

/** A random ID the relay accepts: 22 characters of base64url. */
export const newId = () => toBase64Url(nacl.randomBytes(16));

export const newHouseholdKey = () => nacl.randomBytes(32);

export interface MemberKeys {
  boxPublic: string;
  boxSecret: string;
  signPublic: string;
  signSecret: string;
}

export function newMemberKeys(): MemberKeys {
  const box = nacl.box.keyPair();
  const sign = nacl.sign.keyPair();
  return {
    boxPublic: toBase64(box.publicKey),
    boxSecret: toBase64(box.secretKey),
    signPublic: toBase64(sign.publicKey),
    signSecret: toBase64(sign.secretKey),
  };
}

/** What a phone shows the relay to use the household's mailbox. */
export const relayToken = (householdKey: Uint8Array) => toBase64Url(derive("arth-relay-token-v1", householdKey));

// ─── Ops: sign, then seal ───

/** Layout: [version 1 byte][key version 4 bytes BE][nonce 24][secretbox(signed op)]. */
export function sealOp(op: object, householdKey: Uint8Array, keyVersion: number, signSecret: string): string {
  const signed = nacl.sign(utf8(JSON.stringify(op)), fromBase64(signSecret));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const header = new Uint8Array(5);
  header[0] = ENVELOPE_VERSION;
  new DataView(header.buffer).setUint32(1, keyVersion);
  return toBase64(concat(header, nonce, nacl.secretbox(signed, nonce, householdKey)));
}

/** The key version an envelope was sealed with, to pick the right household key. */
export function envelopeKeyVersion(blob: string): number {
  const bytes = fromBase64(blob);
  if (bytes.length < 5 + 24 || bytes[0] !== ENVELOPE_VERSION) throw new Error("Unknown envelope");
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(1);
}

/**
 * Opens and verifies an op. Returns null when it doesn't decrypt with this key or wasn't signed by
 * `signPublic` (tampered, forged, or a key this phone doesn't have).
 */
export function openOp<T = unknown>(blob: string, householdKey: Uint8Array, signPublic: string): T | null {
  const bytes = fromBase64(blob);
  if (bytes.length < 5 + 24 || bytes[0] !== ENVELOPE_VERSION) return null;
  const nonce = bytes.subarray(5, 29);
  const signed = nacl.secretbox.open(bytes.subarray(29), nonce, householdKey);
  if (!signed) return null;
  const message = nacl.sign.open(signed, fromBase64(signPublic));
  if (!message) return null;
  try {
    return JSON.parse(fromUtf8(message)) as T;
  } catch {
    return null;
  }
}

// ─── Invites ───

export interface InviteSecrets {
  /** Shown to the relay so it lets the joining phone post its request and collect the answer. */
  proof: string;
  /** Seals the join request, so the relay can't read who is joining. */
  key: Uint8Array;
}

export function inviteSecrets(secret: Uint8Array): InviteSecrets {
  return { proof: toBase64Url(derive("arth-invite-proof-v1", secret)), key: derive("arth-invite-key-v1", secret) };
}

export function sealWithSecret(data: object, key: Uint8Array): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return toBase64(concat(nonce, nacl.secretbox(utf8(JSON.stringify(data)), nonce, key)));
}

export function openWithSecret<T = unknown>(blob: string, key: Uint8Array): T | null {
  const bytes = fromBase64(blob);
  const opened = nacl.secretbox.open(bytes.subarray(24), bytes.subarray(0, 24), key);
  if (!opened) return null;
  try {
    return JSON.parse(fromUtf8(opened)) as T;
  } catch {
    return null;
  }
}

/** Seals data so only the holder of `toBoxPublic` can open it, and they know it came from us. */
export function sealTo(data: object, toBoxPublic: string, fromBoxSecret: string): string {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const sealed = nacl.box(utf8(JSON.stringify(data)), nonce, fromBase64(toBoxPublic), fromBase64(fromBoxSecret));
  return toBase64(concat(nonce, sealed));
}

export function openFrom<T = unknown>(blob: string, fromBoxPublic: string, toBoxSecret: string): T | null {
  const bytes = fromBase64(blob);
  const opened = nacl.box.open(bytes.subarray(24), bytes.subarray(0, 24), fromBase64(fromBoxPublic), fromBase64(toBoxSecret));
  if (!opened) return null;
  try {
    return JSON.parse(fromUtf8(opened)) as T;
  } catch {
    return null;
  }
}

/**
 * The 6-digit code both phones show while joining ("482 913"). It mixes both phones' keys with the
 * invite secret, so if anyone swapped a key in between, the two screens show different codes.
 */
export function checkCode(inviterBoxPublic: string, joinerBoxPublic: string, secret: Uint8Array): string {
  const h = nacl.hash(concat(utf8("arth-check-code-v1"), fromBase64(inviterBoxPublic), fromBase64(joinerBoxPublic), secret));
  const n = new DataView(h.buffer, h.byteOffset).getUint32(0) % 1_000_000;
  const s = n.toString().padStart(6, "0");
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

/** SHA-256 hex, which is how the relay stores tokens and proofs. */
export async function sha256Hex(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
}
