/**
 * An Axis card message a user couldn't teach: the date tagged without its time made the pattern
 * read "17-10-26 10:04:39", and the guess missed "Avl limit" as the balance.
 */
import { compileTemplate, testTemplate } from "../../services/sms/template-compiler";
import { guessSpans } from "../../services/sms/template-guess";

const BODY = `Spent INR 749 
using Axis Bank Credit Card no. XX2445 on 17-10-26 10:04:39 IST at 
PLAYSTATION. 
Avl limit: INR 679251. Not you? SMS BLOCK 2445 to +919951860002.`;

const val = (body: string, s: { start: number; end: number }) => body.slice(s.start, s.end);

describe("Axis card template", () => {
  it("guesses amount, card, date, merchant and the available limit", () => {
    const spans = guessSpans(BODY);
    const got = Object.fromEntries(spans.map((s) => [s.field, val(BODY, s)]));
    expect(got.amount).toBe("749");
    expect(got.account).toBe("2445");
    expect(got.date).toBe("17-10-26");
    expect(got.merchant).toBe("PLAYSTATION");
    expect(got.balance).toBe("679251");
  });

  it.each(["flexible", "exact"] as const)("compiles a date tagged without its time (%s)", (style) => {
    const spans = guessSpans(BODY);
    const r = compileTemplate({ smsBody: BODY, spans, style });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = testTemplate(r.patternRegex, BODY);
    expect(t?.date?.trim()).toBe("17-10-26");
  });
});
