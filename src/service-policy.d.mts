export type ServicePolicy = {
  kaWeight: number;
  customWeight: number;
  noResultMinutes: number;
};
export type ServiceScenario = {
  team: string;
  status: "pending" | "success" | "failure";
  elapsedMinutes: number | null;
  assigned: boolean;
};
export type CoverageGroup = {
  name: string;
  failed: number;
  policy: { caughtFailures: number };
};
export type HistoryFilters = {
  scope?: "all" | "hits" | "misses";
  team?: string;
  outcome?: "success" | "failure" | "unknown" | "";
  query?: string;
};
export type ImpactGroup = CoverageGroup & {
  jobs: number;
  succeeded: number;
  unknown: number;
  policy: {
    intercepted: number;
    caughtFailures: number;
    falseInterceptions: number;
    interceptedUnknown: number;
  };
};
export type ImpactValues = {
  expectedAvoidedFailures: number;
  expectedRemainingFailures: number;
  weightedAvoidedFailures: number;
  checkHours: number;
  avoidedHours: number;
  netHours: number;
};
export function ruleOutcomeBreakdown(groups: ImpactGroup[]): {
  successUnflagged: number;
  failureUnflagged: number;
  failureFlagged: number;
  successFlagged: number;
  unknownFlagged: number;
  unknownUnflagged: number;
};
export function serviceImpact(
  groups: ImpactGroup[],
  policy: ServicePolicy,
  effectiveness: number,
  costs: { crash: number; intercept: number },
): {
  teams: (ImpactGroup & ImpactValues & { weight: number })[];
  totals: ImpactValues &
    Omit<ImpactGroup, "name" | "policy"> &
    ImpactGroup["policy"];
};
export type ReviewCostValues = {
  successfulCheckHours: number;
  failedCheckHours: number;
  unknownCheckHours: number;
  baselineFailureHours: number;
  remainingFailureHours: number;
  totalScenarioHours: number;
  breakEvenEffectiveness: number | null;
  assessment: "equal" | "lower" | "higher";
};
export function reviewCostAccounting(
  groups: ImpactGroup[],
  effectiveness: number,
  costs: { crash: number; intercept: number },
): {
  teams: (ReturnType<typeof serviceImpact>["teams"][number] &
    ReviewCostValues)[];
  totals: ReturnType<typeof serviceImpact>["totals"] & ReviewCostValues;
};
export type InterceptionCostValues = {
  correctInterceptionUnitNet: number;
  correctInterceptionNetHours: number;
  otherInterceptionHours: number;
  missedFailures: number;
  missedFailureHours: number;
};
export function interceptionCostAccounting(
  groups: ImpactGroup[],
  costs: { crash: number; intercept: number },
): {
  teams: (ReturnType<typeof reviewCostAccounting>["teams"][number] &
    InterceptionCostValues)[];
  totals: ReturnType<typeof reviewCostAccounting>["totals"] &
    InterceptionCostValues;
};
export function selectHistoricalTasks<
  T extends {
    team_id: string;
    created_at: string;
    job_id: string;
    scene_type: string;
    outcome: string;
    intercept: boolean;
  },
>(rows: T[], policy: ServicePolicy, filters?: HistoryFilters): T[];
export type StrategyCostInputs = {
  additionalChecks: number | null;
  otherHours: number | null;
  additionalAvoidedFailures: number | null;
};
export function completeStrategyAccounting(
  base: Pick<
    ImpactValues,
    "checkHours" | "avoidedHours" | "expectedRemainingFailures"
  > & { baselineFailureHours: number },
  additions: StrategyCostInputs,
  costs: { crash: number; intercept: number },
): {
  status: "invalid" | "incomplete" | "scenario";
  missing: string[];
  errors: string[];
  additionalCheckHours: number | null;
  totalCostHours: number | null;
  totalAvoidedHours: number | null;
  remainingFailureHours: number | null;
  totalBurdenHours: number | null;
  netHours: number | null;
};
export const KA_TEAM: string;
export const CUSTOM_TEAM: string;
export const TEAMS: string[];
export const DEFAULT_SERVICE_POLICY: Readonly<ServicePolicy>;
export function normalizeServicePolicy(value: unknown): ServicePolicy;
export function teamWeight(team: string, policy: ServicePolicy): number;
export function isProtectedTeam(team: string): boolean;
export function sortHistoricalQueue<
  T extends { team_id: string; created_at: string; job_id: string },
>(rows: T[], policy: ServicePolicy): T[];
export function weightedFailureCoverage(
  groups: CoverageGroup[],
  policy: ServicePolicy,
): {
  weightedFailures: number;
  weightedCaught: number;
  coverage: number | null;
  protectedMissed: number;
};
export function serviceDecision(
  scenario: ServiceScenario,
  policy: ServicePolicy,
): {
  code:
    | "check-input"
    | "completed"
    | "in-progress"
    | "fault"
    | "follow-up"
    | "watch"
    | "existing-process";
  weight: number;
  threshold: number;
  title: string;
  owner: string;
  detail: string;
};
