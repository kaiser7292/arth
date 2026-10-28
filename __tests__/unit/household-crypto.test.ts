import { randomBytes as nodeRandomBytes } from "node:crypto";

jest.mock("expo-crypto", () => {
  const c = require("node:crypto");
  return {
    getRandomBytes: (n: number) => new Uint8Array(c.randomBytes(n)),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: async (_alg: string, text: string) => c.createHash("sha256").update(text).digest("hex"),
  };
});

import {
  checkCode,
  envelopeKeyVersion,
  fromBase64,
  fromUtf8,
  inviteSecrets,
  newHouseholdKey,
  newId,
  newMemberKeys,
  openFrom,
  openOp,
  openWithSecret,
  relayToken,
  sealOp,
  sealTo,
  sealWithSecret,
  sha256Hex,
  toBase64,
  toBase64Url,
  utf8,
} from "../../services/household/crypto";

/** Household encryption (services/household/crypto.ts): what the relay sees must be useless to it. */

test("base64 and UTF-8 round-trip, including ₹ and emoji", () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33, 100]) {
    const b = new Uint8Array(nodeRandomBytes(n));
    expect(fromBase64(toBase64(b))).toEqual(b);
    expect(fromBase64(toBase64Url(b))).toEqual(b);
    expect(toBase64(b)).toBe(Buffer.from(b).toString("base64"));
  }
  const text = "₹2,300 · BigBasket 🥬 Groceries";
  expect(fromUtf8(utf8(text))).toBe(text);
  expect(Buffer.from(utf8(text)).toString("utf8")).toBe(text);
});

test("IDs are random and fit the relay's format", () => {
  const a = newId();
  expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(newId()).not.toBe(a);
});

describe("ops", () => {
  const key = newHouseholdKey();
  const author = newMemberKeys();
  const op = { v: 1, hh: "h", m: "m", seq: 1, body: { kind: "items.upsert", items: [{ id: "x", paid: 2300, merchant: "BigBasket" }] } };

  test("seal and open", () => {
    const blob = sealOp(op, key, 3, author.signSecret);
    expect(envelopeKeyVersion(blob)).toBe(3);
    expect(openOp(blob, key, author.signPublic)).toEqual(op);
  });

  test("the envelope gives nothing away", () => {
    const blob = sealOp(op, key, 1, author.signSecret);
    const raw = Buffer.from(fromBase64(blob)).toString("latin1");
    expect(raw).not.toContain("BigBasket");
    expect(raw).not.toContain("2300");
    // Same op twice → different bytes (random nonce).
    expect(sealOp(op, key, 1, author.signSecret)).not.toBe(blob);
  });

  test("a wrong key, a tampered byte or another signer is rejected", () => {
    const blob = sealOp(op, key, 1, author.signSecret);
    expect(openOp(blob, newHouseholdKey(), author.signPublic)).toBeNull();

    const bytes = fromBase64(blob);
    bytes[bytes.length - 5] ^= 1;
    expect(openOp(toBase64(bytes), key, author.signPublic)).toBeNull();

    // Another member holds the same household key but can't pass as the author.
    const other = newMemberKeys();
    const forged = sealOp(op, key, 1, other.signSecret);
    expect(openOp(forged, key, author.signPublic)).toBeNull();
  });
});

test("the relay token depends on the key and isn't the key", () => {
  const k1 = newHouseholdKey();
  const t = relayToken(k1);
  expect(t).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(relayToken(k1)).toBe(t);
  expect(relayToken(newHouseholdKey())).not.toBe(t);
  expect(fromBase64(t)).not.toEqual(k1);
});

test("invite: proof and key differ; the request opens only with the secret", () => {
  const secret = new Uint8Array(nodeRandomBytes(32));
  const s = inviteSecrets(secret);
  expect(s.proof).not.toBe(toBase64Url(s.key));
  const sealed = sealWithSecret({ name: "Aastha" }, s.key);
  expect(openWithSecret(sealed, s.key)).toEqual({ name: "Aastha" });
  expect(openWithSecret(sealed, inviteSecrets(new Uint8Array(32)).key)).toBeNull();
});

test("sealTo: only the receiver opens it, and it must come from the sender", () => {
  const inviter = newMemberKeys();
  const joiner = newMemberKeys();
  const sealed = sealTo({ key: "k" }, joiner.boxPublic, inviter.boxSecret);
  expect(openFrom(sealed, inviter.boxPublic, joiner.boxSecret)).toEqual({ key: "k" });
  const stranger = newMemberKeys();
  expect(openFrom(sealed, inviter.boxPublic, stranger.boxSecret)).toBeNull();
  expect(openFrom(sealed, stranger.boxPublic, joiner.boxSecret)).toBeNull();
});

test("check code: same on both phones, different if a key was swapped", () => {
  const secret = new Uint8Array(nodeRandomBytes(32));
  const inviter = newMemberKeys();
  const joiner = newMemberKeys();
  const code = checkCode(inviter.boxPublic, joiner.boxPublic, secret);
  expect(code).toMatch(/^\d{3} \d{3}$/);
  expect(checkCode(inviter.boxPublic, joiner.boxPublic, secret)).toBe(code);
  expect(checkCode(inviter.boxPublic, newMemberKeys().boxPublic, secret)).not.toBe(code);
});

test("sha256Hex matches the relay's", async () => {
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
