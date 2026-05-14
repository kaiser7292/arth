/**
 * v15.2.0 — Smart rules evaluator tests (pure functions, no DB).
 */

import {
  evaluateRule,
  findFirstMatch,
  materialize,
  type SmartRule,
  type EvaluationTarget,
} from "../../services/smart-rules";

function rule(overrides: Partial<SmartRule>): SmartRule {
  return {
    id: overrides.id ?? "r-1",
    user_id: "u-1",
    name: overrides.name ?? "Test",
    priority: overrides.priority ?? 100,
    is_active: overrides.is_active ?? 1,
    match_merchant_contains: overrides.match_merchant_contains ?? null,
    match_merchant_regex: overrides.match_merchant_regex ?? null,
    match_min_amount: overrides.match_min_amount ?? null,
    match_max_amount: overrides.match_max_amount ?? null,
    match_account_id: overrides.match_account_id ?? null,
    match_payment_mode: overrides.match_payment_mode ?? null,
    match_sms_keyword: overrides.match_sms_keyword ?? null,
    action_category_id: overrides.action_category_id ?? null,
    action_payment_mode: overrides.action_payment_mode ?? null,
    action_tag_ids: overrides.action_tag_ids ?? null,
    action_is_right_spend: overrides.action_is_right_spend ?? null,
    action_mark_auto: overrides.action_mark_auto ?? 0,
    action_link_to_investment_bucket_id: overrides.action_link_to_investment_bucket_id ?? null,
    apply_count: 0,
    last_applied_at: null,
    created_at: "2026-04-29T00:00:00Z",
    updated_at: "2026-04-29T00:00:00Z",
  };
}

function target(overrides: Partial<EvaluationTarget> = {}): EvaluationTarget {
  return {
    amount: overrides.amount ?? 500,
    merchant: overrides.merchant ?? null,
    account_id: overrides.account_id ?? null,
    payment_mode_id: overrides.payment_mode_id ?? null,
    sms_body: overrides.sms_body ?? null,
  };
}

describe("evaluateRule — merchant matching", () => {
  it("matches case-insensitive substring on merchant_contains", () => {
    const r = rule({ match_merchant_contains: "swiggy" });
    expect(evaluateRule(r, target({ merchant: "SWIGGY*BLR" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "Swiggy Instamart" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "ZOMATO" }))).toBe(false);
  });

  it("rejects when merchant is null", () => {
    const r = rule({ match_merchant_contains: "swiggy" });
    expect(evaluateRule(r, target({ merchant: null }))).toBe(false);
  });

  it("matches regex patterns", () => {
    const r = rule({ match_merchant_regex: "^AMZN(\\.in)?" });
    expect(evaluateRule(r, target({ merchant: "AMZN.in" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "AMZN" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "AMAZON" }))).toBe(false);
  });

  it("rejects invalid regex (never matches)", () => {
    const r = rule({ match_merchant_regex: "[" });
    expect(evaluateRule(r, target({ merchant: "anything" }))).toBe(false);
  });
});

describe("evaluateRule — amount matching", () => {
  it("matches min-amount inclusive", () => {
    const r = rule({ match_min_amount: 100 });
    expect(evaluateRule(r, target({ amount: 100 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 99 }))).toBe(false);
  });

  it("matches max-amount inclusive", () => {
    const r = rule({ match_max_amount: 1000 });
    expect(evaluateRule(r, target({ amount: 1000 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 1001 }))).toBe(false);
  });

  it("matches both bounds", () => {
    const r = rule({ match_min_amount: 50, match_max_amount: 200 });
    expect(evaluateRule(r, target({ amount: 150 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 50 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 200 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 201 }))).toBe(false);
    expect(evaluateRule(r, target({ amount: 49 }))).toBe(false);
  });
});

describe("evaluateRule — account + payment mode", () => {
  it("matches exact account_id", () => {
    const r = rule({ match_account_id: "acc-123" });
    expect(evaluateRule(r, target({ account_id: "acc-123" }))).toBe(true);
    expect(evaluateRule(r, target({ account_id: "acc-456" }))).toBe(false);
    expect(evaluateRule(r, target({ account_id: null }))).toBe(false);
  });

  it("matches exact payment_mode_id", () => {
    const r = rule({ match_payment_mode: "upi" });
    expect(evaluateRule(r, target({ payment_mode_id: "upi" }))).toBe(true);
    expect(evaluateRule(r, target({ payment_mode_id: "credit_card" }))).toBe(false);
  });
});

describe("evaluateRule — SMS keyword", () => {
  it("matches case-insensitive substring on raw SMS body", () => {
    const r = rule({ match_sms_keyword: "ICICI" });
    expect(evaluateRule(r, target({ sms_body: "Your ICICI A/c x1234..." }))).toBe(true);
    expect(evaluateRule(r, target({ sms_body: "your icici bank..." }))).toBe(true);
    expect(evaluateRule(r, target({ sms_body: "HDFC Bank..." }))).toBe(false);
    expect(evaluateRule(r, target({ sms_body: null }))).toBe(false);
  });
});

describe("evaluateRule — AND semantics", () => {
  it("requires all conditions to match", () => {
    const r = rule({
      match_merchant_contains: "swiggy",
      match_min_amount: 200,
    });
    expect(evaluateRule(r, target({ merchant: "Swiggy", amount: 300 }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "Swiggy", amount: 100 }))).toBe(false);
    expect(evaluateRule(r, target({ merchant: "Zomato", amount: 300 }))).toBe(false);
  });

  it("returns false for a rule with zero conditions (safety)", () => {
    const r = rule({});
    expect(evaluateRule(r, target({ merchant: "anything", amount: 9999 }))).toBe(false);
  });

  it("returns false when rule is inactive", () => {
    const r = rule({ match_merchant_contains: "swiggy", is_active: 0 });
    expect(evaluateRule(r, target({ merchant: "Swiggy" }))).toBe(false);
  });
});

describe("findFirstMatch — priority", () => {
  it("returns first match in provided order (caller sorts by priority)", () => {
    const rules: SmartRule[] = [
      rule({ id: "low", priority: 10, match_merchant_contains: "swiggy" }),
      rule({ id: "high", priority: 100, match_merchant_contains: "swiggy" }),
    ];
    const hit = findFirstMatch(rules, target({ merchant: "Swiggy" }));
    expect(hit?.id).toBe("low");
  });

  it("returns null when nothing matches", () => {
    const rules: SmartRule[] = [
      rule({ id: "a", match_merchant_contains: "swiggy" }),
      rule({ id: "b", match_merchant_contains: "zomato" }),
    ];
    expect(findFirstMatch(rules, target({ merchant: "Blinkit" }))).toBeNull();
  });

  it("returns null for empty rules array", () => {
    expect(findFirstMatch([], target({ merchant: "Swiggy" }))).toBeNull();
  });
});

describe("materialize — action projection", () => {
  it("projects category_id, payment_mode, is_right_spend from rule", () => {
    const r = rule({
      match_merchant_contains: "swiggy",
      action_category_id: "cat-food",
      action_payment_mode: "upi",
      action_is_right_spend: 0,
    });
    const app = materialize(r);
    expect(app.category_id).toBe("cat-food");
    expect(app.payment_mode).toBe("upi");
    expect(app.is_right_spend).toBe(0);
    expect(app.mark_auto).toBe(false);
  });

  it("parses action_tag_ids JSON array", () => {
    const r = rule({
      match_merchant_contains: "swiggy",
      action_tag_ids: JSON.stringify(["t1", "t2"]),
    });
    expect(materialize(r).tag_ids).toEqual(["t1", "t2"]);
  });

  it("returns empty tag list on malformed JSON (graceful)", () => {
    const r = rule({
      match_merchant_contains: "swiggy",
      action_tag_ids: "not json",
    });
    expect(materialize(r).tag_ids).toEqual([]);
  });

  it("returns empty tag list on JSON that isn't an array", () => {
    const r = rule({
      match_merchant_contains: "swiggy",
      action_tag_ids: JSON.stringify({ hack: "you" }),
    });
    expect(materialize(r).tag_ids).toEqual([]);
  });

  it("drops non-string entries from action_tag_ids", () => {
    const r = rule({
      match_merchant_contains: "swiggy",
      action_tag_ids: JSON.stringify(["t1", 42, "t2"]),
    });
    expect(materialize(r).tag_ids).toEqual(["t1", "t2"]);
  });

  it("surfaces mark_auto=true only when rule opts in", () => {
    const r = rule({ match_merchant_contains: "s", action_mark_auto: 1 });
    expect(materialize(r).mark_auto).toBe(true);
  });
});
