/**
 * v15.5.0 — SMS template compiler unit tests.
 *
 * Validates the pure compiler that turns {smsBody, spans[]} into a
 * runnable regex. Zero side effects, no DB, no mocks needed.
 */

import {
  compileTemplate,
  testTemplate,
  type TaggedSpan,
  __test__,
} from "../../services/sms/template-compiler";

const { escapeLiteral } = __test__;

/**
 * Helper: locate a substring in the SMS body and return its TaggedSpan.
 * Fails the test if the substring isn't found or appears multiple times
 * (the author probably meant a specific occurrence).
 */
function span(body: string, field: TaggedSpan["field"], substr: string): TaggedSpan {
  const start = body.indexOf(substr);
  if (start < 0) throw new Error(`span helper: "${substr}" not in body`);
  const nextStart = body.indexOf(substr, start + 1);
  if (nextStart >= 0) {
    throw new Error(
      `span helper: "${substr}" appears more than once — test is ambiguous`,
    );
  }
  return { field, start, end: start + substr.length };
}

describe("compileTemplate — success cases", () => {
  it("extracts amount only (minimum valid template)", () => {
    const body = "Spent INR 521.98 at Merchant";
    const result = compileTemplate({
      body: body,
      smsBody: body,
      spans: [span(body, "amount", "521.98")],
    } as never);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extracted.amount).toBe("521.98");
      expect(result.capturedFields).toEqual(["amount"]);
    }
  });

  it("extracts amount + account + merchant together", () => {
    const body =
      "Spent INR 521.98 on your Axis Bank Card no. XX2445 at BOOKMYSHOW 30-04-26";
    const result = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "amount", "521.98"),
        span(body, "account", "2445"),
        span(body, "merchant", "BOOKMYSHOW"),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extracted).toEqual({
        amount: "521.98",
        account: "2445",
        merchant: "BOOKMYSHOW",
      });
      expect(result.capturedFields).toEqual(["amount", "account", "merchant"]);
    }
  });

  it("multi-word merchant is captured non-greedy via trailing anchor", () => {
    const body =
      "Rs. 1438.20 refunded by AMAZON PAY IN E COMMERC adjusted against HDFC Card 8957";
    const result = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "amount", "1438.20"),
        span(body, "merchant", "AMAZON PAY IN E COMMERC"),
        span(body, "account", "8957"),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extracted.merchant).toBe("AMAZON PAY IN E COMMERC");
    }
  });

  it("collapses whitespace in anchor text to \\s+ (tolerant of variable padding)", () => {
    const body = "Spent  INR  521.98  at  BOOKMYSHOW";
    const result = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "amount", "521.98"),
        span(body, "merchant", "BOOKMYSHOW"),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Same template must match the SINGLE-spaced variant too.
      const single = testTemplate(result.patternRegex, "Spent INR 521.98 at BOOKMYSHOW");
      expect(single).not.toBeNull();
      expect(single!.amount).toBe("521.98");
      expect(single!.merchant).toBe("BOOKMYSHOW");
    }
  });

  it("escapes regex metacharacters in anchor text", () => {
    const body = "Paid Rs.500 (incl. GST) — Ref. ABC123 @SELLER";
    const result = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "amount", "500"),
        span(body, "ref", "ABC123"),
      ],
    });
    expect(result.ok).toBe(true);
    // The anchor contains ., (, ), —, @ — all of which must be escaped
    // so the regex doesn't treat them as metacharacters.
    if (result.ok) {
      // Round-trip already validated internally.
      expect(result.patternRegex).toContain("\\(");
      expect(result.patternRegex).toContain("\\)");
      expect(result.patternRegex).toContain("\\.");
    }
  });

  it("handles a span at position 0 (no leading anchor)", () => {
    const body = "521.98 debited from HDFC 1234";
    const result = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "amount", "521.98"),
        span(body, "account", "1234"),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Pattern should start directly with the amount capture, no leading
      // literal. Match at offset 0 confirms.
      const re = new RegExp(result.patternRegex, "i");
      const m = re.exec(body);
      expect(m).not.toBeNull();
      expect(m!.index).toBe(0);
    }
  });

  // ─── v15.10.1 regression tests: 9-step normalization pipeline ───

  it("matches a variant with ₹ where template had Rs. (v15.10.1)", () => {
    const body1 = "Spent Rs. 500 at SWIGGY";
    const result = compileTemplate({
      smsBody: body1,
      spans: [span(body1, "amount", "500"), span(body1, "merchant", "SWIGGY")],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const body2 = "Spent ₹500 at SWIGGY";
      const out = testTemplate(result.patternRegex, body2);
      expect(out).not.toBeNull();
      expect(out!.amount).toBe("500");
      expect(out!.merchant).toBe("SWIGGY");
    }
  });

  it("matches a variant with INR where template had Rs. (v15.10.1)", () => {
    const body1 = "Spent Rs. 500 at SWIGGY";
    const result = compileTemplate({
      smsBody: body1,
      spans: [span(body1, "amount", "500"), span(body1, "merchant", "SWIGGY")],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const body2 = "Spent INR 500 at SWIGGY";
      const out = testTemplate(result.patternRegex, body2);
      expect(out).not.toBeNull();
      expect(out!.amount).toBe("500");
    }
  });

  it("matches a variant where thousands commas differ (v15.10.1)", () => {
    const body1 = "Spent Rs 1,23,456 at BIGBASKET";
    const result = compileTemplate({
      smsBody: body1,
      spans: [
        span(body1, "amount", "1,23,456"),
        span(body1, "merchant", "BIGBASKET"),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const body2 = "Spent Rs 123456 at BIGBASKET";
      const out = testTemplate(result.patternRegex, body2);
      expect(out).not.toBeNull();
      expect(out!.merchant).toBe("BIGBASKET");
    }
  });

  it("strips DLT sender header if pasted into the sample (v15.10.1)", () => {
    const body1 = "AX-HDFCBK-S Rs.500 debited at UBER";
    const result = compileTemplate({
      smsBody: body1,
      spans: [span(body1, "amount", "500"), span(body1, "merchant", "UBER")],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Incoming SMS without the DLT header should still match.
      const body2 = "Rs.500 debited at UBER";
      const out = testTemplate(result.patternRegex, body2);
      expect(out).not.toBeNull();
      expect(out!.amount).toBe("500");
    }
  });

  it("strips trailing boilerplate (Not you?) for match (v15.10.1)", () => {
    // Template sample has the boilerplate in the trailing tail; the
    // normalizer strips it at compile time so the pattern doesn't
    // anchor on that variable text. A variant with different
    // boilerplate (or none) still matches.
    const body1 = "Rs.500 debited at UBER. Not you? Call 1800-000-000";
    const result = compileTemplate({
      smsBody: body1,
      spans: [span(body1, "amount", "500"), span(body1, "merchant", "UBER")],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Different boilerplate tail — still matches.
      const body2 = "Rs.500 debited at UBER. T&C apply.";
      const out = testTemplate(result.patternRegex, body2);
      expect(out).not.toBeNull();
      expect(out!.amount).toBe("500");
    }
  });

  // v15.10.1 regression: wallet SMSes (e.g. TataNeu) often have a
  // shortener URL with a per-message unique token (/MYTNEU/joogO2l)
  // BETWEEN tagged fields. Before v15.10.1, escapeLiteral baked the
  // literal token into the template, which then failed on the next SMS
  // with a different token.
  it("wildcards per-message URL tokens so different tokens still match (v15.10.1)", () => {
    const body1 =
      "Hi, you've used 482.5 NeuCoin(s) at bigbasket on 01-05-2026. Check your NeuCoins balance at https://m.tneu.in/MYTNEU/joogO2l - Team TataNeu";
    const result = compileTemplate({
      smsBody: body1,
      spans: [
        span(body1, "amount", "482.5"),
        span(body1, "merchant", "bigbasket"),
        span(body1, "date", "01-05-2026"),
        span(body1, "account", "TataNeu"),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Same template structure, different URL slug + different merchant.
      const body2 =
        "Hi, you've used 397.0 NeuCoin(s) at Tata 1mg on 02-05-2026. Check your NeuCoins balance at https://m.tneu.in/MYTNEU/OAA4AXp - Team TataNeu";
      const extracted = testTemplate(result.patternRegex, body2);
      expect(extracted).not.toBeNull();
      expect(extracted!.amount).toBe("397.0");
      expect(extracted!.merchant).toBe("Tata 1mg");
      expect(extracted!.date).toBe("02-05-2026");
      expect(extracted!.account).toBe("TataNeu");
    }
  });

  it("truncates trailing tail to 20 chars (survives variable post-text)", () => {
    // Long, variable tail that the same bank might rewrite — shouldn't anchor.
    const body = "Spent INR 100 at SHOP. View updated balance at https://very.long.url/ABC123";
    const result = compileTemplate({
      smsBody: body,
      spans: [span(body, "amount", "100"), span(body, "merchant", "SHOP")],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The regex should match a variant with a different tail URL.
      const variant = "Spent INR 100 at SHOP. View updated balance at https://other.url/XYZ";
      const extracted = testTemplate(result.patternRegex, variant);
      expect(extracted).not.toBeNull();
      expect(extracted!.amount).toBe("100");
      expect(extracted!.merchant).toBe("SHOP");
    }
  });

  it("preserves span order regardless of input order", () => {
    const body = "Spent INR 521.98 on Card XX2445 at BOOKMYSHOW";
    // Provide spans in reverse-order; compiler should sort by start.
    const result = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "merchant", "BOOKMYSHOW"),
        span(body, "amount", "521.98"),
        span(body, "account", "2445"),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.capturedFields).toEqual(["amount", "account", "merchant"]);
    }
  });
});

describe("compileTemplate — validation errors", () => {
  it("rejects no spans at all", () => {
    const result = compileTemplate({ smsBody: "anything", spans: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_spans");
  });

  it("rejects overlapping spans", () => {
    const body = "INR 521.98 at SHOP";
    const result = compileTemplate({
      smsBody: body,
      spans: [
        { field: "amount", start: 4, end: 10 }, // "521.98"
        { field: "merchant", start: 8, end: 14 }, // overlaps
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("overlapping_spans");
  });

  it("rejects duplicate field tags", () => {
    const body = "Rs 100 Rs 200";
    const result = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "amount", "100"),
        { field: "amount", start: 10, end: 13 }, // "200" re-tagged as amount
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("duplicate_field");
  });

  it("rejects empty span (start === end)", () => {
    const result = compileTemplate({
      smsBody: "Rs 100",
      spans: [{ field: "amount", start: 3, end: 3 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty_span");
  });

  it("rejects when required field (amount by default) is missing", () => {
    const body = "Card XX1234 at SHOP";
    const result = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "account", "1234"),
        span(body, "merchant", "SHOP"),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_required_field");
  });

  it("allows templates without amount when requiredFields is overridden", () => {
    const body = "Card XX1234 at SHOP";
    const result = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "account", "1234"),
        span(body, "merchant", "SHOP"),
      ],
      requiredFields: [],
    });
    expect(result.ok).toBe(true);
  });
});

describe("testTemplate", () => {
  it("extracts fields from a compliant SMS", () => {
    const body = "Spent INR 521.98 at BOOKMYSHOW";
    const compiled = compileTemplate({
      smsBody: body,
      spans: [
        span(body, "amount", "521.98"),
        span(body, "merchant", "BOOKMYSHOW"),
      ],
    });
    if (!compiled.ok) throw new Error("compile failed");

    const extracted = testTemplate(compiled.patternRegex, "Spent INR 999.00 at SWIGGY");
    expect(extracted).not.toBeNull();
    expect(extracted!.amount).toBe("999.00");
    expect(extracted!.merchant).toBe("SWIGGY");
  });

  it("returns null when the SMS does not match", () => {
    const body = "Spent INR 521.98 at BOOKMYSHOW";
    const compiled = compileTemplate({
      smsBody: body,
      spans: [span(body, "amount", "521.98"), span(body, "merchant", "BOOKMYSHOW")],
    });
    if (!compiled.ok) throw new Error("compile failed");

    // Totally different SMS format.
    const extracted = testTemplate(compiled.patternRegex, "A completely different message");
    expect(extracted).toBeNull();
  });

  it("returns null on invalid regex string (robustness)", () => {
    expect(testTemplate("[unclosed", "anything")).toBeNull();
  });
});

describe("escapeLiteral (pure helper)", () => {
  it("collapses multi-whitespace to \\s+", () => {
    expect(escapeLiteral("a    b")).toBe("a\\s+b");
    expect(escapeLiteral("a\tb\nc")).toBe("a\\s+b\\s+c");
  });

  it("escapes regex metacharacters", () => {
    expect(escapeLiteral("a.b")).toBe("a\\.b");
    expect(escapeLiteral("(x)")).toBe("\\(x\\)");
    expect(escapeLiteral("a+b*c?")).toBe("a\\+b\\*c\\?");
    expect(escapeLiteral("[abc]")).toBe("\\[abc\\]");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLiteral("Spent INR")).toBe("Spent\\s+INR");
    expect(escapeLiteral("HDFC")).toBe("HDFC");
  });
});
