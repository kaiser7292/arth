jest.mock("@/database", () => ({ getDatabase: () => ({}) }));
jest.mock("@/services/settings", () => ({ bumpDataVersion: jest.fn() }));
import {
  applyTemplate,
  buildTemplate,
  extractField,
  matchTemplate,
  picturePieces,
  valuesFromPicks,
  withTemplate,
} from "../../services/receipt/image-templates";
import { readReceipt } from "../../services/receipt/read-receipt";

/** A picture's text as the text reader returns it: one piece per line, with its place (made-up data). */
const L = (text: string, y: number, x = 0.3, height = 0.015) => ({ text, x, y, width: 0.4, height });

// A bank app layout the general reader can't fully read: the amount sits under "Debit amount" with
// no ₹, the payee under "Beneficiary", the date under "Value date", the reference after "Ref#".
const teach = [
  L("10:42", 0.01, 0.05),
  L("Funds sent", 0.1),
  L("Debit amount", 0.2),
  L("4200.00", 0.23),
  L("Beneficiary", 0.3),
  L("RAVI KUMAR", 0.33),
  L("Value date", 0.4),
  L("12-10-2026", 0.43),
  L("Ref# 220011223344", 0.5),
  L("From A/c XX4455", 0.55),
  L("Thank you for banking with us", 0.9),
];
const next = [
  L("9:05", 0.01, 0.05),
  L("Funds sent", 0.1),
  L("Debit amount", 0.21),
  L("15000.50", 0.24),
  L("Beneficiary", 0.31),
  L("CRUNCH DAYCARE LLP", 0.34),
  L("Value date", 0.41),
  L("18-10-2026", 0.44),
  L("Ref# 990011112222", 0.51),
  L("From A/c XX4455", 0.56),
  L("Thank you for banking with us", 0.9),
];

describe("smart image templates", () => {
  const pieces = picturePieces(teach);
  const at = (text: string) => pieces.findIndex((p) => p.text === text);
  const learned = buildTemplate(pieces, {
    amount: at("4200.00"),
    party: at("RAVI KUMAR"),
    date: at("12-10-2026"),
    ref: at("Ref# 220011223344"),
    account: at("From A/c XX4455"),
  });

  it("learns the layout's fixed text, not the values", () => {
    expect(learned.anchors).toEqual(expect.arrayContaining(["funds sent", "debit amount", "beneficiary", "value date"]));
    expect(learned.anchors).not.toContain("ravi kumar");
    expect(learned.fields.ref?.prefix).toBe("ref#");
    expect(learned.fields.amount).toMatchObject({ anchor: "debit amount", offset: 1 });
  });

  it("reads the next picture of that layout", () => {
    const p2 = picturePieces(next);
    expect(matchTemplate(p2, [{ anchors: ["something else", "entirely", "different"] }, { anchors: learned.anchors }])).toEqual({ anchors: learned.anchors });
    const v = applyTemplate(p2, learned.fields);
    expect(v).toMatchObject({ amount: 15000.5, party: "Crunch Daycare Llp", date: "2026-10-18", ref: "990011112222" });
    expect(v.account).toMatchObject({ last4: "4455" });
  });

  it("doesn't match a different layout", () => {
    const other = picturePieces([L("Paid successfully", 0.1), L("₹450", 0.2), L("To SWIGGY", 0.3), L("21 Oct 2026", 0.4)]);
    expect(matchTemplate(other, [{ anchors: learned.anchors }])).toBeNull();
  });

  it("its values win over the general reader's, which fills the rest", () => {
    const p2 = picturePieces(next);
    const g = readReceipt(next);
    const merged = withTemplate(g, "expense", applyTemplate(p2, learned.fields));
    expect(merged.amount).toBe(15000.5);
    expect(merged.party).toBe("Crunch Daycare Llp");
    expect(merged.text).toBe(g.text);
  });

  it("linking text to fields gives their values straight away", () => {
    expect(valuesFromPicks(pieces, { amount: at("4200.00"), party: at("RAVI KUMAR"), ref: at("Ref# 220011223344") })).toEqual({
      amount: 4200,
      party: "Ravi Kumar",
      ref: "220011223344",
    });
  });

  it("takes values out of labelled text", () => {
    expect(extractField("ref", "Tr. ID: 110947642074")?.value).toBe("110947642074");
    expect(extractField("party", "To SIREESHA  AETUKURI")?.value).toBe("Sireesha Aetukuri");
    expect(extractField("amount", "₹ 15,000")?.value).toBe(15000);
    expect(extractField("amount", "110947642074")).toBeNull();
    expect(extractField("date", "Paid at 03:45PM, 18 Oct '26 IST")).toMatchObject({ value: "2026-10-18", time: "15:45" });
    expect(extractField("ownVpa", "From: asha.m@ICICI")?.value).toBe("asha.m@icici");
  });
});
