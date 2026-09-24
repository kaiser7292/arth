// Pure-JS TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30s).
// No external dependency — works on Hermes without crypto.subtle.

const PERIOD_SECONDS = 30;

function base32Decode(secret: string): Uint8Array {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = secret.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0, cur = 0;
  const bytes: number[] = [];
  for (const ch of s) {
    const idx = ALPHA.indexOf(ch);
    if (idx === -1) continue;
    cur = (cur << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((cur >> bits) & 0xff); }
  }
  return new Uint8Array(bytes);
}

function sha1(data: Uint8Array): Uint8Array {
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const len = data.length;
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLen = len * 8;
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
  dv.setUint32(paddedLen - 4, bitLen >>> 0, false);
  const w = new Uint32Array(80);
  for (let i = 0; i < paddedLen; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 80; j++) {
      const x = w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16];
      w[j] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if      (j < 20) { f = (b & c) | (~b & d);           k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d;                    k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else             { f = b ^ c ^ d;                    k = 0xca62c1d6; }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const result = new Uint8Array(20);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, h0, false); rv.setUint32(4, h1, false); rv.setUint32(8, h2, false);
  rv.setUint32(12, h3, false); rv.setUint32(16, h4, false);
  return result;
}

function hmacSha1(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const BLOCK = 64;
  const k = key.length > BLOCK ? sha1(key) : key;
  const kPad = new Uint8Array(BLOCK);
  kPad.set(k);
  const iPad = kPad.map(b => b ^ 0x36);
  const oPad = kPad.map(b => b ^ 0x5c);
  const inner = new Uint8Array(BLOCK + msg.length);
  inner.set(iPad); inner.set(msg, BLOCK);
  const outer = new Uint8Array(BLOCK + 20);
  outer.set(oPad); outer.set(sha1(inner), BLOCK);
  return sha1(outer);
}

export function generateTOTP(secret: string, nowMs: number = Date.now()): string {
  const key = base32Decode(secret);
  const counter = Math.floor(nowMs / 1000 / PERIOD_SECONDS);
  const msg = new Uint8Array(8);
  const cv = new DataView(msg.buffer);
  cv.setUint32(0, Math.floor(counter / 0x100000000) >>> 0, false);
  cv.setUint32(4, counter >>> 0, false);
  const hash = hmacSha1(key, msg);
  const offset = hash[19] & 0x0f;
  const dv = new DataView(hash.buffer, offset, 4);
  const code = (dv.getUint32(0, false) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export function totpSecondsRemaining(nowMs: number = Date.now()): number {
  return PERIOD_SECONDS - (Math.floor(nowMs / 1000) % PERIOD_SECONDS);
}

/** True when the string decodes to a usable base32 key (at least 80 bits). */
export function isValidTotpSecret(secret: string): boolean {
  const s = secret.toUpperCase().replace(/[\s=]/g, '');
  return /^[A-Z2-7]+$/.test(s) && base32Decode(s).length >= 10;
}
