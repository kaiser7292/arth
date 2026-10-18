import { changingParts, formatKey, groupByFormat, guessSpans } from "../../services/sms/template-guess";
import { compileTemplate, type TaggedSpan } from "../../services/sms/template-compiler";
import type { UserSmsTemplate } from "../../services/sms/user-sms-templates";

const values = (body: string, spans: TaggedSpan[]) =>
  Object.fromEntries(spans.map((s) => [s.field, body.slice(s.start, s.end)]));

describe("guessSpans", () => {
  it("reads a typical UPI debit, taking the amount and not the balance", () => {
    const body = "Rs 486.00 debited from A/c XX4821 on 17-10-26. Info: UPI/SWIGGY LIMITED/6283. Avl Bal Rs 42,180.22";
    const v = values(body, guessSpans(body));
    expect(v).toMatchObject({ amount: "486.00", account: "4821", date: "17-10-26", merchant: "SWIGGY LIMITED", balance: "42,180.22" });
  });

  it("skips a balance that comes first and finds the merchant after 'at'", () => {
    const body = "Avl Bal Rs 5,000.00. Rs 250 spent on card XX1234 at AMAZON on 17 Oct 2026";
    const v = values(body, guessSpans(body));
    expect(v.amount).toBe("250");
    expect(v.balance).toBe("5,000.00");
    expect(v.merchant).toBe("AMAZON");
  });

  it("doesn't take a web address for a date", () => {
    const body = "Payment of Rs. 9.32 from Zomato Money Balance is successful. Updated balance: Rs. 0.00. Contact zomatomoneysupport@zomato.com for queries. -ZOMATO";
    const v = values(body, guessSpans(body));
    expect(v.date).toBeUndefined();
    expect(v.amount).toBe("9.32");
    expect(v.balance).toBe("0.00");
  });

  it("handles a date with spaces around the separators", () => {
    const body = "INR 1,200.00 spent on card XX9876 on 17 - 10 - 26 at BIGBASKET";
    expect(values(body, guessSpans(body)).date).toBe("17 - 10 - 26");
  });

  it("learns from the user's own templates", () => {
    const sample = "Paid INR 300 to merchant. Wallet bal left INR 700";
    const tpl = {
      samples: JSON.stringify([
        { body: sample, spans: [{ field: "balance", start: sample.indexOf("700"), end: sample.indexOf("700") + 3 }] },
      ]),
    } as unknown as UserSmsTemplate;
    const body = "Paid INR 45 for chai. Wallet bal left INR 1,155";
    expect(values(body, guessSpans(body, [], [tpl])).balance).toBe("1,155");
  });

  it("finds the merchant from what changes between messages of the same format", () => {
    const a = "Payment done for Rs 120. Payee ZOMATO thanks you";
    const b = "Payment done for Rs 80. Payee DUNZO thanks you";
    const v = values(a, guessSpans(a, [b]));
    expect(v.amount).toBe("120");
    expect(v.merchant).toBe("ZOMATO");
  });

  it("produces spans the template compiler accepts", () => {
    const body = "Rs 486.00 debited from A/c XX4821 on 17-10-26. Info: UPI/SWIGGY LIMITED/6283. Avl Bal Rs 42,180.22";
    expect(compileTemplate({ smsBody: body, spans: guessSpans(body), style: "flexible" }).ok).toBe(true);
  });
});

describe("formats", () => {
  it("groups messages by sender and opening words, numbers aside", () => {
    const rows = [
      { id: "1", address: "VM-HDFCBK", body: "Rs 10 debited from A/c XX1", sms_date: 2 },
      { id: "2", address: "AD-HDFCBK-S", body: "Rs 99 debited from A/c XX1", sms_date: 3 },
      { id: "3", address: "VM-HDFCBK", body: "Rs 50 credited to A/c XX1", sms_date: 1 },
    ];
    const groups = groupByFormat(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].messages.map((m) => m.id)).toEqual(["2", "1"]);
    expect(formatKey("VM-HDFCBK", "Rs 10 debited")).toBe(formatKey("JD-HDFCBK", "Rs 999 debited"));
  });

  it("changingParts marks only the words that differ", () => {
    const a = "Payee ZOMATO thanks you";
    expect(changingParts(a, "Payee DUNZO thanks you").map((p) => a.slice(p.start, p.end))).toEqual(["ZOMATO"]);
  });
});
