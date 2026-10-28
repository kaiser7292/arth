/**
 * Talks to the household relay (relay/src/worker.js). Only ever sends sealed envelopes, random IDs
 * and hashes; see crypto.ts.
 */

const TIMEOUT_MS = 15000;

export class RelayError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`Relay ${status} ${code}`);
  }
}

/** 0 = couldn't reach the relay at all (offline, timeout). */
export const isOffline = (e: unknown) => e instanceof RelayError && e.status === 0;

interface Call {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  token?: string;
  inviteProof?: string;
  body?: object;
}

async function call<T>(base: string, c: Call): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}${c.path}`, {
      method: c.method,
      headers: {
        ...(c.body ? { "content-type": "application/json" } : {}),
        ...(c.token ? { authorization: `Bearer ${c.token}` } : {}),
        ...(c.inviteProof ? { "x-invite-proof": c.inviteProof } : {}),
      },
      body: c.body ? JSON.stringify(c.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new RelayError(0, "offline");
  } finally {
    clearTimeout(timer);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or not JSON */
  }
  if (!res.ok) throw new RelayError(res.status, (data as { error?: string } | null)?.error ?? "error");
  return data as T;
}

export interface LogPage {
  ops: { m: string; seq: number; blob: string }[];
  more: boolean;
  ranges: Record<string, { min: number; max: number }>;
  heads: Record<string, number>;
}

export const relay = {
  createHousehold: (base: string, id: string, tokenHash: string) =>
    call<{ ok: true }>(base, { method: "POST", path: "/v1/households", body: { id, tokenHash } }),

  putOp: (base: string, token: string, hh: string, member: string, seq: number, blob: string) =>
    call<{ ok: true; duplicate: boolean }>(base, {
      method: "PUT",
      path: `/v1/h/${hh}/log/${member}/${seq}`,
      token,
      body: { blob },
    }),

  getLog: (base: string, token: string, hh: string, since: Record<string, number>) => {
    const s = Object.entries(since)
      .map(([m, n]) => `${m}:${n}`)
      .join(",");
    return call<LogPage>(base, { method: "GET", path: `/v1/h/${hh}/log${s ? `?since=${s}` : ""}`, token });
  },

  ack: (base: string, token: string, hh: string, member: string, cursors: Record<string, number>) =>
    call<{ ok: true }>(base, { method: "POST", path: `/v1/h/${hh}/ack`, token, body: { member, cursors } }),

  swapToken: (base: string, token: string, hh: string, tokenHash: string) =>
    call<{ ok: true }>(base, { method: "POST", path: `/v1/h/${hh}/token`, token, body: { tokenHash } }),

  deleteMember: (base: string, token: string, hh: string, member: string) =>
    call<{ ok: true }>(base, { method: "DELETE", path: `/v1/h/${hh}/member/${member}`, token }),

  closeHousehold: (base: string, token: string, hh: string) =>
    call<{ ok: true }>(base, { method: "DELETE", path: `/v1/h/${hh}`, token }),

  createInvite: (base: string, token: string, id: string, hh: string, proofHash: string) =>
    call<{ ok: true; expiresAt: number }>(base, { method: "POST", path: "/v1/invites", token, body: { id, hh, proofHash } }),

  postJoinRequest: (base: string, proof: string, inviteId: string, blob: string) =>
    call<{ ok: true }>(base, { method: "POST", path: `/v1/invites/${inviteId}/request`, inviteProof: proof, body: { blob } }),

  getJoinRequest: (base: string, token: string, inviteId: string) =>
    call<{ blob: string | null }>(base, { method: "GET", path: `/v1/invites/${inviteId}/request`, token }),

  postAccept: (base: string, token: string, inviteId: string, blob: string) =>
    call<{ ok: true }>(base, { method: "POST", path: `/v1/invites/${inviteId}/accept`, token, body: { blob } }),

  getAccept: (base: string, proof: string, inviteId: string) =>
    call<{ blob: string | null }>(base, { method: "GET", path: `/v1/invites/${inviteId}/accept`, inviteProof: proof }),

  declineInvite: (base: string, token: string, inviteId: string) =>
    call<{ ok: true }>(base, { method: "POST", path: `/v1/invites/${inviteId}/decline`, token }),
};
