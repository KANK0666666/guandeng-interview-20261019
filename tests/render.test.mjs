import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import {
  analyzeRender,
  cleanRender,
  loadRender,
  policyMetrics,
  preflight,
  renderCsv,
} from "../server/render.mjs";
import { createApp } from "../server/app.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(resolve(root, "render.config.json")));
const fixture = (records) =>
  Buffer.from(
    "job_id,created_at,asset_synced_at,team_id,scene_type,gpu_mem_free_mb,polygon_count,is_success\n" +
      records.join("\n"),
  );
const sample =
  "x,2026-09-01T08:00:00+08:00,2026-08-31T23:40:00Z,测试团队,人工测试,0,10,";

test("timezone equivalence and exact 20-minute boundary; result label cannot leak into decision", () => {
  const base = {
    created_at: "2026-09-01T08:00:00+08:00",
    asset_synced_at: "2026-08-31T23:40:00Z",
  };
  assert.equal(preflight(base).lagMinutes, 20);
  assert.equal(preflight(base).decision, "intercept");
  assert.equal(
    preflight({ ...base, asset_synced_at: "2026-08-31T23:40:01Z" }).decision,
    "pass",
  );
  assert.equal(
    preflight({ ...base, created_at: "2026-09-01T00:00:00Z" }).lagMinutes,
    20,
  );
  assert.deepEqual(
    preflight({ ...base, is_success: "0" }),
    preflight({ ...base, is_success: "1" }),
  );
  assert.equal(
    preflight({ ...base, asset_synced_at: "2026-09-01T00:01:00Z" }).decision,
    "review",
  );
  assert.equal(
    preflight({ ...base, created_at: "2026-09-01T08:00:00" }).decision,
    "review",
  );
  assert.equal(preflight({}).decision, "review");
  assert.equal(
    preflight({ ...base, created_at: "2026-02-31T08:00:00+08:00" }).decision,
    "review",
  );
});

test("exact duplicates collapse, zero is valid, unknown stays unknown; conflicting duplicates fail", () => {
  const cleaned = cleanRender(fixture([sample, sample]));
  assert.equal(cleaned.rows.length, 1);
  assert.equal(cleaned.duplicatesRemoved, 1);
  assert.deepEqual(cleaned.rows[0].sourceRows, [1, 2]);
  assert.equal(cleaned.rows[0].memoryMb, 0);
  assert.equal(cleaned.rows[0].outcome, "unknown");
  assert.throws(() => cleanRender(fixture([sample, sample + "1"])), /冲突/);
});

test("all interceptions incur cost including successes and unknown outcomes; zero effectiveness loses cost", () => {
  const rows = [
    { outcome: "failure" },
    { outcome: "success" },
    { outcome: "unknown" },
  ];
  const m = policyMetrics(rows, () => true, {
    crashHours: 120,
    interceptHours: 20,
  });
  assert.equal(m.netHoursAtFullEffect, 60);
  assert.equal(m.netHoursAtHalfEffect, 0);
  assert.equal(m.sensitivity[0].netHours, -60);
  assert.equal(m.knownPrecision, 0.5);
  assert.equal(m.interceptedUnknown, 1);
  assert.equal(m.breakEvenEffectiveness, 0.5);
  const none = policyMetrics([], () => true, {
    crashHours: 120,
    interceptHours: 20,
  });
  assert.equal(none.failureRate, null);
  assert.equal(none.recall, null);
  assert.equal(none.breakEvenEffectiveness, null);
});

test("provided-data evidence reconciles; selection uses development period, exports contain all hits", () => {
  const { metrics: m, rows } = loadRender(root);
  assert.equal(m.source.rawRows, 1005);
  assert.equal(m.source.uniqueJobs, 957);
  assert.equal(m.source.duplicatesRemoved, 48);
  assert.equal(m.outcomes.known, 906);
  assert.equal(m.outcomes.failed, 134);
  assert.equal(m.outcomes.unknown, 51);
  assert.equal(m.candidates.length, 35);
  assert.equal(m.candidates[0].id, "lag-20");
  assert.equal(m.train.jobs, 688);
  assert.equal(m.validation.jobs, 269);
  assert.equal(m.all.intercepted, 272);
  assert.equal(m.all.caughtFailures, 112);
  assert.equal(m.all.falseInterceptions, 146);
  assert.equal(m.all.interceptedUnknown, 14);
  assert.equal(m.all.netHoursAtFullEffect, 8000);
  assert.equal(m.all.netHoursAtHalfEffect, 1280);
  assert.equal(m.validation.netHoursAtHalfEffect, 340);
  const exported = parse(renderCsv(rows.filter((r) => r.intercept)), {
    columns: true,
    bom: true,
  });
  assert.equal(exported.length, 272);
  assert.equal(new Set(exported.map((r) => r.job_id)).size, 272);
  assert.equal(rows.filter((r) => r.partition === "train").length, 688);
  assert.deepEqual(
    m,
    JSON.parse(readFileSync(resolve(root, "results/render-metrics.json"))),
  );
  assert.throws(() => analyzeRender(Buffer.from("changed source"), config));
});

test("render HTTP report, preview and complete CSV export use the same policy", async () => {
  const render = loadRender(root),
    app = createApp({ directory: ":memory:", render });
  const server = await new Promise((done) => {
    const s = app.listen(0, "127.0.0.1", () => done(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const data = await (await fetch(base + "/api/render/report")).json();
    assert.equal(data.metrics.all.netHoursAtHalfEffect, 1280);
    const preview = await (
      await fetch(base + "/api/render/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          created_at: "2026-09-01T08:00:00+08:00",
          asset_synced_at: "2026-08-31T23:40:00Z",
          is_success: 1,
        }),
      })
    ).json();
    assert.equal(preview.decision, "intercept");
    const csv = await (await fetch(base + "/api/render/queue.csv")).text();
    assert.equal(parse(csv, { columns: true, bom: true }).length, 272);
  } finally {
    await new Promise((done) => server.close(done));
    app.locals.store.close();
  }
});

test("continuous effectiveness review finds the 30/25/20-minute switches and exact boundary ties", () => {
  const { metrics: m } = loadRender(root);
  const envelope = m.ruleSensitivity;
  assert.equal(envelope.candidateCount, 35);
  assert.deepEqual(
    envelope.segments.map((s) => s.preferredRuleId),
    ["none", "lag-30", "lag-25", "lag-20"],
  );
  assert.deepEqual(
    envelope.boundaries.map((b) => [
      b.effectiveness.numerator,
      b.effectiveness.denominator,
    ]),
    [
      [0, 1],
      [2, 5],
      [5, 12],
      [4, 9],
      [1, 1],
    ],
  );
  assert.deepEqual(
    envelope.boundaries.map((b) => b.preferredRuleId),
    ["none", "none", "lag-30", "lag-25", "lag-20"],
  );
  assert.deepEqual(envelope.boundaries[3].ruleIds, ["lag-20", "lag-25"]);
  const ranked = (effect) =>
    [...m.candidates].sort(
      (a, b) =>
        (b.train.caughtFailures - a.train.caughtFailures) * 120 * effect -
        (b.train.interceptCost - a.train.interceptCost),
    )[0];
  const at403 = ranked(0.403);
  assert.equal(at403.id, "lag-30");
  assert.ok(
    Math.abs(
      at403.train.caughtFailures * 120 * 0.403 -
        at403.train.interceptCost -
        25.2,
    ) < 1e-9,
  );
  assert.equal(ranked(0.43).id, "lag-25");
  assert.equal(ranked(0.5).id, "lag-20");
});

test("team evidence pays for unknown outcomes and reports association without a causal claim", () => {
  const { metrics: m } = loadRender(root);
  const overseas = m.byTeam.find((team) => team.name === "海外定制组");
  assert.equal(overseas.below.known, 149);
  assert.equal(overseas.below.failed, 12);
  assert.equal(overseas.above.known, 68);
  assert.equal(overseas.above.failed, 13);
  assert.equal(overseas.policy.intercepted, 69);
  assert.equal(overseas.policy.interceptedUnknown, 1);
  assert.equal(overseas.policy.netHoursAtHalfEffect, -600);
  assert.ok(Math.abs(overseas.policy.breakEvenEffectiveness - 23 / 26) < 1e-12);
  const others = m.byTeam.filter((team) => team !== overseas);
  assert.equal(
    others.reduce((sum, team) => sum + team.policy.intercepted, 0),
    203,
  );
  assert.equal(
    others.reduce((sum, team) => sum + team.policy.caughtFailures, 0),
    99,
  );
  assert.equal(
    others.reduce((sum, team) => sum + team.policy.netHoursAtHalfEffect, 0),
    1880,
  );
  assert.deepEqual(
    m.stratification.groups.map((g) => [g.total, g.comparable, g.positive]),
    [
      [4, 4, 4],
      [8, 8, 8],
      [7, 7, 7],
    ],
  );
  assert.equal(
    m.byDay.find((day) => day.name === "2026-09-05").below.failureRate,
    0,
  );
  assert.equal(m.validationComparison.bestCandidateId, "lag-20-or-mem-1");
  assert.equal(m.validationComparison.bestNetHoursAtFullEffect, 2340);
  assert.equal(m.validationComparison.selectedNetHoursAtFullEffect, 2200);
  assert.deepEqual(
    [m.thresholdSupport.nearestBelow, m.thresholdSupport.nearestAtOrAbove],
    [18, 22],
  );
});
