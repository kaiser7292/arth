import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolicyType = "term" | "health" | "home" | "car" | "life" | "other";
export type PremiumFrequency = "annual" | "semi_annual" | "quarterly" | "monthly";

export interface InsurancePolicy {
  id: string;
  user_id: number;
  policy_type: PolicyType;
  provider_name: string;
  policy_number: string | null;
  sum_insured: number;
  annual_premium: number;
  premium_frequency: PremiumFrequency;
  start_date: string | null;
  expiry_date: string | null;
  is_active: number;
  notes: string | null;
  covers_family: number;
  family_members_covered: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface InsurancePolicyInput {
  policy_type: PolicyType;
  provider_name: string;
  policy_number?: string;
  sum_insured: number;
  annual_premium: number;
  premium_frequency: PremiumFrequency;
  start_date?: string;
  expiry_date?: string;
  is_active?: number;
  notes?: string;
  covers_family?: number;
  family_members_covered?: number;
}

export interface InsuranceAdequacy {
  term: { sumInsured: number; annualIncome: number; ratio: number; isAdequate: boolean } | null;
  health: { sumInsured: number; perMember: number; familySize: number; isAdequate: boolean } | null;
  home: { hasActive: boolean };
  car: { hasActive: boolean };
  gaps: string[];
  coveredCount: number;
  totalRelevant: number;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getAllPolicies(userId: string | number = 1): Promise<InsurancePolicy[]> {
  const db = getDatabase();
  return db.getAllAsync<InsurancePolicy>(
    "SELECT * FROM insurance_policies WHERE user_id = ? AND deleted_at IS NULL ORDER BY policy_type, provider_name",
    userId,
  );
}

export async function getActivePolicies(userId: string | number = 1): Promise<InsurancePolicy[]> {
  const db = getDatabase();
  return db.getAllAsync<InsurancePolicy>(
    "SELECT * FROM insurance_policies WHERE user_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY policy_type, provider_name",
    userId,
  );
}

export async function getPoliciesByType(userId: string | number, type: PolicyType): Promise<InsurancePolicy[]> {
  const db = getDatabase();
  return db.getAllAsync<InsurancePolicy>(
    "SELECT * FROM insurance_policies WHERE user_id = ? AND policy_type = ? AND deleted_at IS NULL ORDER BY provider_name",
    userId,
    type,
  );
}

export async function getPolicyById(id: string): Promise<InsurancePolicy | null> {
  const db = getDatabase();
  return db.getFirstAsync<InsurancePolicy>(
    "SELECT * FROM insurance_policies WHERE id = ? AND deleted_at IS NULL",
    id,
  );
}

export async function addPolicy(userId: string | number, input: InsurancePolicyInput): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO insurance_policies
      (id, user_id, policy_type, provider_name, policy_number, sum_insured, annual_premium,
       premium_frequency, start_date, expiry_date, is_active, notes, covers_family,
       family_members_covered, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    input.policy_type,
    input.provider_name,
    input.policy_number ?? null,
    input.sum_insured,
    input.annual_premium,
    input.premium_frequency,
    input.start_date ?? null,
    input.expiry_date ?? null,
    input.is_active ?? 1,
    input.notes ?? null,
    input.covers_family ?? 0,
    input.family_members_covered ?? 1,
    now,
    now,
  );
  bumpDataVersion();
  return id;
}

export async function updatePolicy(id: string, input: Partial<InsurancePolicyInput>): Promise<void> {
  const db = getDatabase();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  const fields: Array<[keyof InsurancePolicyInput, string | number | null | undefined]> = [
    ["policy_type", input.policy_type],
    ["provider_name", input.provider_name],
    ["policy_number", input.policy_number],
    ["sum_insured", input.sum_insured],
    ["annual_premium", input.annual_premium],
    ["premium_frequency", input.premium_frequency],
    ["start_date", input.start_date],
    ["expiry_date", input.expiry_date],
    ["is_active", input.is_active],
    ["notes", input.notes],
    ["covers_family", input.covers_family],
    ["family_members_covered", input.family_members_covered],
  ];

  for (const [col, val] of fields) {
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;

  sets.push("updated_at = ?");
  vals.push(new Date().toISOString());
  vals.push(id);

  await db.runAsync(
    `UPDATE insurance_policies SET ${sets.join(", ")} WHERE id = ?`,
    ...vals,
  );
  bumpDataVersion();
}

export async function deletePolicy(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE insurance_policies SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    id,
  );
  bumpDataVersion();
}

// ---------------------------------------------------------------------------
// Adequacy computation
// ---------------------------------------------------------------------------

export async function getInsuranceAdequacy(
  userId: string | number,
  annualIncome: number,
): Promise<InsuranceAdequacy> {
  const policies = await getActivePolicies(userId);

  const termPolicies = policies.filter((p) => p.policy_type === "term");
  const healthPolicies = policies.filter((p) => p.policy_type === "health");
  const homePolicies = policies.filter((p) => p.policy_type === "home");
  const carPolicies = policies.filter((p) => p.policy_type === "car");

  const gaps: string[] = [];
  let coveredCount = 0;
  const totalRelevant = 3; // term, health, car

  // Term: sum insured ≥ 10× annual income
  let term: InsuranceAdequacy["term"] = null;
  if (termPolicies.length > 0) {
    const totalTermCover = termPolicies.reduce((s, p) => s + p.sum_insured, 0);
    const ratio = annualIncome > 0 ? totalTermCover / annualIncome : 0;
    const isAdequate = ratio >= 10;
    term = { sumInsured: totalTermCover, annualIncome, ratio, isAdequate };
    if (isAdequate) coveredCount++;
    else gaps.push(`Term cover ${Math.round(ratio)}× income — recommended 10×`);
  } else {
    gaps.push("No term insurance");
  }

  // Health: ≥ ₹10L per family member
  let health: InsuranceAdequacy["health"] = null;
  if (healthPolicies.length > 0) {
    const totalHealthCover = healthPolicies.reduce((s, p) => s + p.sum_insured, 0);
    const totalMembers = Math.max(
      1,
      healthPolicies.reduce((s, p) => (p.covers_family ? p.family_members_covered : 1), 0),
    );
    const perMember = totalHealthCover / totalMembers;
    const isAdequate = perMember >= 1000000;
    health = { sumInsured: totalHealthCover, perMember, familySize: totalMembers, isAdequate };
    if (isAdequate) coveredCount++;
    else gaps.push(`Health cover ₹${Math.round(perMember / 100000)}L/member — recommended ₹10L+`);
  } else {
    gaps.push("No health insurance");
  }

  // Home: just tracked, no adequacy threshold
  const home = { hasActive: homePolicies.length > 0 };

  // Car: any active = adequate
  const car = { hasActive: carPolicies.length > 0 };
  if (car.hasActive) coveredCount++;
  else gaps.push("No car insurance");

  return { term, health, home, car, gaps, coveredCount, totalRelevant };
}

// ---------------------------------------------------------------------------
// Helpers for report integration
// ---------------------------------------------------------------------------

export interface InsuranceRiskFlag {
  severity: "critical" | "high" | "medium";
  title: string;
  description: string;
}

export async function getInsuranceRiskFlags(
  userId: string | number,
  annualIncome: number,
): Promise<InsuranceRiskFlag[]> {
  const adequacy = await getInsuranceAdequacy(userId, annualIncome);
  const flags: InsuranceRiskFlag[] = [];

  if (!adequacy.term) {
    flags.push({
      severity: "critical",
      title: "No term life insurance",
      description: "If you have dependents, ensure term life cover of at least 10× annual income. This is non-negotiable until your corpus can self-insure.",
    });
  } else if (!adequacy.term.isAdequate) {
    flags.push({
      severity: "high",
      title: `Term cover only ${Math.round(adequacy.term.ratio)}× income`,
      description: `Your term insurance covers ₹${Math.round(adequacy.term.sumInsured / 100000)}L (${Math.round(adequacy.term.ratio)}× income). Recommended: at least 10× annual income.`,
    });
  }

  if (!adequacy.health) {
    flags.push({
      severity: "critical",
      title: "No health insurance",
      description: "A single hospitalisation can wipe out years of savings. Get at least ₹10L cover per family member.",
    });
  } else if (!adequacy.health.isAdequate) {
    flags.push({
      severity: "high",
      title: `Health cover below ₹10L/member`,
      description: `Current cover: ₹${Math.round(adequacy.health.sumInsured / 100000)}L for ${adequacy.health.familySize} members (₹${Math.round(adequacy.health.perMember / 100000)}L each). Recommended: ₹10L+ per member.`,
    });
  }

  return flags;
}

export function getInsuranceScoreBonus(adequacy: InsuranceAdequacy): number {
  let bonus = 0;
  if (adequacy.health?.isAdequate) bonus += 2;
  return bonus;
}
