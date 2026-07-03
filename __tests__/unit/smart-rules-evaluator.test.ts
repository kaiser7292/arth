/**
 * v15.2.0 — Smart rules evaluator tests (pure functions, no DB).
 * Rewritten for the migration-053 dynamic conditions/actions model.
 */

import {
  evaluateRule,
  findFirstMatch,
  materialize,
  type SmartRule,
  type EvaluationTarget,
  type RuleCondition,
  type RuleAction,
} from "../../services/smart-rules";

function rule(overrides: Partial<SmartRule> = {}): SmartRule {
  return {
    id: overrides.id ?? "r-1",
    user_id: "u-1",
    name: overrides.name ?? "Test",
    priority: overrides.priority ?? 100,
    is_active: overrides.is_active ?? 1,
    match_mode: overrides.match_mode ?? "all",
    conditions: overrides.conditions ?? [],
    actions: overrides.actions ?? [],
    action_link_to_investment_bucket_id: overrides.action_link_to_investment_bucket_id ?? null,
    apply_count: 0,
    last_applied_at: null,
    deleted_at: null,
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
    description: overrides.description ?? null,
    category_id: overrides.category_id ?? null,
  };
}

function cond(c: RuleCondition): RuleCondition {
  return c;
}

describe("evaluateRule — merchant matching", () => {
  it("matches case-insensitive substring with contains", () => {
    const r = rule({ conditions: [cond({ field: "merchant", operator: "contains", value: "swiggy" })] });
    expect(evaluateRule(r, target({ merchant: "SWIGGY*BLR" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "Swiggy Instamart" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "ZOMATO" }))).toBe(false);
  });

  it("rejects contains when merchant is null", () => {
    const r = rule({ conditions: [cond({ field: "merchant", operator: "contains", value: "swiggy" })] });
    expect(evaluateRule(r, target({ merchant: null }))).toBe(false);
  });

  it("not_contains is the inverse of contains", () => {
    const r = rule({ conditions: [cond({ field: "merchant", operator: "not_contains", value: "swiggy" })] });
    expect(evaluateRule(r, target({ merchant: "Zomato" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "Swiggy" }))).toBe(false);
  });

  it("starts_with / ends_with", () => {
    const starts = rule({ conditions: [cond({ field: "merchant", operator: "starts_with", value: "AMZN" })] });
    expect(evaluateRule(starts, target({ merchant: "AMZN.in" }))).toBe(true);
    expect(evaluateRule(starts, target({ merchant: "WWW.AMZN" }))).toBe(false);

    const ends = rule({ conditions: [cond({ field: "merchant", operator: "ends_with", value: "MART" })] });
    expect(evaluateRule(ends, target({ merchant: "Swiggy Instamart" }))).toBe(true);
    expect(evaluateRule(ends, target({ merchant: "Martinis" }))).toBe(false);
  });

  it("matches regex patterns", () => {
    const r = rule({ conditions: [cond({ field: "merchant", operator: "regex", value: "^AMZN(\\.in)?" })] });
    expect(evaluateRule(r, target({ merchant: "AMZN.in" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "AMZN" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "AMAZON" }))).toBe(false);
  });

  it("rejects invalid regex (never matches)", () => {
    const r = rule({ conditions: [cond({ field: "merchant", operator: "regex", value: "[" })] });
    expect(evaluateRule(r, target({ merchant: "anything" }))).toBe(false);
  });

  it("equals / not_equals are case-insensitive exact match", () => {
    const r = rule({ conditions: [cond({ field: "merchant", operator: "equals", value: "Swiggy" })] });
    expect(evaluateRule(r, target({ merchant: "swiggy" }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "Swiggy Instamart" }))).toBe(false);
  });

  it("is_empty / is_not_empty", () => {
    const empty = rule({ conditions: [cond({ field: "merchant", operator: "is_empty", value: null })] });
    expect(evaluateRule(empty, target({ merchant: null }))).toBe(true);
    expect(evaluateRule(empty, target({ merchant: "x" }))).toBe(false);

    const notEmpty = rule({ conditions: [cond({ field: "merchant", operator: "is_not_empty", value: null })] });
    expect(evaluateRule(notEmpty, target({ merchant: "x" }))).toBe(true);
    expect(evaluateRule(notEmpty, target({ merchant: null }))).toBe(false);
  });
});

describe("evaluateRule — amount matching", () => {
  it("greater_than is inclusive (>=)", () => {
    const r = rule({ conditions: [cond({ field: "amount", operator: "greater_than", value: 100 })] });
    expect(evaluateRule(r, target({ amount: 100 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 99 }))).toBe(false);
  });

  it("less_than is inclusive (<=)", () => {
    const r = rule({ conditions: [cond({ field: "amount", operator: "less_than", value: 1000 })] });
    expect(evaluateRule(r, target({ amount: 1000 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 1001 }))).toBe(false);
  });

  it("between matches an inclusive range", () => {
    const r = rule({ conditions: [cond({ field: "amount", operator: "between", value: [50, 200] })] });
    expect(evaluateRule(r, target({ amount: 150 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 50 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 200 }))).toBe(true);
    expect(evaluateRule(r, target({ amount: 201 }))).toBe(false);
    expect(evaluateRule(r, target({ amount: 49 }))).toBe(false);
  });
});

describe("evaluateRule — account, payment mode, category, description, SMS body", () => {
  it("matches exact account_id", () => {
    const r = rule({ conditions: [cond({ field: "account_id", operator: "equals", value: "acc-123" })] });
    expect(evaluateRule(r, target({ account_id: "acc-123" }))).toBe(true);
    expect(evaluateRule(r, target({ account_id: "acc-456" }))).toBe(false);
    expect(evaluateRule(r, target({ account_id: null }))).toBe(false);
  });

  it("matches exact payment_mode", () => {
    const r = rule({ conditions: [cond({ field: "payment_mode", operator: "equals", value: "upi" })] });
    expect(evaluateRule(r, target({ payment_mode_id: "upi" }))).toBe(true);
    expect(evaluateRule(r, target({ payment_mode_id: "credit_card" }))).toBe(false);
  });

  it("matches exact category_id", () => {
    const r = rule({ conditions: [cond({ field: "category_id", operator: "equals", value: "cat-food" })] });
    expect(evaluateRule(r, target({ category_id: "cat-food" }))).toBe(true);
    expect(evaluateRule(r, target({ category_id: "cat-shopping" }))).toBe(false);
  });

  it("matches description contains", () => {
    const r = rule({ conditions: [cond({ field: "description", operator: "contains", value: "lunch" })] });
    expect(evaluateRule(r, target({ description: "Team lunch order" }))).toBe(true);
    expect(evaluateRule(r, target({ description: "Groceries" }))).toBe(false);
  });

  it("matches case-insensitive substring on raw SMS body", () => {
    const r = rule({ conditions: [cond({ field: "sms_body", operator: "contains", value: "ICICI" })] });
    expect(evaluateRule(r, target({ sms_body: "Your ICICI A/c x1234..." }))).toBe(true);
    expect(evaluateRule(r, target({ sms_body: "your icici bank..." }))).toBe(true);
    expect(evaluateRule(r, target({ sms_body: "HDFC Bank..." }))).toBe(false);
    expect(evaluateRule(r, target({ sms_body: null }))).toBe(false);
  });
});

describe("evaluateRule — match_mode ALL vs ANY", () => {
  const conditions: RuleCondition[] = [
    { field: "merchant", operator: "contains", value: "swiggy" },
    { field: "amount", operator: "greater_than", value: 200 },
  ];

  it("'all' requires every condition to match (AND)", () => {
    const r = rule({ match_mode: "all", conditions });
    expect(evaluateRule(r, target({ merchant: "Swiggy", amount: 300 }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "Swiggy", amount: 100 }))).toBe(false);
    expect(evaluateRule(r, target({ merchant: "Zomato", amount: 300 }))).toBe(false);
  });

  it("'any' requires at least one condition to match (OR)", () => {
    const r = rule({ match_mode: "any", conditions });
    expect(evaluateRule(r, target({ merchant: "Zomato", amount: 300 }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "Swiggy", amount: 50 }))).toBe(true);
    expect(evaluateRule(r, target({ merchant: "Zomato", amount: 50 }))).toBe(false);
  });

  it("returns false for a rule with zero conditions (safety)", () => {
    const r = rule({ conditions: [] });
    expect(evaluateRule(r, target({ merchant: "anything", amount: 9999 }))).toBe(false);
  });

  it("returns false when rule is inactive", () => {
    const r = rule({
      is_active: 0,
      conditions: [{ field: "merchant", operator: "contains", value: "swiggy" }],
    });
    expect(evaluateRule(r, target({ merchant: "Swiggy" }))).toBe(false);
  });
});

describe("findFirstMatch — priority", () => {
  it("returns first match in provided order (caller sorts by priority)", () => {
    const matchSwiggy: RuleCondition = { field: "merchant", operator: "contains", value: "swiggy" };
    const rules: SmartRule[] = [
      rule({ id: "low", priority: 10, conditions: [matchSwiggy] }),
      rule({ id: "high", priority: 100, conditions: [matchSwiggy] }),
    ];
    const hit = findFirstMatch(rules, target({ merchant: "Swiggy" }));
    expect(hit?.id).toBe("low");
  });

  it("returns null when nothing matches", () => {
    const rules: SmartRule[] = [
      rule({ id: "a", conditions: [{ field: "merchant", operator: "contains", value: "swiggy" }] }),
      rule({ id: "b", conditions: [{ field: "merchant", operator: "contains", value: "zomato" }] }),
    ];
    expect(findFirstMatch(rules, target({ merchant: "Blinkit" }))).toBeNull();
  });

  it("returns null for empty rules array", () => {
    expect(findFirstMatch([], target({ merchant: "Swiggy" }))).toBeNull();
  });
});

describe("materialize — action projection", () => {
  it("projects category_id, payment_mode, is_right_spend from actions", () => {
    const actions: RuleAction[] = [
      { type: "category", category_id: "cat-food" },
      { type: "payment_mode", payment_mode: "upi" },
      { type: "is_right_spend", is_right_spend: false },
    ];
    const app = materialize(rule({ actions }));
    expect(app.category_id).toBe("cat-food");
    expect(app.payment_mode).toBe("upi");
    expect(app.is_right_spend).toBe(0);
    expect(app.mark_auto).toBe(false);
  });

  it("projects tag_ids from a tags action", () => {
    const app = materialize(rule({ actions: [{ type: "tags", tag_ids: ["t1", "t2"] }] }));
    expect(app.tag_ids).toEqual(["t1", "t2"]);
  });

  it("ignores a tags action with an empty array", () => {
    const app = materialize(rule({ actions: [{ type: "tags", tag_ids: [] }] }));
    expect(app.tag_ids).toEqual([]);
  });

  it("surfaces mark_auto=true only when the action is present", () => {
    expect(materialize(rule({ actions: [{ type: "mark_auto" }] })).mark_auto).toBe(true);
    expect(materialize(rule({ actions: [] })).mark_auto).toBe(false);
  });

  it("later actions of the same type win", () => {
    const actions: RuleAction[] = [
      { type: "category", category_id: "cat-a" },
      { type: "category", category_id: "cat-b" },
    ];
    expect(materialize(rule({ actions })).category_id).toBe("cat-b");
  });

  it("returns empty tag list and null projections for a rule with no actions", () => {
    const app = materialize(rule({ actions: [] }));
    expect(app.category_id).toBeNull();
    expect(app.payment_mode).toBeNull();
    expect(app.tag_ids).toEqual([]);
    expect(app.is_right_spend).toBeNull();
  });
});

describe("malformed stored JSON (defensive parsing)", () => {
  it("evaluateRule treats a rule with no conditions array as never-matching, not a crash", () => {
    const r = rule({ conditions: [] });
    expect(() => evaluateRule(r, target())).not.toThrow();
    expect(evaluateRule(r, target())).toBe(false);
  });
});
