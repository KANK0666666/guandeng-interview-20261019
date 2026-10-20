import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { loadRender } from "../server/render.mjs";
import {
  calculateMemoryCandidate,
  calculateSyncStrategy,
  normalizeThresholds,
  REVIEW_THRESHOLDS,
  STANDARD_THRESHOLDS,
} from "../src/threshold-strategy.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const report = loadRender(root);
const costs = { crash: 120, intercept: 20 };
const raw = parse(
  readFileSync(new URL("../data/render_jobs.csv", import.meta.url)),
  {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  },
);
// Independent raw-CSV reference: deduplicate full records and compute timestamps
// directly, without using the production lag or outcome classification.
const source = [
  ...new Map(raw.map((row) => [JSON.stringify(row), row])).values(),
];
const expected = (rows, matches) => {
  let checks = 0,
    caught = 0,
    success = 0,
    unknown = 0,
    missed = 0,
    before = 0,
    after = 0;
  for (const row of rows) {
    const fails = String(row.is_success) === "0";
    if (fails) before += 120;
    if (matches(row)) {
      checks += 1;
      after += 20;
      if (fails) caught += 1;
      else if (String(row.is_success) === "1") success += 1;
      else unknown += 1;
    } else if (fails) {
      missed += 1;
      after += 120;
    }
  }
  return {
    checks,
    caught,
    success,
    unknown,
    missed,
    before,
    after,
    net: before - after,
  };
};
function assertAccount(actual, reference, policy = actual) {
  assert.deepEqual(
    [
      policy.intercepted,
      policy.caughtFailures,
      policy.falseInterceptions,
      policy.interceptedUnknown,
      actual.missedFailures,
      actual.baselineFailureHours,
      actual.totalScenarioHours,
      actual.netHours,
    ],
    [
      reference.checks,
      reference.caught,
      reference.success,
      reference.unknown,
      reference.missed,
      reference.before,
      reference.after,
      reference.net,
    ],
  );
  assert.equal(actual.checkHours, reference.checks * 20);
}
test("default review strategy includes all 21 unknown checks and reconciles 6400 hours", () => {
  const replay = calculateSyncStrategy(report.rows, REVIEW_THRESHOLDS, costs);
  const reference = expected(
    source,
    (row) =>
      (Date.parse(row.created_at) - Date.parse(row.asset_synced_at)) / 60000 >=
      REVIEW_THRESHOLDS[row.team_id],
  );
  assertAccount(replay.totals, reference);
  assert.deepEqual(
    [
      replay.totals.intercepted,
      replay.totals.caughtFailures,
      replay.totals.falseInterceptions,
      replay.totals.interceptedUnknown,
      replay.totals.missedFailures,
      replay.totals.netHours,
    ],
    [370, 115, 234, 21, 19, 6400],
  );
  const baseline = calculateSyncStrategy(
    report.rows,
    STANDARD_THRESHOLDS,
    costs,
  ).totals;
  assert.equal(baseline.netHours, 8000);
  assert.deepEqual(
    [
      replay.totals.intercepted - baseline.intercepted,
      replay.totals.caughtFailures - baseline.caughtFailures,
      replay.totals.netHours - baseline.netHours,
    ],
    [98, 3, -1600],
  );
});
test("every team and slider position matches independent CSV accounting without changing source flags", () => {
  const before = structuredClone(report.rows);
  for (let threshold = 0; threshold <= 70; threshold++) {
    const settings = Object.fromEntries(
      Object.keys(STANDARD_THRESHOLDS).map((name) => [name, threshold]),
    );
    const replay = calculateSyncStrategy(report.rows, settings, costs);
    for (const row of replay.teams) {
      const reference = expected(
        source.filter((item) => item.team_id === row.name),
        (item) =>
          (Date.parse(item.created_at) - Date.parse(item.asset_synced_at)) /
            60000 >=
          threshold,
      );
      assertAccount(row, reference, row.policy);
    }
    assert.equal(
      replay.totals.netHours,
      replay.teams.reduce((sum, row) => sum + row.netHours, 0),
    );
  }
  assert.deepEqual(report.rows, before);
  const all = calculateSyncStrategy(
    report.rows,
    normalizeThresholds(
      Object.fromEntries(
        Object.keys(STANDARD_THRESHOLDS).map((name) => [name, 0]),
      ),
    ),
    costs,
  ).totals;
  assert.equal(all.intercepted, 957);
  assert.equal(all.netHours, -3060);
});
test("memory exploration counts unknown checks and never changes the sync strategy", () => {
  const initial = calculateSyncStrategy(report.rows, REVIEW_THRESHOLDS, costs);
  for (let threshold = 0; threshold <= 30; threshold++) {
    const result = calculateMemoryCandidate(report.rows, threshold, costs);
    assertAccount(
      result,
      expected(
        source.filter((row) => row.team_id === "海外定制组"),
        (row) => Number(row.gpu_mem_free_mb) <= threshold,
      ),
      result.policy,
    );
  }
  const result = calculateMemoryCandidate(report.rows, 10, costs);
  assert.equal(result.policy.interceptedUnknown, 2);
  assert.equal(result.policy.intercepted, 87);
  assert.equal(result.netHours, 900);
  assert.deepEqual(
    calculateSyncStrategy(report.rows, REVIEW_THRESHOLDS, costs),
    initial,
  );
  assert.throws(
    () => calculateMemoryCandidate(report.rows, -1, costs),
    RangeError,
  );
});
test("thresholds recover from invalid storage and preserve an intentional zero", () => {
  for (const value of [null, undefined, "bad", [], {}])
    assert.deepEqual(normalizeThresholds(value), REVIEW_THRESHOLDS);
  assert.deepEqual(
    normalizeThresholds({
      KA大客户组: 0,
      国内电商组: 900,
      生态服务商组: -9,
      海外定制组: NaN,
    }),
    { KA大客户组: 0, 国内电商组: 70, 生态服务商组: 0, 海外定制组: 20 },
  );
  assert.equal(normalizeThresholds({ 海外定制组: 9.7 })["海外定制组"], 10);
});
