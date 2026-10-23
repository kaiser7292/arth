jest.mock("@/services/sms/sms-orchestrator", () => ({ runSmsScan: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: {} }));
import { parseInbox } from "../../services/message-inbox";

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
