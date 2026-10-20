import type { interceptionCostAccounting } from "./service-policy.mjs";

export type StrategyRow = {
  team_id: string;
  outcome: "success" | "failure" | "unknown";
  lagMinutes: number;
  gpu_mem_free_mb: string | number | null;
};
export type Thresholds = Record<string, number>;
export const STRATEGY_TEAMS: string[];
export const STANDARD_THRESHOLDS: Readonly<Thresholds>;
export const REVIEW_THRESHOLDS: Readonly<Thresholds>;
export function normalizeThresholds(value: unknown): Thresholds;
export function calculateSyncStrategy(
  rows: StrategyRow[],
  settings: Thresholds,
  costs: { crash: number; intercept: number },
): ReturnType<typeof interceptionCostAccounting> & { thresholds: Thresholds };
export function calculateMemoryCandidate(
  rows: StrategyRow[],
  threshold: number,
  costs: { crash: number; intercept: number },
): ReturnType<typeof interceptionCostAccounting>["teams"][number];
