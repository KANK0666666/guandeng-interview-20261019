import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { csvExport, day } from "./data.mjs";

export const RENDER_HEADERS = [
  "job_id",
  "created_at",
  "asset_synced_at",
  "team_id",
  "scene_type",
  "gpu_mem_free_mb",
  "polygon_count",
  "is_success",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const count = (rows) => {
  const failed = rows.filter((r) => r.outcome === "failure").length;
  const succeeded = rows.filter((r) => r.outcome === "success").length;
  return {
    jobs: rows.length,
    failed,
    succeeded,
    unknown: rows.length - failed - succeeded,
    known: failed + succeeded,
    failureRate: failed + succeeded ? failed / (failed + succeeded) : null,
  };
};

export function preflight(input, threshold = 20) {
  const zoned = (v) =>
    typeof v === "string" &&
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) &&
    day(v) !== null &&
    Number.isFinite(Date.parse(v));
  if (!zoned(input.created_at) || !zoned(input.asset_synced_at))
    return {
      decision: "review",
      lagMinutes: null,
      reason: "时间缺失或无有效时区，请核对后再提交。",
    };
  const lagMinutes =
    (Date.parse(input.created_at) - Date.parse(input.asset_synced_at)) / 60000;
  if (lagMinutes < 0)
    return {
      decision: "review",
      lagMinutes,
      reason: "同步完成时间晚于提交时间，请核对时间或事件采集口径。",
    };
  return lagMinutes >= threshold
    ? {
        decision: "intercept",
        lagMinutes,
        reason: `距资产最后同步已 ${lagMinutes} 分钟，达到 ${threshold} 分钟预检阈值。先核对云端资产版本，必要时重新同步；确认完成后再提交。`,
      }
    : {
        decision: "pass",
        lagMinutes,
        reason: `同步间隔 ${lagMinutes} 分钟，未触发本规则；这不保证渲染成功。`,
      };
}

export function cleanRender(bytes) {
  const records = parse(bytes, {
    bom: true,
    skip_empty_lines: true,
    columns: (headers) => {
      if (JSON.stringify(headers) !== JSON.stringify(RENDER_HEADERS))
        throw new Error("render_jobs.csv 表头与约定不一致。");
      return headers;
    },
  });
  const seen = new Map();
  for (const [i, raw] of records.entries()) {
    if (!raw.job_id.trim()) throw new Error(`第 ${i + 1} 条任务缺少 job_id。`);
    if (!["", "0", "1"].includes(raw.is_success))
      throw new Error(`任务 ${raw.job_id} 的结果值无效。`);
    if (seen.has(raw.job_id)) {
      const old = seen.get(raw.job_id);
      if (JSON.stringify(old.raw) !== JSON.stringify(raw))
        throw new Error(
          `任务 ${raw.job_id} 存在冲突重复记录，不能任意保留一条。`,
        );
      old.sourceRows.push(i + 1);
    } else seen.set(raw.job_id, { raw, sourceRows: [i + 1] });
  }
  const rows = [...seen.values()]
    .map(({ raw, sourceRows }) => {
      const check = preflight(raw);
      if (check.decision === "review")
        throw new Error(`任务 ${raw.job_id}：${check.reason}`);
      for (const key of ["gpu_mem_free_mb", "polygon_count"])
        if (
          !raw[key].trim() ||
          !Number.isFinite(Number(raw[key])) ||
          Number(raw[key]) < 0
        )
          throw new Error(`任务 ${raw.job_id} 的 ${key} 无效。`);
      const createdMs = Date.parse(raw.created_at);
      return {
        ...raw,
        sourceRows,
        createdMs,
        localDay: new Date(createdMs + 8 * 3600000).toISOString().slice(0, 10),
        lagMinutes: check.lagMinutes,
        memoryMb: Number(raw.gpu_mem_free_mb),
        polygons: Number(raw.polygon_count),
        outcome:
          raw.is_success === "0"
            ? "failure"
            : raw.is_success === "1"
              ? "success"
              : "unknown",
      };
    })
    .sort(
      (a, b) => a.createdMs - b.createdMs || a.job_id.localeCompare(b.job_id),
    );
  return {
    rows,
    rawRows: records.length,
    rawUnknown: records.filter((r) => r.is_success === "").length,
    duplicatesRemoved: records.length - rows.length,
    duplicateJobs: rows.filter((r) => r.sourceRows.length > 1).length,
    sha256: hash(bytes),
  };
}

export function policyMetrics(rows, predicate, config) {
  const overall = count(rows),
    hit = rows.filter(predicate),
    tally = count(hit);
  const interceptCost = hit.length * config.interceptHours;
  const avoidedAtFullEffect = tally.failed * config.crashHours;
  return {
    ...overall,
    intercepted: hit.length,
    caughtFailures: tally.failed,
    falseInterceptions: tally.succeeded,
    interceptedUnknown: tally.unknown,
    missedFailures: overall.failed - tally.failed,
    knownPrecision: tally.known ? tally.failed / tally.known : null,
    recall: overall.failed ? tally.failed / overall.failed : null,
    interceptCost,
    baselineKnownCrashHours: overall.failed * config.crashHours,
    netHoursAtFullEffect: avoidedAtFullEffect - interceptCost,
    netHoursAtHalfEffect: avoidedAtFullEffect * 0.5 - interceptCost,
    breakEvenEffectiveness: avoidedAtFullEffect
      ? interceptCost / avoidedAtFullEffect
      : null,
    sensitivity: [0, 0.25, 0.5, 0.75, 1].map((effectiveness) => ({
      effectiveness,
      netHours: avoidedAtFullEffect * effectiveness - interceptCost,
    })),
  };
}

export function candidates() {
  const result = [
    { id: "none", label: "不拦截", test: () => false },
    { id: "all", label: "全部拦截", test: () => true },
  ];
  for (const lag of [10, 15, 20, 25, 30, 40, 60])
    result.push({
      id: `lag-${lag}`,
      label: `同步间隔 ≥ ${lag} 分钟`,
      test: (r) => r.lagMinutes >= lag,
    });
  for (const mem of [0, 1, 2, 3, 5, 8])
    result.push({
      id: `mem-${mem}`,
      label: `显存 ≤ ${mem} MB`,
      test: (r) => r.memoryMb <= mem,
    });
  for (const lag of [15, 20, 25, 30])
    for (const mem of [0, 1, 2, 3, 5])
      result.push({
        id: `lag-${lag}-or-mem-${mem}`,
        label: `同步 ≥ ${lag} 分钟 或 显存 ≤ ${mem} MB`,
        test: (r) => r.lagMinutes >= lag || r.memoryMb <= mem,
      });
  return result;
}

export function analyzeRender(bytes, config) {
  const clean = cleanRender(bytes),
    rows = clean.rows;
  if (config.sha256 !== clean.sha256)
    throw new Error("正式 CSV 的 SHA-256 与配置不一致。");
  const train = rows.filter((r) => r.localDay <= config.trainThrough);
  const validation = rows.filter((r) => r.localDay >= config.validationFrom);
  if (
    train.length + validation.length !== rows.length ||
    !train.length ||
    !validation.length
  )
    throw new Error("时间划分必须完整且不重叠。");
  const options = candidates()
    .map((c) => ({
      id: c.id,
      label: c.label,
      train: policyMetrics(train, c.test, config),
    }))
    .sort(
      (a, b) =>
        b.train.netHoursAtFullEffect - a.train.netHoursAtFullEffect ||
        a.train.intercepted - b.train.intercepted,
    );
  const selected = candidates().find(
    (c) => c.id === `lag-${config.selectedLagMinutes}`,
  );
  if (!selected || options[0].id !== selected.id)
    throw new Error(
      "配置中的规则不再是开发期候选规则的最高收益项，请审查后更新。",
    );
  const slices = (key) =>
    [...new Set(rows.map((r) => r[key]))].sort().map((name) => ({
      name,
      ...count(rows.filter((r) => r[key] === name)),
      policy: policyMetrics(
        rows.filter((r) => r[key] === name),
        selected.test,
        config,
      ),
    }));
  const outcomes = count(rows);
  const metrics = {
    schemaVersion: 1,
    source: {
      path: config.source,
      sha256: clean.sha256,
      rawRows: clean.rawRows,
      rawUnknown: clean.rawUnknown,
      uniqueJobs: rows.length,
      duplicatesRemoved: clean.duplicatesRemoved,
      duplicateJobs: clean.duplicateJobs,
      conflictingJobs: 0,
      invalidTimes: 0,
    },
    units: {
      time: "先按时区转为同一时刻，分钟差；按北京时间自然日划分",
      gpu: "沿用 gpu_mem_free_mb 的 MB，不擅自换成 GB",
      polygons: "沿用原始面数，不假定千面/万面",
      hours: "题目给定的工时计量，非本项目测得",
    },
    featureRanges: Object.fromEntries(
      ["lagMinutes", "memoryMb", "polygons"].map((key) => [
        key,
        {
          min: Math.min(...rows.map((r) => r[key])),
          max: Math.max(...rows.map((r) => r[key])),
        },
      ]),
    ),
    costs: { crash: config.crashHours, intercept: config.interceptHours },
    outcomes: {
      ...outcomes,
      failureRateLower: outcomes.failed / rows.length,
      failureRateUpper: (outcomes.failed + outcomes.unknown) / rows.length,
    },
    selectedRule: {
      id: selected.id,
      label: selected.label,
      lagMinutes: config.selectedLagMinutes,
      usesOutcome: false,
      action:
        "先核对资产版本并同步，完成后重新预检；每个唯一 job_id 最多计一次拦截成本。",
    },
    split: {
      trainThrough: config.trainThrough,
      validationFrom: config.validationFrom,
      caveat:
        "先探索过全量分布，再按前5天选择规则、后2天做时间复核；不是严格未见的盲测。",
    },
    train: policyMetrics(train, selected.test, config),
    validation: policyMetrics(validation, selected.test, config),
    all: policyMetrics(rows, selected.test, config),
    baselines: ["none", "all", "mem-3"].map((id) => {
      const c = candidates().find((c) => c.id === id);
      return {
        id,
        label: c.label,
        all: policyMetrics(rows, c.test, config),
        validation: policyMetrics(validation, c.test, config),
      };
    }),
    candidates: options,
    lagGroups: [
      {
        name: `同步间隔 < ${config.selectedLagMinutes} 分钟`,
        ...count(rows.filter((r) => r.lagMinutes < config.selectedLagMinutes)),
      },
      {
        name: `同步间隔 ≥ ${config.selectedLagMinutes} 分钟`,
        ...count(rows.filter((r) => r.lagMinutes >= config.selectedLagMinutes)),
      },
    ],
    byTeam: slices("team_id"),
    byScene: slices("scene_type"),
    byDay: slices("localDay"),
    assumptions: [
      "拦截后成功消除原本失败的比例未知，以0%、25%、50%、75%、100%做情景测算。",
      "未知结果不计避免失败收益，但若被拦截仍计20工时成本。",
      "同步间隔只表示缓存最后完成同步到提交的间隔，不证明资产已过期，也不证明同步造成崩溃。",
      "无资产版本、失败原因、修复后结果、实际返工时长或全局任务总量；不宣称已实现节省或证明线上失败上升。",
    ],
  };
  const auditedRows = rows.map((r) => ({
    ...r,
    partition: r.localDay <= config.trainThrough ? "train" : "validation",
    intercept: selected.test(r),
    reason: preflight(r, config.selectedLagMinutes).reason,
  }));
  return { metrics, rows: auditedRows };
}

export function loadRender(root) {
  const config = JSON.parse(
    readFileSync(resolve(root, "render.config.json"), "utf8"),
  );
  return {
    ...analyzeRender(readFileSync(resolve(root, config.source)), config),
    config,
  };
}

export function renderCsv(rows) {
  const headers = [
    ...RENDER_HEADERS,
    "source_rows",
    "sync_age_minutes",
    "partition",
    "intercept",
    "reason",
  ];
  return csvExport(
    headers,
    rows.map((r) => ({
      ...r,
      source_rows: r.sourceRows.join(";"),
      sync_age_minutes: r.lagMinutes,
      intercept: r.intercept ? "1" : "0",
    })),
  );
}
