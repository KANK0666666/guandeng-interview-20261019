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
