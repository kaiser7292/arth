export type PatternType =
  | "lifestyle_creep"
  | "category_drift"
  | "merchant_shift"
  | "seasonal_spike"
  | "weekend_warrior"
  | "micro_leak"
  | "budget_breach"
  | "goal_jeopardy"
  | "savings_erosion"
  | "credit_card_creep"
  | "account_concentration"
  | "recurring_growth";

export type Severity = "celebrate" | "info" | "warning" | "critical";

export type Classification = "fixed" | "variable" | "semi_fixed";

export type ClassificationSource =
  | "auto_detected"
  | "user_confirmed"
  | "user_corrected";

export type ConfidenceLevel = "learning" | "low" | "moderate" | "high" | "confirmed";

export interface PatternResult {
  type: PatternType;
  severity: Severity;
  confidence: number;
  title: string;
  detail: string;
  metric: number;
  metricLabel: string;
  sourceTransactionIds: string[];
  affectedCategoryIds?: string[];
  affectedMerchantNames?: string[];
  affectedAccountIds?: string[];
  timeRange: { start: string; end: string };
}

export interface RankedInsight {
  id: string;
  pattern: PatternResult;
  score: number;
  scoreBreakdown: {
    impact: number;
    actionability: number;
    urgency: number;
    confidence: number;
  };
  action?: ActionSuggestion;
  relatedInsightIds?: string[];
}

export interface ActionSuggestion {
  text: string;
  savingsAmount: number;
  savingsPeriod: "month" | "year";
  difficulty: "easy" | "moderate" | "hard";
}

export interface InsightNode {
  id: string;
  type: "insight" | "dimension" | "group" | "transaction";
  label: string;
  amount: number;
  count: number;
  percentOfParent?: number;
  children?: InsightNode[];
  transactionIds: string[];
  metadata?: Record<string, unknown>;
}

export interface DrillDimension {
  key: "category" | "merchant" | "time" | "account" | "payment_mode";
  label: string;
  icon: string;
  groups: InsightNode[];
}

export interface AnalyticsDashboard {
  generatedAt: string;
  period: { start: string; end: string };
  insights: RankedInsight[];
  totalPatterns: number;
  dataVersion: number;
}

export interface DrillableAmount {
  amount: number;
  transactionIds: string[];
  categoryId?: string;
  merchantName?: string;
  accountId?: string;
}

export interface ClassifiedExpense {
  id: string;
  amount: number;
  date: string;
  categoryId: string;
  merchantNormalized: string;
  accountId: string | null;
  paymentMode: string | null;
  classification: Classification;
  isRightSpend: boolean;
}

export interface RealisticForecast {
  month: string;
  fixedDone: { total: number; items: FixedForecastItem[] };
  fixedPending: { total: number; items: FixedForecastItem[] };
  variable: VariableForecast;
  projectedTotal: number;
  budget: number | null;
  breathingRoom: number | null;
  confidence: ConfidenceLevel;
  dataMonths: number;
}

export interface FixedForecastItem {
  classificationId: string;
  merchant: string;
  expectedAmount: number;
  expectedDay: number;
  frequency: string;
  categoryId: string | null;
  arrived: boolean;
  actualExpenseId?: string;
  actualAmount?: number;
  actualDate?: string;
}

export interface VariableForecast {
  spentSoFar: number;
  dailyPace: number;
  daysElapsed: number;
  daysLeft: number;
  projected: number;
  historicalAvg: number;
  categoryPaces: CategoryPace[];
}

export interface CategoryPace {
  categoryId: string;
  categoryName: string;
  dailyPace: number;
  projected: number;
  budget: number | null;
  breachDriver?: "fixed_costs_exceed_budget" | "variable_pace_too_high";
}

export interface CategoryForecast {
  categoryId: string;
  categoryName: string;
  fixedTotal: number;
  variableProjected: number;
  totalProjected: number;
  budget: number | null;
  breachDriver?: "fixed_costs_exceed_budget" | "variable_pace_too_high";
}

export interface YearEndForecast {
  fyYear: number;
  monthsElapsed: number;
  monthsRemaining: number;
  actualSpent: number;
  projectedRemaining: number;
  projectedTotal: number;
  monthlyAvgActual: number;
  monthlyAvgProjected: number;
  annualBudget: number | null;
  breathingRoom: number | null;
  confidence: ConfidenceLevel;
}

export interface PendingClassification {
  id: string;
  merchantNormalized: string;
  amount: number;
  frequency: string;
  occurrenceCount: number;
  confidence: number;
  evidence: { date: string; amount: number }[];
}

export interface NudgeState {
  id: string;
  type: "learning" | "monthly_review" | "pattern_break" | "amount_change";
  classification: PendingClassification;
  shownAt?: string;
  dismissedAt?: string;
}
