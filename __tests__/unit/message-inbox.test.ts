jest.mock("@/services/sms/sms-orchestrator", () => ({ runSmsScan: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: {} }));
const mockStore = new Map<string, string | boolean>();
jest.mock("@/services/storage", () => ({
  settingsStorage: {
    getString: (k: string) => mockStore.get(k) as string | undefined,
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    set: (k: string, v: string | boolean) => void mockStore.set(k, v),
  },
}));
import {
  getLastArrival,
  getMessageStats,
  isArrivalNotifyOn,
  markArrivalSeen,
  parseInbox,
  recordArrival,
} from "../../services/message-inbox";
import type { RawSMS } from "../../services/sms/sms-reader";

describe("parseInbox (bank messages from the iPhone Shortcuts action)", () => {
  it("reads one message per line, with its sender and time", () => {
    const text = [
      JSON.stringify({ body: "Rs.450.00 debited from A/c XX1234 on 21-10-26 to VPA swiggy@axis. Ref 629412345678", sender: "JD-HDFCBK", receivedAt: 1792700000000 }),
      JSON.stringify({ body: "INR 2,500 credited to A/c XX9304", sender: "", receivedAt: 1792700100000 }),
      "",
    ].join("\n");
    const m = parseInbox(text);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ address: "JD-HDFCBK", date: 1792700000000, type: 1 });
    expect(m[0].body).toContain("debited");
    expect(m[1].address).toBe("Shortcuts");
    expect(new Set(m.map((x) => x._id)).size).toBe(2);
  });

  it("skips a half-written or empty line instead of failing", () => {
    const text = '{"body":"Rs 100 debited","receivedAt":1}\n{"body":"Rs 2\n{"body":"   "}\n';
    expect(parseInbox(text).map((x) => x.body)).toEqual(["Rs 100 debited"]);
  });
});

describe("arrivals (what Just arrived and the Home card show)", () => {
  beforeEach(() => mockStore.clear());
  const msg = (date: number, body = "Rs 100 debited") => ({ _id: `m${date}`, address: "AX-AXISBK", body, date, type: 1 }) as unknown as RawSMS;
  const now = new Date(2026, 9, 27, 10).getTime();

  it("remembers the batch: messages read, rows added, messages it couldn't read", () => {
    recordArrival([msg(now - 60000), msg(now - 30000)], { addedIds: ["e1"], unreadable: [{ body: "??", sender: "X", date: now }] }, now);
    expect(getLastArrival()).toEqual({
      at: now,
      read: 2,
      addedIds: ["e1"],
      unreadable: [{ body: "??", sender: "X", date: now }],
      seen: false,
    });
  });

  it("adds to a batch not looked at yet, and starts over once it was", () => {
    recordArrival([msg(now - 1000)], { addedIds: ["e1"] }, now);
    recordArrival([msg(now)], { addedIds: ["e2"] }, now + 1000);
    expect(getLastArrival()).toMatchObject({ read: 2, addedIds: ["e1", "e2"], seen: false });
    markArrivalSeen();
    expect(getLastArrival()?.seen).toBe(true);
    recordArrival([msg(now + 5000)], { addedIds: ["e3"] }, now + 6000);
    expect(getLastArrival()).toMatchObject({ read: 1, addedIds: ["e3"], seen: false });
  });

  it("keeps the newest message time and this month's count", () => {
    recordArrival([msg(now - 5000), msg(now - 2000)], {}, now);
    recordArrival([msg(now - 1000)], {}, now);
    const stats = getMessageStats(now);
    expect(stats.lastMessageAt).toBe(now - 1000);
    expect(stats.monthCount).toBe(3);
    // A new month starts the count again.
    expect(getMessageStats(new Date(2026, 10, 2).getTime()).monthCount).toBe(0);
  });

  it("ignores an empty batch", () => {
    recordArrival([], { addedIds: ["e1"] }, now);
    expect(getLastArrival()).toBeNull();
  });

  it("notifies by default", () => {
    expect(isArrivalNotifyOn()).toBe(true);
  });
});
