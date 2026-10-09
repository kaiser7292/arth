import { SMS_REPORT_EMAIL, buildSmsReportMailto, redactSms } from "../../services/sms/sms-redact";

const SAMPLES: { body: string; secrets: string[]; keep: string[] }[] = [
  {
    body: "UPDATE: INR 19,980.00 debited from HDFC Bank XX4417 on 08-SEP-26. Info: FD through MOBILE-XXXXXXXXXX1234:RAHUL VERMA. Avl bal:INR 1,50,000.00",
    secrets: ["4417", "1234", "RAHUL", "VERMA", "1,50,000"],
    keep: ["19,980.00", "08-SEP-26", "FD through MOBILE"],
  },
  {
    body: "IMPS INR 30,000.00\nsent from HDFC Bank A/c XX4417 on 03-09-26\nTo A/c xxxxxxxxxx8812\nRef-624633402819\nNot you?Call 18002586161",
    secrets: ["4417", "8812", "624633402819", "18002586161"],
    keep: ["30,000.00", "03-09-26"],
  },
  {
    body: "Dear Customer, Your a/c no. XXXXXXXX8812 is credited by Rs.20013.00 on 30-09-26 by a/c linked to mobile 9XXXXXX963-RAHUL VER (IMPS Ref# 627344741256)-SBI",
    secrets: ["8812", "963", "RAHUL", "627344741256"],
    keep: ["20013.00", "30-09-26"],
  },
  {
    body: "Your A/C XXXXX798812 Credited INR 50,079.00 on 30/09/26 -Deposit by transfer from Mr. RAHULVERMA. Avl Bal INR 62,305.01-SBI",
    secrets: ["798812", "RAHULVERMA", "62,305.01"],
    keep: ["50,079.00", "30/09/26", "Deposit by transfer from"],
  },
  {
    body: "Alert! Rs. 2759.39 refunded by RSP*NYKAA VIA SMARTBU on 20/SEP/2026 & adjusted against HDFC Bank Credit Card 9628 View updated balance here: https://1.hdfc.bank.in/HDFCBK/s/WlMldLwp",
    secrets: ["9628", "WlMldLwp"],
    keep: ["2759.39", "20/SEP/2026"],
  },
  {
    body: "Rs 500 sent to rahul.verma@okhdfcbank from A/c 4417 UPI Ref 612345678901",
    secrets: ["rahul.verma", "okhdfcbank", "4417", "612345678901"],
    keep: ["Rs 500"],
  },
];

describe("redactSms", () => {
  it.each(SAMPLES.map((s, i) => [i, s] as const))("sample %i hides personal details, keeps amounts and dates", (_i, s) => {
    const out = redactSms(s.body);
    for (const secret of s.secrets) expect(out).not.toContain(secret);
    for (const kept of s.keep) expect(out).toContain(kept);
  });
});

describe("buildSmsReportMailto", () => {
  it("addresses the developer and carries the redacted text", () => {
    const url = buildSmsReportMailto("Your A/C XXXX Credited INR 5.00", "VM-SBIINB", "4.5.0");
    expect(url.startsWith(`mailto:${SMS_REPORT_EMAIL}?subject=`)).toBe(true);
    expect(decodeURIComponent(url)).toContain("Your A/C XXXX Credited INR 5.00");
    expect(decodeURIComponent(url)).toContain("SBIINB");
  });
});
