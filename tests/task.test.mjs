import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTask, loadTask, sha256 } from "../server/task.mjs";
import { createApp } from "../server/app.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exampleConfig = "examples/task.config.json";
const example = () => loadTask({ root, configPath: exampleConfig });
const clone = (value) => structuredClone(value);

test("portable example reproduces inventory totals and every matching source record", () => {
  const task = example();
  assert.equal(task.report.source.kind, "synthetic");
  assert.equal(task.report.source.rows, 8);
  assert.equal(task.report.summary.total, 52);
  assert.equal(task.report.summary.average, 6.5);
  assert.deepEqual(
    task.report.summary.groups.map((g) => [g.name, g.value]),
    [
      ["华东", 40],
      ["华南", 10],
      ["华北", 2],
    ],
  );
  assert.equal(task.report.diagnostics.matched, 3);
  assert.equal(task.report.diagnostics.evaluated, 8);
  assert.equal(task.report.diagnostics.rate, 3 / 8);
  assert.deepEqual(
    new Set(task.report.diagnostics.rowIds),
    new Set(["2", "4", "7"]),
  );
  assert.deepEqual(
    task.report,
    JSON.parse(readFileSync(join(root, "examples/task-metrics.json"))),
  );
  assert.deepEqual(task.report, example().report);
});

test("portable filters preserve percentage units, date boundaries and missing-value denominator", () => {
  const bytes = Buffer.from(
    "日期,团队,转化率\n20261001,A,12.5%\n20261002,A,25%\n20261002,A,\n20261003,A,100%\n20261002,B,50%",
  );
  const task = buildTask(
    {
      schemaVersion: 1,
      data: { path: "data.csv", sha256: sha256(bytes), kind: "synthetic" },
      mapping: { metric: "转化率", group: "团队", date: "日期" },
      filters: {
        q: "A",
        filter: "团队",
        value: "A",
        from: "2026-10-01",
        to: "2026-10-02",
      },
      rule: { ruleField: "转化率", op: "gte", threshold: "12.5" },
    },
    bytes,
    root,
  );
  assert.equal(task.report.summary.count, 3);
  assert.equal(task.report.summary.validValues, 2);
  assert.equal(task.report.summary.excludedValues, 1);
  assert.equal(task.report.summary.total, null);
  assert.equal(task.report.summary.average, 0.1875);
  assert.equal(task.report.diagnostics.matched, 2);
  assert.equal(task.report.diagnostics.evaluated, 2);
  assert.deepEqual(task.report.diagnostics.rowIds, ["2", "1"]);
  assert.deepEqual(
    task.report.summary.trend.map((g) => g.name),
    ["2026-10-01", "2026-10-02"],
  );
});

test("task configuration rejects wrong fields, missing thresholds and silently ignored filters", () => {
  const task = example();
  const bytes = readFileSync(join(root, task.config.data.path));
  for (const mutate of [
    (c) => {
      c.mapping.metric = "不存在";
    },
    (c) => {
      c.filters.from = "2026-10-01";
    },
    (c) => {
      c.filters.value = "华东";
    },
    (c) => {
      c.rule.threshold = "";
    },
    (c) => {
      c.rule.op = "unknown";
    },
    (c) => {
      c.mapping.mertic = "库存";
    },
    (c) => {
      c.data.kind = "unknown";
    },
    (c) => {
      c.data.path = "../data.csv";
    },
  ]) {
    const config = clone(task.config);
    mutate(config);
    assert.throws(() => buildTask(config, bytes, root));
  }
});

test("only an absent optional config permits demo mode; missing or changed source fails closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "fieldwork-task-"));
  try {
    assert.equal(loadTask({ root: directory, optional: true }), null);
    assert.throws(() => loadTask({ root: directory }), /缺少 task.config.json/);
    writeFileSync(join(directory, "task.config.json"), "null");
    assert.throws(
      () => loadTask({ root: directory, optional: true }),
      /JSON 对象/,
    );
    const config = clone(example().config);
    config.data.path = "data.csv";
    writeFileSync(join(directory, "task.config.json"), JSON.stringify(config));
    assert.throws(
      () => loadTask({ root: directory, optional: true }),
      /不会退回演示数据/,
    );
    writeFileSync(join(directory, "data.csv"), "a,b\n1,2");
    assert.throws(
      () => loadTask({ root: directory, optional: true }),
      /SHA-256 与配置不一致/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("configured fresh server loads the same dataset, defaults and results without SQLite/browser history", async () => {
  const task = example();
  const directory = mkdtempSync(join(tmpdir(), "fieldwork-task-api-"));
  let app, server;
  try {
    app = createApp({ directory, task });
    server = await new Promise((done) => {
      const s = app.listen(0, "127.0.0.1", () => done(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async (path) => {
      const r = await fetch(base + path);
      assert.equal(r.status, 200);
      return r.json();
    };
    assert.deepEqual(await get("/api/workspace"), { task: task.workspace });
    const datasets = await get("/api/datasets");
    assert.equal(datasets.length, 1);
    assert.equal(datasets[0].id, task.dataset.id);
    assert.equal(datasets[0].demo, true);
    const query = new URLSearchParams({
      ...task.config.mapping,
      ...task.config.filters,
    });
    assert.deepEqual(
      await get(`/api/datasets/${task.dataset.id}/summary?${query}`),
      task.report.summary,
    );
    const diagnosticQuery = new URLSearchParams({
      ...task.config.mapping,
      ...task.config.filters,
      ...task.config.rule,
    });
    const { rows, ...diagnostics } = await get(
      `/api/datasets/${task.dataset.id}/diagnostics?${diagnosticQuery}`,
    );
    assert.deepEqual(
      { ...diagnostics, rowIds: rows.map((r) => r.id) },
      task.report.diagnostics,
    );
    app.locals.store.setNote(task.dataset.id, "2", {
      status: "跟进中",
      note: "重启保留",
    });
    await new Promise((done) => server.close(done));
    server = null;
    app.locals.store.close();
    app = null;
    app = createApp({ directory, task: example() });
    assert.equal(app.locals.store.notes(task.dataset.id)["2"].note, "重启保留");
  } finally {
    if (server) await new Promise((done) => server.close(done));
    app?.locals.store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI copies external CSV verbatim, replays configuration and detects changed evidence without overwriting", () => {
  const artifacts = join(root, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const directory = mkdtempSync(join(artifacts, "task-cli-"));
  const project = join(directory, "project");
  const source = join(directory, "人工数据.csv");
  const cli = (mode, ...args) =>
    execFileSync(
      process.execPath,
      [join(project, "scripts/task.mjs"), mode, ...args],
      {
        cwd: directory,
        env: { ...process.env, TASK_CONFIG: "" },
        encoding: "utf8",
      },
    );
  const fail = (mode, ...args) =>
    spawnSync(
      process.execPath,
      [join(project, "scripts/task.mjs"), mode, ...args],
      {
        cwd: directory,
        env: { ...process.env, TASK_CONFIG: "" },
        encoding: "utf8",
      },
    );
  try {
    for (const folder of ["scripts", "server"])
      mkdirSync(join(project, folder), { recursive: true });
    for (const path of [
      "scripts/task.mjs",
      "server/task.mjs",
      "server/data.mjs",
    ])
      copyFileSync(join(root, path), join(project, path));
    const bytes = Buffer.from("\uFEFF编号,数量\r\n001,2\r\n002,0\r\n003,\r\n");
    writeFileSync(source, bytes);
    assert.equal(
      fail("prepare", "--file", source, "--metric", "错列").status,
      1,
    );
    assert.equal(existsSync(join(project, "task.config.json")), false);
    assert.equal(existsSync(join(project, "private-inputs")), false);
    cli("prepare", "--file", source, "--kind", "synthetic", "--metric", "数量");
    const configFile = join(project, "task.config.json");
    const config = JSON.parse(readFileSync(configFile));
    assert.deepEqual(readFileSync(join(project, config.data.path)), bytes);
    const reportFile = join(project, "results/task-metrics.json");
    const report = readFileSync(reportFile, "utf8");
    cli("reproduce", "--check");
    cli("reproduce");
    assert.equal(readFileSync(reportFile, "utf8"), report);
    const changed = JSON.parse(report);
    changed.summary.total = 999;
    const tampered = JSON.stringify(changed);
    writeFileSync(reportFile, tampered);
    const check = fail("reproduce", "--check");
    assert.equal(check.status, 1);
    assert.match(check.stderr, /报告未被覆盖/);
    assert.equal(readFileSync(reportFile, "utf8"), tampered);
    const sourceBefore = readFileSync(join(project, config.data.path));
    assert.equal(fail("reproduce", "--output", config.data.path).status, 1);
    assert.equal(
      fail(
        "prepare",
        "--file",
        join(project, config.data.path),
        "--config",
        config.data.path,
      ).status,
      1,
    );
    assert.deepEqual(
      readFileSync(join(project, config.data.path)),
      sourceBefore,
    );
    writeFileSync(join(project, config.data.path), "编号,数量\n001,999");
    const drift = fail("reproduce");
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /SHA-256 与配置不一致/);
    assert.equal(readFileSync(reportFile, "utf8"), tampered);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
