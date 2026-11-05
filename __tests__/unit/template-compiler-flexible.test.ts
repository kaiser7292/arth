import { normalizeSms } from "../../services/sms/sms-normalize";
import {
  autoTag,
  compileTemplate,
  testTemplate,
  type TaggedField,
  type TaggedSpan,
} from "../../services/sms/template-compiler";

/** Span covering the first occurrence of `text` (after `from`) in `body`. */
function span(body: string, text: string, field: TaggedField, from = 0): TaggedSpan {
  const start = body.indexOf(text, from);
  if (start < 0) throw new Error(`"${text}" not in body`);
  return { field, start, end: start + text.length };
}

const SBI_1 =
  "Your A/C XXXXX798812 Credited INR 50,079.00 on 30/09/26 -Deposit by transfer from Mr. RAHULVERMA. Avl Bal INR 62,305.01-SBI";
const SBI_2 =
  "Your A/C XXXXX798812 Credited INR 5,000.00 on 02/10/26 -IMPS transfer from Mr. PRIYA SHAH. Avl Bal INR 11,305.01-SBI";
const SBI_3_NO_BALANCE =
  "Dear Customer, Your A/C XXXXX798812 Credited INR 750.00 on 03/10/26 -NEFT transfer from Mr. ACME PAYROLL.-SBI";
const HDFC =
  "UPDATE: INR 19,980.00 debited from HDFC Bank XX4417 on 08-SEP-26. Info: FD through MOBILE-XXXXXXXXXX1234:RAHUL VERMA. Avl bal:INR 0.00";

const sbiSpans = (body: string, amount: string, date: string, name: string): TaggedSpan[] => [
  span(body, "798812", "account"),
  span(body, amount, "amount"),
  span(body, date, "date"),
  span(body, name, "counterparty"),
];

describe("flexible matching", () => {
  const spans = sbiSpans(SBI_1, "50,079.00", "30/09/26", "RAHULVERMA");

  it("exact templates break on a reworded message; flexible ones don't", () => {
    const exact = compileTemplate({ smsBody: SBI_1, spans });
    const flexible = compileTemplate({ smsBody: SBI_1, spans, style: "flexible" });
    expect(exact.ok && flexible.ok).toBe(true);
    if (!exact.ok || !flexible.ok) return;

    expect(testTemplate(exact.patternRegex, SBI_2)).toBeNull();
    const read = testTemplate(flexible.patternRegex, SBI_2)!;
    expect(read.amount).toBe("5,000.00");
    expect(read.date).toBe("02/10/26");
    expect(read.counterparty).toBe("PRIYA SHAH");
    expect(read.account).toBe("798812");

    const noBalance = testTemplate(flexible.patternRegex, SBI_3_NO_BALANCE)!;
    expect(noBalance.amount).toBe("750.00");
    expect(noBalance.counterparty).toBe("ACME PAYROLL");
  });

  it("doesn't read another bank's message", () => {
    const flexible = compileTemplate({ smsBody: SBI_1, spans, style: "flexible" });
    if (!flexible.ok) throw new Error(flexible.reason);
    expect(testTemplate(flexible.patternRegex, HDFC)).toBeNull();
  });

  it("reports which words it keeps, in original offsets", () => {
    const flexible = compileTemplate({ smsBody: SBI_1, spans, style: "flexible" });
    if (!flexible.ok) throw new Error(flexible.reason);
    const kept = flexible.wordStates!.filter((w) => w.state !== "free").map((w) => SBI_1.slice(w.start, w.end));
    expect(kept).toEqual(expect.arrayContaining(["A/C", "Credited", "INR", "on", "from", "Mr."]));
    const free = flexible.wordStates!.filter((w) => w.state === "free").map((w) => SBI_1.slice(w.start, w.end));
    expect(free).toEqual(expect.arrayContaining(["Your", "-Deposit", "by"]));
  });

  it("required words are kept and optional ones dropped", () => {
    const strict = compileTemplate({
      smsBody: SBI_1,
      spans,
      style: "flexible",
      wordRules: { required: ["-deposit"], optional: [] },
    });
    if (!strict.ok) throw new Error(strict.reason);
    expect(testTemplate(strict.patternRegex, SBI_2)).toBeNull(); // "-IMPS" instead of "-Deposit"

    const looser = compileTemplate({
      smsBody: SBI_1,
      spans,
      style: "flexible",
      wordRules: { required: [], optional: ["from"] },
    });
    if (!looser.ok) throw new Error(looser.reason);
    const reworded = SBI_2.replace("transfer from", "transfer by");
    expect(testTemplate(looser.patternRegex, reworded)?.counterparty).toBe("PRIYA SHAH");
    const defaults = compileTemplate({ smsBody: SBI_1, spans, style: "flexible" });
    if (!defaults.ok) throw new Error(defaults.reason);
    expect(testTemplate(defaults.patternRegex, reworded)).toBeNull(); // "from" is a lead-in by default
  });

  it("refuses a pattern with no real word", () => {
    const body = "Rs 500 at 1234";
    const r = compileTemplate({
      smsBody: body,
      spans: [span(body, "500", "amount"), span(body, "1234", "account")],
      style: "flexible",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_loose");
  });
});

describe("learning from more than one example", () => {
  it("keeps words both examples share and reads both", () => {
    const r = compileTemplate({
      smsBody: SBI_1,
      spans: sbiSpans(SBI_1, "50,079.00", "30/09/26", "RAHULVERMA"),
      extraSamples: [{ smsBody: SBI_2, spans: sbiSpans(SBI_2, "5,000.00", "02/10/26", "PRIYA SHAH") }],
    });
    if (!r.ok) throw new Error(`${r.reason} ${r.detail}`);
    expect(r.wordStates!.find((w) => w.word === "-deposit")?.state).toBe("free");
    expect(r.wordStates!.find((w) => w.word === "transfer")?.state).toBe("common");
    expect(testTemplate(r.patternRegex, SBI_1)?.amount).toBe("50,079.00");
    expect(testTemplate(r.patternRegex, SBI_2)?.amount).toBe("5,000.00");
  });

  it("refuses examples with different fields", () => {
    const r = compileTemplate({
      smsBody: SBI_1,
      spans: sbiSpans(SBI_1, "50,079.00", "30/09/26", "RAHULVERMA"),
      extraSamples: [{ smsBody: SBI_2, spans: [span(SBI_2, "5,000.00", "amount")] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("different_format");
  });
});

describe("autoTag guesses the new fields", () => {
  it("finds the other account and the name", () => {
    const imps = "IMPS INR 30,000.00 sent from HDFC Bank A/c XX4417 on 03-09-26 To A/c xxxxxxxxxx8812 Ref-624633402819";
    const tags = autoTag(imps);
    const other = tags.find((t) => t.field === "other_account");
    expect(other && imps.slice(other.start, other.end)).toBe("xxxxxxxxxx8812");

    const tags2 = autoTag(SBI_1);
    const name = tags2.find((t) => t.field === "counterparty");
    expect(name && SBI_1.slice(name.start, name.end)).toBe("RAHULVERMA");
  });
});

describe("a field inside a word, with examples that differ there", () => {
  const A = "INR 250.00 debited A/c no. XX1234 30-10-26, 11:28:52 UPI/P2M/666926407204/SWIGGY INSTAMART Not you? SMS BLOCKUPI Cust ID to 919000000000 Axis Bank";
  const B = "INR 100.00 debited A/c no. XX1234 30-10-26, 11:20:03 UPI/P2A/666940503650/K VIJAY Not you? SMS BLOCKUPI Cust ID to 919000000000 Axis Bank";
  const C = "INR 75.50 debited A/c no. XX1234 02-11-26, 09:01:44 UPI/P2M/777000111222/BLINKIT FOODS LTD Not you? SMS BLOCKUPI Cust ID to 919000000000 Axis Bank";
  const span = (b: string, field: TaggedField, text: string) => ({ field, start: b.indexOf(text), end: b.indexOf(text) + text.length });
  const values = (b: string): Record<string, string> =>
    b === A
      ? { amount: "250.00", account: "1234", date: "30-10-26", ref: "666926407204", merchant: "SWIGGY INSTAMART" }
      : { amount: "100.00", account: "1234", date: "30-10-26", ref: "666940503650", merchant: "K VIJAY" };
  const tag = (b: string, fields: TaggedField[]) => fields.map((f) => span(b, f, values(b)[f]));
  const read = (pattern: string, m: string) => new RegExp(pattern, "i").exec(normalizeSms(m).text)?.groups;

  describe.each([["exact"], ["flexible"]] as const)("%s", (style) => {
    it.each([
      [["amount", "merchant"]],
      [["amount", "account", "merchant"]],
      [["amount", "date", "merchant"]],
      [["amount", "ref", "merchant"]],
      [["amount", "account", "date", "ref", "merchant"]],
    ] as [TaggedField[]][])("%j, with two examples, reads all three messages", (fields) => {
      const r = compileTemplate({ smsBody: A, spans: tag(A, fields), style, extraSamples: [{ smsBody: B, spans: tag(B, fields) }] });
      if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`);
      expect(read(r.patternRegex, A)?.merchant).toBe("swiggy instamart");
      expect(read(r.patternRegex, B)?.merchant).toBe("k vijay");
      expect(read(r.patternRegex, C)).toMatchObject({ amount: "75.50", merchant: "blinkit foods ltd" });
    });

    it("with one example, a reference that changes doesn't stop the next message", () => {
      const fields: TaggedField[] = ["amount", "merchant"];
      const r = compileTemplate({ smsBody: A, spans: tag(A, fields), style });
      if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`);
      expect(read(r.patternRegex, C)?.merchant).toBe("blinkit foods ltd");
    });
  });

  it("keeps the pieces that are the same, and tells other formats apart", () => {
    const r = compileTemplate({ smsBody: A, spans: tag(A, ["amount", "merchant"]), extraSamples: [{ smsBody: B, spans: tag(B, ["amount", "merchant"]) }] });
    if (!r.ok) throw new Error(String(r.reason));
    expect(r.patternRegex).toContain("upi/");
    expect(read(r.patternRegex, "INR 75.50 debited A/c no. XX1234 02-11-26, 09:01:44 NEFT/P2M/777000111222/ACME Not you?")).toBeUndefined();
  });

  it("a different shape in the other example still saves", () => {
    const b2 = "INR 100.00 debited A/c no. XX1234 30-10-26, 11:20:03 UPI/666940503650/K VIJAY Not you? SMS BLOCKUPI Cust ID to 919000000000 Axis Bank";
    const r = compileTemplate({ smsBody: A, spans: [span(A, "amount", "250.00"), span(A, "merchant", "SWIGGY INSTAMART")], extraSamples: [{ smsBody: b2, spans: [span(b2, "amount", "100.00"), span(b2, "merchant", "K VIJAY")] }] });
    if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`);
    expect(read(r.patternRegex, b2)?.merchant).toBe("k vijay");
  });
});
