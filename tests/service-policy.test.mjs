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

const configured = {
  noResultMinutes: 10,
  teams: [KA_TEAM, CUSTOM_TEAM],
  enabled: true,
};

test("follow-up is unset and disabled until a decision maker selects scope and time", () => {
  for (const value of [null, undefined, "bad", []])
    assert.deepEqual(normalizeServicePolicy(value), DEFAULT_SERVICE_POLICY);
  for (const noResultMinutes of [6, 9, 10]) {
    const legacy = normalizeServicePolicy({ noResultMinutes, kaWeight: 100 });
    assert.deepEqual(legacy, { noResultMinutes, teams: [], enabled: false });
    assert.equal(serviceDecision(pending, legacy).code, "disabled");
  }
  assert.equal(serviceDecision(pending).code, "disabled");
  assert.equal(
    serviceDecision(pending, { ...configured, enabled: false }).code,
    "disabled",
  );
  assert.equal(
    serviceDecision(pending, { ...configured, teams: [] }).code,
    "disabled",
  );
  assert.equal(
    serviceDecision(pending, { ...configured, noResultMinutes: null }).code,
    "disabled",
  );
});

test("follow-up validation rejects invalid times and filters unsupported teams", () => {
  for (const noResultMinutes of [null, 0, -1, Infinity, NaN, "10", 10.7]) {
    const result = normalizeServicePolicy({ ...configured, noResultMinutes });
    assert.equal(result.noResultMinutes, null);
    assert.equal(result.enabled, false);
  }
  assert.deepEqual(
    normalizeServicePolicy({
      ...configured,
      noResultMinutes: 45,
      teams: [KA_TEAM, KA_TEAM, "invalid"],
      kaWeight: 500,
    }),
    { noResultMinutes: 45, teams: [KA_TEAM], enabled: true },
  );
  assert.equal(
    normalizeServicePolicy({ ...configured, enabled: "true" }).enabled,
    false,
  );
});

test("follow-up begins exactly at the configured deadline for any explicitly selected team", () => {
  for (const team of TEAMS) {
    const settings = { ...configured, teams: [team] };
    assert.equal(
      serviceDecision({ ...pending, team, elapsedMinutes: 9.99 }, settings)
        .code,
      "watch",
    );
    assert.equal(
      serviceDecision({ ...pending, team }, settings).code,
      "follow-up",
    );
    assert.equal(
      serviceDecision({ ...pending, team, elapsedMinutes: 500 }, settings).code,
      "follow-up",
    );
    const later = { ...settings, noResultMinutes: 15 };
    assert.equal(serviceDecision({ ...pending, team }, later).code, "watch");
    assert.equal(
      serviceDecision({ ...pending, team, elapsedMinutes: 15 }, later).code,
      "follow-up",
    );
  }
  assert.equal(
    serviceDecision(pending, { ...configured, teams: [CUSTOM_TEAM] }).code,
    "existing-process",
  );
});

test("waiting time is independent of sync age and historical missing outcomes", () => {
  assert.equal(
    serviceDecision({ ...pending, lagMinutes: 0 }, configured).code,
    "follow-up",
  );
  assert.equal(
    serviceDecision(
      { ...pending, elapsedMinutes: 2, lagMinutes: 70 },
      configured,
    ).code,
    "watch",
  );
  assert.equal(
    serviceDecision({ ...pending, status: "unknown" }, configured).code,
    "check-input",
  );
  assert.equal(
    serviceDecision(
      { ...pending, elapsedMinutes: null, is_success: "" },
      configured,
    ).code,
    "check-input",
  );
});

test("manual simulation handles explicit failure and success separately from waiting thresholds", () => {
  for (const team of TEAMS) {
    for (const elapsedMinutes of [0, null])
      assert.equal(
        serviceDecision(
          { ...pending, team, status: "failure", elapsedMinutes },
          configured,
        ).code,
        "fault",
      );
    assert.equal(
      serviceDecision(
        { ...pending, team, status: "success", elapsedMinutes: 99 },
        configured,
      ).code,
      "completed",
    );
  }
});

test("assigned cases avoid duplicate follow-up; missing simulation inputs never create tasks", () => {
  assert.equal(
    serviceDecision({ ...pending, assigned: true }, configured).code,
    "in-progress",
  );
  assert.equal(
    serviceDecision(
      { ...pending, team: "国内电商组", status: "failure", assigned: true },
      configured,
    ).code,
    "in-progress",
  );
  for (const team of ["国内电商组", "生态服务商组"])
    assert.equal(
      serviceDecision({ ...pending, team, elapsedMinutes: 99 }, configured)
        .code,
      "existing-process",
    );
  for (const elapsedMinutes of [null, undefined, -1, NaN, Infinity, "12"])
    assert.equal(
      serviceDecision({ ...pending, elapsedMinutes }, configured).code,
      "check-input",
    );
  for (const team of ["", "未确认团队"])
    assert.equal(
      serviceDecision({ ...pending, team }, configured).code,
      "check-input",
    );
  assert.equal(
    serviceDecision(
      { team: "", status: "", elapsedMinutes: null, assigned: false },
      configured,
    ).code,
    "check-input",
  );
});

test("historical order follows submission time and task ID, independent of team and outcome", () => {
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
  assert.deepEqual(ids(sortHistoricalQueue(rows)), ["1", "10", "2", "3"]);
  assert.deepEqual(
    ids(
      sortHistoricalQueue(
        rows.map((row) => ({
          ...row,
          team_id: CUSTOM_TEAM,
          outcome: "success",
        })),
      ),
    ),
    ["1", "10", "2", "3"],
  );
  assert.deepEqual(rows, before);
});

test("live scenario separates historical outcomes, expected avoided failures, and full human-check costs", () => {
  const { metrics } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const half = serviceImpact(metrics.byTeam, 50, metrics.costs);
  assert.equal(half.totals.succeeded, 772);
  assert.equal(half.totals.failed, 134);
  assert.equal(half.totals.unknown, 51);
  assert.equal(half.totals.expectedAvoidedFailures, 56);
  assert.equal(half.totals.expectedRemainingFailures, 78);
  assert.equal(half.totals.checkHours, 5440);
  assert.equal(half.totals.avoidedHours, 6720);
  assert.equal(half.totals.netHours, 1280);
  const custom = half.teams.find((group) => group.name === CUSTOM_TEAM);
  assert.equal(custom.expectedAvoidedFailures, 6.5);
  assert.equal(custom.expectedRemainingFailures, 18.5);
  assert.equal(custom.checkHours, 1380); // includes 55 successes and one unknown
  assert.equal(custom.netHours, -600);
  const zero = serviceImpact(metrics.byTeam, 0, metrics.costs);
  assert.equal(zero.totals.expectedRemainingFailures, 134);
  assert.equal(zero.totals.netHours, -5440);
  const full = serviceImpact(metrics.byTeam, 100, metrics.costs);
  assert.equal(full.totals.expectedAvoidedFailures, 112);
  assert.equal(full.totals.expectedRemainingFailures, 22); // never implies all failures fixed
  assert.equal(full.totals.netHours, 8000);
  for (const value of [NaN, Infinity, -1, 101]) {
    assert.throws(
      () => serviceImpact(metrics.byTeam, value, metrics.costs),
      RangeError,
    );
  }
});

test("result drill-down includes all histories and distinguishes them from sync-rule hits", () => {
  const { rows } = loadRender(fileURLToPath(new URL("..", import.meta.url)));
  const filters = { team: CUSTOM_TEAM, scope: "all" };
  assert.equal(selectHistoricalTasks(rows).length, 957);
  assert.equal(selectHistoricalTasks(rows, { scope: "hits" }).length, 272);
  const expected = { success: [192, 55], failure: [25, 13], unknown: [16, 1] };
  for (const [outcome, [all, hits]] of Object.entries(expected)) {
    const history = selectHistoricalTasks(rows, {
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
      selectHistoricalTasks(rows, {
        ...filters,
        outcome,
        scope: "hits",
      }).length,
      hits,
    );
  }
  const missed = selectHistoricalTasks(rows, {
    ...filters,
    outcome: "failure",
  }).filter((row) => !row.intercept);
  assert.equal(missed.length, 12);
  assert.equal(
    selectHistoricalTasks(rows, {
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
        selectHistoricalTasks(rows, {
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
