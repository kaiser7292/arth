import { extractTime, parseDateAny } from "@/services/sms/bank-patterns";
import { normalizeSms } from "@/services/sms/sms-normalize";
import { autoTag, compileTemplate } from "@/services/sms/template-compiler";
import { extractField, picturePieces, wordsOf } from "@/services/receipt/image-templates";
import { accountFrom, fixMisreadDigits, parseDate, parseTime } from "@/services/receipt/read-receipt";

const SHOT = "02:12pm, 4th nov'26";

describe("date and time on a picture", () => {
  it("reads a date with no space before the year", () => {
    expect(parseDate(SHOT)).toBe("2026-11-04");
    expect(parseDate("4th nov'26")).toBe("2026-11-04");
    expect(parseTime(SHOT)).toBe("14:12");
  });

  it("lets the line be linked as the date, with its time", () => {
    expect(extractField("date", SHOT)).toMatchObject({ value: "2026-11-04", time: "14:12" });
  });

  it("still reads the formats it read before", () => {
    expect(parseDate("18 Oct 2026")).toBe("2026-10-18");
    expect(parseDate("18 Oct '26")).toBe("2026-10-18");
    expect(parseDate("24 October 2026 at 3:11 PM")).toBe("2026-10-24");
    expect(parseDate("12 items 2026")).toBeNull();
  });
});

describe("date and time in an SMS", () => {
  it.each([
    [SHOT, "2026-11-04"],
    ["4th nov'26", "2026-11-04"],
    ["4 November 2026", "2026-11-04"],
    ["4 Nov, 26", "2026-11-04"],
    ["4 Nov 26", "2026-11-04"],
  ])("parseDateAny(%s)", (raw, want) => {
    expect(parseDateAny(raw)).toBe(want);
  });

  it("doesn't change what was already read", () => {
    expect(parseDateAny("11-Apr-26")).toBe("2026-04-11");
    expect(parseDateAny("14Jun25")).toBe("2025-06-14");
    expect(parseDateAny("10th Apr 2026")).toBe("2026-04-10");
    expect(parseDateAny("2026-04-07:19:25")).toBe("2026-04-07");
    expect(parseDateAny("JAN 2026")).toBe("2026-01-31");
    expect(parseDateAny("SEP-25")).toBe("2025-09-30");
  });

  it.each([
    ["Paid on 4th nov'26, 02:12pm from a/c", "14:12:00"],
    ["at 12:05 AM on 4 Nov", "00:05:00"],
    ["on 04-11-26 02:31:10 PM", "14:31:10"],
    ["on 4 Nov 2026 at 14:05 via UPI", "14:05:00"],
    ["on 04/11/2026 14:05 via UPI", "14:05:00"],
    ["2026-04-07:19:25 ref", "19:25:00"],
    ["2026-04-07:19:25:50 ref", "19:25:50"],
    ["on 09-09-25 02:31:10 IST", "02:31:10"],
  ])("extractTime(%s)", (raw, want) => {
    expect(extractTime(raw)).toBe(want);
  });

  it("doesn't take any number with a colon for the time", () => {
    expect(extractTime("Bal: Rs 12:30 ref 5")).toBeNull();
    expect(extractTime("Rs.500 debited")).toBeNull();
  });

  it("a template can be tagged with a date and time together, and reads the next message", () => {
    const sms = (d: string) => `Rs 500 debited from a/c 1234 on ${d} ref 998877`;
    const body = sms(SHOT);
    const start = body.indexOf(SHOT);
    const amount = { field: "amount" as const, start: body.indexOf("500"), end: body.indexOf("500") + 3 };
    const result = compileTemplate({ smsBody: body, spans: [amount, { field: "date", start, end: start + SHOT.length }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = new RegExp(result.patternRegex, "i").exec(normalizeSms(sms("11:45am, 21st dec'26")).text);
    expect(read?.groups?.date).toBe("11:45am, 21st dec'26");
    expect(parseDateAny(read!.groups!.date)).toBe("2026-12-21");
    expect(extractTime(read!.groups!.date)).toBe("11:45:00");
  });

  it("a template tagged with the date alone still reads the next message, whose time differs", () => {
    const sms = (d: string) => `Rs 500 debited from a/c 1234 on ${d} ref 998877`;
    const body = sms(SHOT);
    const start = body.indexOf("4th");
    const amount = { field: "amount" as const, start: body.indexOf("500"), end: body.indexOf("500") + 3 };
    const result = compileTemplate({ smsBody: body, spans: [amount, { field: "date", start, end: start + "4th nov'26".length }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = new RegExp(result.patternRegex, "i").exec(normalizeSms(sms("11:45am, 21st dec'26")).text);
    expect(read?.groups?.date).toBe("21st dec'26");
  });

  it("guesses a date and time written that way", () => {
    const body = `INR 500 debited from a/c 1234 on ${SHOT} ref 998877`;
    const span = autoTag(body).find((s) => s.field === "date");
    expect(span && body.slice(span.start, span.end)).toBe(SHOT);
  });
});

describe("O read for 0", () => {
  it("fixes a masked account number", () => {
    expect(fixMisreadDigits("XXXXXXO006")).toBe("XXXXXX0006");
    expect(fixMisreadDigits("XXXXXXO006 LIPI")).toBe("XXXXXX0006 LIPI");
    expect(fixMisreadDigits("**** l234")).toBe("**** 1234");
    expect(accountFrom(fixMisreadDigits("XXXXXXO006"))?.last4).toBe("0006");
  });

  it("fixes an amount with a rupee sign", () => {
    expect(fixMisreadDigits("₹1,1O2.87")).toBe("₹1,102.87");
    expect(fixMisreadDigits("Rs. 5O0")).toBe("Rs. 500");
  });

  it.each([
    "ddc813bc-f320-4699-a957-dda8029bb7fc",
    "******4963@yescred",
    "xxxxx1o3@ybl",
    "Zepto",
    "Foxx Boo",
    "Rs 5OFF",
    "Rs 5 lakh",
    "XXXXXX LIPI",
    "T2O26110412345",
  ])("leaves %s alone", (text) => {
    expect(fixMisreadDigits(text)).toBe(text);
  });

  it("the picture's pieces and word chips both show the corrected value", () => {
    const box = { x: 0.1, y: 0.5, width: 0.3, height: 0.02 };
    const [piece] = picturePieces([
      { ...box, text: "XXXXXXO006 LIPI", words: [{ ...box, text: "XXXXXXO006" }, { ...box, text: "LIPI" }] },
    ]);
    expect(piece.text).toBe("XXXXXX0006 LIPI");
    expect(wordsOf(piece).map((w) => w.text)).toEqual(["XXXXXX0006", "LIPI"]);
  });
});
