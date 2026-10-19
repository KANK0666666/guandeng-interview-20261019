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
  sortHistoricalQueue,
  weightedFailureCoverage,
} from "../src/service-policy.mjs";

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
