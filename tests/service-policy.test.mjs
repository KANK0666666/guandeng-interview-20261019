import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import {
  CUSTOM_TEAM,
  DEFAULT_SERVICE_POLICY,
  KA_TEAM,
  TEAMS,
  normalizeServicePolicy,
  serviceDecision,
  serviceImpact,
  selectHistoricalTasks,
  ruleOutcomeBreakdown,
  reviewCostAccounting,
  interceptionCostAccounting,
  completeStrategyAccounting,
  sortHistoricalQueue,
  weightedFailureCoverage,
} from "../src/service-policy.mjs";
import { loadRender } from "../server/render.mjs";
import { fileURLToPath } from "node:url";

// Synthetic scenarios exercise policy boundaries only; they never enter CSV metrics.
const pending = {
  team: KA_TEAM,
  status: "pending",
  elapsedMinutes: 10,
  assigned: false,
};

test("business settings recover from invalid storage and stay within usable ranges", () => {
  for (const value of [null, undefined, "bad", []]) {
    assert.deepEqual(normalizeServicePolicy(value), DEFAULT_SERVICE_POLICY);
  }
  assert.deepEqual(
    normalizeServicePolicy({
      kaWeight: -5,
      customWeight: 999,
      noResultMinutes: 0,
    }),
    { kaWeight: 1, customWeight: 500, noResultMinutes: 1 },
  );
  assert.deepEqual(
    normalizeServicePolicy({
      kaWeight: Infinity,
      customWeight: "50",
      noResultMinutes: NaN,
    }),
    DEFAULT_SERVICE_POLICY,
  );
  assert.deepEqual(
    normalizeServicePolicy({
      kaWeight: 110.7,
      customWeight: 40.2,
      noResultMinutes: 40,
    }),
    { kaWeight: 111, customWeight: 40, noResultMinutes: 30 },
  );
});

test("KA and custom follow-up begins exactly at the deadline even at weight one", () => {
  const lowWeights = { kaWeight: 1, customWeight: 1, noResultMinutes: 10 };
  for (const team of [KA_TEAM, CUSTOM_TEAM]) {
    assert.equal(
      serviceDecision({ ...pending, team, elapsedMinutes: 9.99 }, lowWeights)
        .code,
      "watch",
    );
    assert.equal(
      serviceDecision({ ...pending, team }, lowWeights).code,
      "follow-up",
    );
    assert.equal(
      serviceDecision({ ...pending, team, elapsedMinutes: 500 }, lowWeights)
        .code,
      "follow-up",
    );
    const later = { ...lowWeights, noResultMinutes: 15 };
    assert.equal(serviceDecision({ ...pending, team }, later).code, "watch");
    assert.equal(
      serviceDecision({ ...pending, team, elapsedMinutes: 15 }, later).code,
      "follow-up",
    );
  }
});

test("submission waiting clock is independent of asset sync age and historical missing outcomes", () => {
  assert.equal(
    serviceDecision({ ...pending, lagMinutes: 0 }).code,
    "follow-up",
  );
  assert.equal(
    serviceDecision({ ...pending, elapsedMinutes: 2, lagMinutes: 70 }).code,
    "watch",
  );
  assert.equal(
    serviceDecision({ ...pending, status: "unknown" }).code,
    "check-input",
  );
  assert.equal(
    serviceDecision({ ...pending, elapsedMinutes: null, is_success: "" }).code,
    "check-input",
  );
});

test("every team's explicit failure gets immediate help; returned success ends waiting follow-up", () => {
  for (const team of TEAMS) {
    assert.equal(
      serviceDecision({
        ...pending,
        team,
        status: "failure",
        elapsedMinutes: 0,
      }).code,
      "fault",
    );
    assert.equal(
      serviceDecision({
        ...pending,
        team,
        status: "failure",
        elapsedMinutes: null,
      }).code,
      "fault",
    );
    assert.equal(
      serviceDecision({
        ...pending,
        team,
        status: "success",
        elapsedMinutes: 99,
      }).code,
      "completed",
    );
  }
});

test("assigned cases avoid duplicate follow-up and ordinary waiting tasks retain existing service", () => {
  assert.equal(
    serviceDecision({ ...pending, assigned: true }).code,
    "in-progress",
  );
  assert.equal(
    serviceDecision({
      ...pending,
      team: "国内电商组",
      status: "failure",
      assigned: true,
    }).code,
    "in-progress",
  );
  for (const team of ["国内电商组", "生态服务商组"]) {
    assert.equal(
      serviceDecision({ ...pending, team, elapsedMinutes: 99 }).code,
      "existing-process",
    );
  }
  for (const elapsedMinutes of [null, undefined, -1, NaN, Infinity, "12"]) {
    assert.equal(
      serviceDecision({ ...pending, elapsedMinutes }).code,
      "check-input",
    );
  }
  assert.equal(
    serviceDecision({ ...pending, team: "未确认团队" }).code,
    "check-input",
  );
});

test("historical order follows adjustable importance then submission time without reading outcome or mutating rows", () => {
  const rows = [
    {
      job_id: "10",
      team_id: CUSTOM_TEAM,
      created_at: "2026-09-01T01:00:00Z",
      outcome: "failure",
    },
    {
      job_id: "3",
      team_id: KA_TEAM,
      created_at: "2026-09-01T03:00:00Z",
      outcome: "success",
    },
    {
      job_id: "2",
      team_id: KA_TEAM,
      created_at: "2026-09-01T11:00:00+08:00",
      outcome: "unknown",
    },
    {
      job_id: "1",
      team_id: "国内电商组",
      created_at: "2026-09-01T00:00:00Z",
      outcome: "failure",
    },
  ];
  const before = structuredClone(rows);
  const ids = (list) => list.map((row) => row.job_id);
  assert.deepEqual(ids(sortHistoricalQueue(rows)), ["2", "3", "10", "1"]);
  assert.deepEqual(ids(sortHistoricalQueue(rows, { customWeight: 200 })), [
    "10",
    "2",
    "3",
    "1",
  ]);
  assert.deepEqual(
    ids(sortHistoricalQueue(rows, { kaWeight: 1, customWeight: 1 })),
    ["1", "10", "2", "3"],
  );
  assert.deepEqual(
    ids(
      sortHistoricalQueue(rows.map((row) => ({ ...row, outcome: "success" }))),
    ),
    ["2", "3", "10", "1"],
  );
  assert.deepEqual(rows, before);
});

test("weighted coverage reproduces from the raw CSV and cannot inflate physical hours or hit counts", () => {
  const records = parse(
    readFileSync(new URL("../data/render_jobs.csv", import.meta.url)),
    { columns: true },
  );
  const unique = [...new Map(records.map((row) => [row.job_id, row])).values()];
  const groups = TEAMS.map((name) => {
    const rows = unique.filter((row) => row.team_id === name);
    const failures = rows.filter((row) => row.is_success === "0");
    const hit = (row) =>
      Date.parse(row.created_at) - Date.parse(row.asset_synced_at) >=
      20 * 60_000;
    return {
      name,
      failed: failures.length,
      policy: {
        intercepted: rows.filter(hit).length,
        caughtFailures: failures.filter(hit).length,
      },
    };
  });
  const before = structuredClone(groups);
  const baseline = weightedFailureCoverage(groups, {
    kaWeight: 1,
    customWeight: 1,
  });
  const priority = weightedFailureCoverage(groups);
  assert.equal(baseline.coverage, 112 / 134);
  assert.equal(priority.weightedCaught, 3756);
  assert.equal(priority.weightedFailures, 4621);
  assert.equal(priority.coverage, 3756 / 4621);
  assert.equal(priority.protectedMissed, 17);
  assert.equal(
    weightedFailureCoverage(groups, { kaWeight: 500, customWeight: 500 })
      .protectedMissed,
    17,
  );
  const intercepted = groups.reduce(
    (sum, group) => sum + group.policy.intercepted,
    0,
  );
  const caught = groups.reduce(
    (sum, group) => sum + group.policy.caughtFailures,
    0,
  );
  assert.equal(intercepted, 272);
  assert.equal(caught * 120 * 0.5 - intercepted * 20, 1280);
  assert.deepEqual(groups, before);
});

test("empty failure evidence stays unestimated instead of claiming zero or full coverage", () => {
  assert.equal(weightedFailureCoverage([]).coverage, null);
  assert.equal(
    weightedFailureCoverage([
      { name: KA_TEAM, failed: 0, policy: { caughtFailures: 0 } },
    ]).coverage,
    null,
  );
});

test("live scenario separates historical outcomes, expected avoided failures, and full human-check costs", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const half = serviceImpact(
    metrics.byTeam,
    DEFAULT_SERVICE_POLICY,
    50,
    metrics.costs,
  );
  assert.equal(half.totals.succeeded, 772);
  assert.equal(half.totals.failed, 134);
  assert.equal(half.totals.unknown, 51);
  assert.equal(half.totals.expectedAvoidedFailures, 56);
  assert.equal(half.totals.expectedRemainingFailures, 78);
  assert.equal(half.totals.weightedAvoidedFailures, 1878);
  assert.equal(half.totals.checkHours, 5440);
  assert.equal(half.totals.avoidedHours, 6720);
  assert.equal(half.totals.netHours, 1280);
  const custom = half.teams.find((group) => group.name === CUSTOM_TEAM);
  assert.equal(custom.expectedAvoidedFailures, 6.5);
  assert.equal(custom.expectedRemainingFailures, 18.5);
  assert.equal(custom.checkHours, 1380); // includes 55 successes and one unknown
  assert.equal(custom.netHours, -600);
  const zero = serviceImpact(
    metrics.byTeam,
    DEFAULT_SERVICE_POLICY,
    0,
    metrics.costs,
  );
  assert.equal(zero.totals.expectedRemainingFailures, 134);
  assert.equal(zero.totals.netHours, -5440);
  assert.equal(zero.totals.weightedAvoidedFailures, 0);
  const full = serviceImpact(
    metrics.byTeam,
    DEFAULT_SERVICE_POLICY,
    100,
    metrics.costs,
  );
  assert.equal(full.totals.expectedAvoidedFailures, 112);
  assert.equal(full.totals.expectedRemainingFailures, 22); // never implies all failures fixed
  assert.equal(full.totals.netHours, 8000);
  for (const value of [NaN, Infinity, -1, 101]) {
    assert.throws(
      () =>
        serviceImpact(
          metrics.byTeam,
          DEFAULT_SERVICE_POLICY,
          value,
          metrics.costs,
        ),
      RangeError,
    );
  }
});

test("changing importance updates only weighted protection, not historical success or physical hours", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const original = structuredClone(metrics.byTeam);
  const base = serviceImpact(
    metrics.byTeam,
    DEFAULT_SERVICE_POLICY,
    50,
    metrics.costs,
  );
  const raised = serviceImpact(
    metrics.byTeam,
    { ...DEFAULT_SERVICE_POLICY, customWeight: 200 },
    50,
    metrics.costs,
  );
  assert.equal(
    base.teams.find((group) => group.name === CUSTOM_TEAM)
      .weightedAvoidedFailures,
    195,
  );
  assert.equal(
    raised.teams.find((group) => group.name === CUSTOM_TEAM)
      .weightedAvoidedFailures,
    1300,
  );
  assert.equal(raised.totals.weightedAvoidedFailures, 2983);
  for (const key of [
    "succeeded",
    "failed",
    "unknown",
    "intercepted",
    "expectedAvoidedFailures",
    "expectedRemainingFailures",
    "netHours",
    "checkHours",
  ]) {
    assert.equal(raised.totals[key], base.totals[key]);
  }
  assert.deepEqual(metrics.byTeam, original);
});

test("result drill-down includes all histories and distinguishes them from sync-rule hits", () => {
  const { rows } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const filters = { team: CUSTOM_TEAM, scope: "all" };
  assert.equal(selectHistoricalTasks(rows, DEFAULT_SERVICE_POLICY).length, 957);
  assert.equal(
    selectHistoricalTasks(rows, DEFAULT_SERVICE_POLICY, { scope: "hits" })
      .length,
    272,
  );
  const expected = { success: [192, 55], failure: [25, 13], unknown: [16, 1] };
  for (const [outcome, [all, hits]] of Object.entries(expected)) {
    const history = selectHistoricalTasks(rows, DEFAULT_SERVICE_POLICY, {
      ...filters,
      outcome,
    });
    assert.equal(history.length, all);
    assert.ok(
      history.every(
        (row) => row.outcome === outcome && row.team_id === CUSTOM_TEAM,
      ),
    );
    assert.equal(
      selectHistoricalTasks(rows, DEFAULT_SERVICE_POLICY, {
        ...filters,
        outcome,
        scope: "hits",
      }).length,
      hits,
    );
  }
  const missed = selectHistoricalTasks(rows, DEFAULT_SERVICE_POLICY, {
    ...filters,
    outcome: "failure",
  }).filter((row) => !row.intercept);
  assert.equal(missed.length, 12);
  assert.equal(
    selectHistoricalTasks(rows, DEFAULT_SERVICE_POLICY, {
      ...filters,
      query: "不存在的场景",
    }).length,
    0,
  );
});

test("outcome quadrants reconcile with task drill-downs and keep unknown outcomes separate", () => {
  const { rows, metrics } = loadRender(
    fileURLToPath(new URL("..", import.meta.url)),
  );
  assert.deepEqual(ruleOutcomeBreakdown(metrics.byTeam), {
    successUnflagged: 626,
    failureUnflagged: 22,
    failureFlagged: 112,
    successFlagged: 146,
    unknownFlagged: 14,
    unknownUnflagged: 37,
  });
  const mapping = [
    ["successUnflagged", "success", "misses"],
    ["failureUnflagged", "failure", "misses"],
    ["failureFlagged", "failure", "hits"],
    ["successFlagged", "success", "hits"],
    ["unknownFlagged", "unknown", "hits"],
    ["unknownUnflagged", "unknown", "misses"],
  ];
  for (const team of ["", ...TEAMS]) {
    const groups = team
      ? metrics.byTeam.filter((group) => group.name === team)
      : metrics.byTeam;
    const counts = ruleOutcomeBreakdown(groups);
    for (const [key, outcome, scope] of mapping) {
      assert.equal(
        counts[key],
        selectHistoricalTasks(rows, DEFAULT_SERVICE_POLICY, {
          team,
          outcome,
          scope,
        }).length,
      );
    }
    assert.equal(
      Object.values(counts).reduce((a, b) => a + b, 0),
      groups.reduce((sum, group) => sum + group.jobs, 0),
    );
  }
});

test("cost ledger includes successful and unknown checks once and reconciles baseline versus intervention", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const { teams, totals } = reviewCostAccounting(
    metrics.byTeam,
    50,
    metrics.costs,
  );
  assert.equal(totals.successfulCheckHours, 2920);
  assert.equal(totals.failedCheckHours, 2240);
  assert.equal(totals.unknownCheckHours, 280);
  assert.equal(
    totals.successfulCheckHours +
      totals.failedCheckHours +
      totals.unknownCheckHours,
    totals.checkHours,
  );
  assert.equal(totals.baselineFailureHours, 16080);
  assert.equal(totals.remainingFailureHours, 9360);
  assert.equal(totals.totalScenarioHours, 14800);
  assert.equal(
    totals.baselineFailureHours - totals.totalScenarioHours,
    totals.netHours,
  );
  assert.equal(totals.netHours, 1280);
  const ka = teams.find((group) => group.name === KA_TEAM);
  const custom = teams.find((group) => group.name === CUSTOM_TEAM);
  assert.equal(ka.policy.falseInterceptions, 25);
  assert.equal(custom.policy.falseInterceptions, 55);
  assert.equal(ka.successfulCheckHours, 500);
  assert.equal(custom.successfulCheckHours, 1100);
  assert.equal(ka.netHours, 740);
  assert.equal(ka.assessment, "lower");
  assert.equal(custom.netHours, -600);
  assert.equal(custom.assessment, "higher");
  for (const group of teams) {
    assert.equal(
      group.baselineFailureHours - group.totalScenarioHours,
      group.netHours,
    );
    assert.equal(
      group.breakEvenEffectiveness,
      group.checkHours / (group.policy.caughtFailures * metrics.costs.crash),
    );
  }
});

test("cost ledger identifies extra load and break-even without treating absent failures as certain benefit", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const base = reviewCostAccounting(metrics.byTeam, 50, metrics.costs);
  const atBreakEven = reviewCostAccounting(
    metrics.byTeam,
    base.totals.breakEvenEffectiveness * 100,
    metrics.costs,
  );
  assert.equal(atBreakEven.totals.assessment, "equal");
  assert.equal(
    reviewCostAccounting(metrics.byTeam, 0, metrics.costs).totals.assessment,
    "higher",
  );
  assert.equal(
    reviewCostAccounting(metrics.byTeam, 100, metrics.costs).totals.assessment,
    "lower",
  );
  const custom = metrics.byTeam.filter((group) => group.name === CUSTOM_TEAM);
  assert.equal(
    reviewCostAccounting(custom, 90, metrics.costs).totals.netHours,
    24,
  );
  const noFailures = [
    {
      name: KA_TEAM,
      jobs: 2,
      failed: 0,
      succeeded: 1,
      unknown: 1,
      policy: {
        intercepted: 2,
        caughtFailures: 0,
        falseInterceptions: 1,
        interceptedUnknown: 1,
      },
    },
  ];
  const result = reviewCostAccounting(noFailures, 100, metrics.costs).totals;
  assert.equal(result.netHours, -40);
  assert.equal(result.breakEvenEffectiveness, null);
  assert.equal(result.assessment, "higher");
  assert.equal(
    reviewCostAccounting([], 50, metrics.costs).totals.assessment,
    "equal",
  );
});

test("one-round accounting credits a correctly intercepted failure by 100 and charges missed crashes by 120", () => {
  // These single-task fixtures test the agreed accounting, not business evidence.
  const single = (failed, succeeded, unknown, intercepted) => ({
    name: KA_TEAM,
    jobs: 1,
    failed,
    succeeded,
    unknown,
    policy: {
      intercepted,
      caughtFailures: failed * intercepted,
      falseInterceptions: succeeded * intercepted,
      interceptedUnknown: unknown * intercepted,
    },
  });
  const cases = [
    {
      group: single(1, 0, 0, 1),
      baseline: 120,
      after: 20,
      net: 100,
      correct: 100,
      missed: 0,
    },
    {
      group: single(1, 0, 0, 0),
      baseline: 120,
      after: 120,
      net: 0,
      correct: 0,
      missed: 120,
    },
    {
      group: single(0, 1, 0, 1),
      baseline: 0,
      after: 20,
      net: -20,
      correct: 0,
      missed: 0,
    },
    {
      group: single(0, 0, 1, 1),
      baseline: 0,
      after: 20,
      net: -20,
      correct: 0,
      missed: 0,
    },
    {
      group: single(0, 1, 0, 0),
      baseline: 0,
      after: 0,
      net: 0,
      correct: 0,
      missed: 0,
    },
  ];
  for (const expected of cases) {
    const { totals } = interceptionCostAccounting([expected.group], {
      crash: 120,
      intercept: 20,
    });
    assert.equal(totals.correctInterceptionUnitNet, 100);
    assert.equal(totals.correctInterceptionNetHours, expected.correct);
    assert.equal(totals.missedFailureHours, expected.missed);
    assert.equal(totals.baselineFailureHours, expected.baseline);
    assert.equal(totals.totalScenarioHours, expected.after);
    assert.equal(totals.netHours, expected.net);
    assert.equal(
      totals.baselineFailureHours - totals.totalScenarioHours,
      totals.netHours,
    );
  }
});

test("one-round net saving matches independent per-task costs and team totals without deducting checks or missed failures twice", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const records = parse(
    readFileSync(new URL("../data/render_jobs.csv", import.meta.url)),
    { columns: true },
  );
  const rows = [...new Map(records.map((row) => [row.job_id, row])).values()];
  let baseline = 0;
  let after = 0;
  for (const row of rows) {
    const hit =
      Date.parse(row.created_at) - Date.parse(row.asset_synced_at) >=
      20 * 60_000;
    if (row.is_success === "0") baseline += 120;
    if (hit) after += 20;
    else if (row.is_success === "0") after += 120;
  }
  const { totals, teams } = interceptionCostAccounting(
    metrics.byTeam,
    metrics.costs,
  );
  assert.equal(totals.correctInterceptionNetHours, 11200);
  assert.equal(totals.otherInterceptionHours, 3200);
  assert.equal(totals.missedFailures, 22);
  assert.equal(totals.missedFailureHours, 2640);
  assert.equal(totals.checkHours, 5440);
  assert.equal(totals.baselineFailureHours, baseline);
  assert.equal(totals.totalScenarioHours, after);
  assert.equal(after, 8080);
  assert.equal(totals.netHours, 8000);
  assert.equal(baseline - after, totals.netHours);
  assert.equal(
    totals.correctInterceptionNetHours - totals.otherInterceptionHours,
    totals.netHours,
  );
  assert.equal(
    teams.reduce((sum, row) => sum + row.netHours, 0),
    8000,
  );
  assert.equal(teams.find((row) => row.name === KA_TEAM).netHours, 2720);
  assert.equal(teams.find((row) => row.name === CUSTOM_TEAM).netHours, 180);
  const extra = completeStrategyAccounting(
    totals,
    { additionalChecks: 1, otherHours: 0, additionalAvoidedFailures: 0 },
    metrics.costs,
  );
  assert.equal(extra.netHours, 7980);
});

test("complete strategy leaves unknown extra costs and benefits uncomputed instead of treating them as free", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const base = reviewCostAccounting(metrics.byTeam, 50, metrics.costs).totals;
  const result = completeStrategyAccounting(
    base,
    {
      additionalChecks: null,
      otherHours: null,
      additionalAvoidedFailures: null,
    },
    metrics.costs,
  );
  assert.equal(result.status, "incomplete");
  assert.equal(result.missing.length, 3);
  assert.equal(result.totalCostHours, null);
  assert.equal(result.totalAvoidedHours, null);
  assert.equal(result.netHours, null);
  const partial = completeStrategyAccounting(
    base,
    {
      additionalChecks: 10,
      otherHours: null,
      additionalAvoidedFailures: 0,
    },
    metrics.costs,
  );
  assert.equal(partial.additionalCheckHours, 200);
  assert.equal(partial.totalCostHours, null);
  assert.equal(partial.totalAvoidedHours, 6720);
  assert.equal(partial.netHours, null);
});

test("complete strategy charges every additional intervention and all non-overlapping labor against benefit", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const base = reviewCostAccounting(metrics.byTeam, 50, metrics.costs).totals;
  const zero = {
    additionalChecks: 0,
    otherHours: 0,
    additionalAvoidedFailures: 0,
  };
  assert.equal(
    completeStrategyAccounting(base, zero, metrics.costs).netHours,
    1280,
  );
  const checks = completeStrategyAccounting(
    base,
    { ...zero, additionalChecks: 100 },
    metrics.costs,
  );
  assert.equal(checks.totalCostHours, 7440);
  assert.equal(checks.netHours, -720);
  assert.equal(checks.remainingFailureHours, 9360);
  assert.equal(checks.totalBurdenHours, 16800);
  assert.equal(
    base.baselineFailureHours - checks.totalBurdenHours,
    checks.netHours,
  );
  const labor = completeStrategyAccounting(
    base,
    { ...zero, additionalChecks: 100, otherHours: 40 },
    metrics.costs,
  );
  assert.equal(labor.totalCostHours, 7480);
  assert.equal(labor.netHours, -760);
  const benefit = completeStrategyAccounting(
    base,
    { additionalChecks: 100, otherHours: 40, additionalAvoidedFailures: 5 },
    metrics.costs,
  );
  assert.equal(benefit.totalAvoidedHours, 7320);
  assert.equal(benefit.netHours, -160);
  assert.equal(benefit.totalBurdenHours, 16240);
  assert.equal(
    base.baselineFailureHours - benefit.totalBurdenHours,
    benefit.netHours,
  );
  assert.equal(
    benefit.totalAvoidedHours - benefit.totalCostHours,
    benefit.netHours,
  );
});

test("additional check inputs count actual interventions, including repeats on the same job, without a job-count cap", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const base = reviewCostAccounting(metrics.byTeam, 50, metrics.costs).totals;
  const calc = (count) =>
    completeStrategyAccounting(
      base,
      { additionalChecks: count, otherHours: 0, additionalAvoidedFailures: 0 },
      metrics.costs,
    );
  assert.equal(calc(1).netHours, 1260);
  assert.equal(calc(2).netHours, 1240);
  assert.equal(calc(1000).totalCostHours, 25440);
});

test("complete strategy rejects invalid costs and repeated benefit beyond remaining historical failures", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const base = reviewCostAccounting(metrics.byTeam, 50, metrics.costs).totals;
  const zero = {
    additionalChecks: 0,
    otherHours: 0,
    additionalAvoidedFailures: 0,
  };
  for (const patch of [
    { additionalChecks: -1 },
    { additionalChecks: 1.5 },
    { otherHours: -1 },
    { otherHours: NaN },
    { additionalAvoidedFailures: 79 },
  ]) {
    const result = completeStrategyAccounting(
      base,
      { ...zero, ...patch },
      metrics.costs,
    );
    assert.equal(result.status, "invalid");
    assert.equal(result.netHours, null);
    assert.ok(result.errors.length);
  }
  const atLimit = completeStrategyAccounting(
    base,
    { ...zero, additionalChecks: 78, additionalAvoidedFailures: 78 },
    metrics.costs,
  );
  assert.equal(atLimit.totalAvoidedHours, 16080);
  assert.equal(atLimit.status, "scenario");
  const changedBase = reviewCostAccounting(
    metrics.byTeam,
    100,
    metrics.costs,
  ).totals;
  assert.equal(
    completeStrategyAccounting(
      changedBase,
      { ...zero, additionalAvoidedFailures: 23 },
      metrics.costs,
    ).status,
    "invalid",
  );
  assert.throws(
    () => completeStrategyAccounting(base, zero, { crash: 120, intercept: -1 }),
    RangeError,
  );
});
