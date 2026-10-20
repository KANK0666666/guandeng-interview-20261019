import {
  CUSTOM_TEAM,
  KA_TEAM,
  interceptionCostAccounting,
} from "./service-policy.mjs";

export const STRATEGY_TEAMS = [
  KA_TEAM,
  "国内电商组",
  "生态服务商组",
  CUSTOM_TEAM,
];
export const STANDARD_THRESHOLDS = Object.freeze(
  Object.fromEntries(STRATEGY_TEAMS.map((name) => [name, 20])),
);
// An adjustable business choice, not a threshold proven optimal by the CSV.
export const REVIEW_THRESHOLDS = Object.freeze({
  ...STANDARD_THRESHOLDS,
  [KA_TEAM]: 8,
});

export function normalizeThresholds(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    STRATEGY_TEAMS.map((name) => {
      const input = source[name];
      return [
        name,
        typeof input === "number" && Number.isFinite(input)
          ? Math.max(0, Math.min(70, Math.round(input)))
          : REVIEW_THRESHOLDS[name],
      ];
    }),
  );
}

function summarize(name, rows, matches) {
  const selected = rows.filter(matches);
  const count = (items, outcome) =>
    items.filter((row) => row.outcome === outcome).length;
  return {
    name,
    jobs: rows.length,
    succeeded: count(rows, "success"),
    failed: count(rows, "failure"),
    unknown: count(rows, "unknown"),
    policy: {
      intercepted: selected.length,
      caughtFailures: count(selected, "failure"),
      falseInterceptions: count(selected, "success"),
      // Missing outcomes still incur the full check cost.
      interceptedUnknown: count(selected, "unknown"),
    },
  };
}

export function calculateSyncStrategy(rows, settings, costs) {
  const thresholds = normalizeThresholds(settings);
  const groups = STRATEGY_TEAMS.map((name) =>
    summarize(
      name,
      rows.filter((row) => row.team_id === name),
      (row) => row.lagMinutes >= thresholds[name],
    ),
  );
  return { thresholds, ...interceptionCostAccounting(groups, costs) };
}

// Exploratory only: the CSV does not establish when memory was observable.
// This selection never changes the submission-time sync rule.
export function calculateMemoryCandidate(rows, threshold, costs) {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 30) {
    throw new RangeError("显存探索门槛必须为 0—30 MB 的整数");
  }
  const group = summarize(
    CUSTOM_TEAM,
    rows.filter((row) => row.team_id === CUSTOM_TEAM),
    (row) => {
      const raw = row.gpu_mem_free_mb;
      if (raw === null || raw === undefined || String(raw).trim() === "")
        return false;
      const memory = Number(raw);
      return Number.isFinite(memory) && memory >= 0 && memory <= threshold;
    },
  );
  return interceptionCostAccounting([group], costs).teams[0];
}
