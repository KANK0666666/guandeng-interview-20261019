import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseCsv, summarize, diagnose, metadata } from "./data.mjs";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function projectFile(root, name) {
  if (
    typeof name !== "string" ||
    !name ||
    isAbsolute(name) ||
    name.includes("\\") ||
    /^[A-Za-z]:/.test(name)
  ) {
    throw new Error("配置中的文件路径必须相对项目根目录，使用 / 分隔。");
  }
  const path = resolve(root, name);
  if (relative(root, path).split(/[\\/]/).includes(".."))
    throw new Error("数据文件必须放在项目目录内。");
  return path;
}

function fields(value, names, label) {
  const input = value ?? {};
  if (
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((name) => !names.includes(name))
  ) {
    throw new Error(`${label}配置含未知字段。`);
  }
  return Object.fromEntries(
    names.map((name) => {
      const v = input[name] ?? "";
      if (typeof v !== "string")
        throw new Error(`${label}.${name} 必须是字符串。`);
      return [name, v];
    }),
  );
}

export function buildTask(input, bytes, root) {
  if (!input || input.schemaVersion !== 1)
    throw new Error("任务配置 schemaVersion 必须为 1。");
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "schemaVersion",
          "data",
          "view",
          "mapping",
          "filters",
          "rule",
        ].includes(key),
    )
  )
    throw new Error("任务配置含未知字段，请核对字段名。");
  const data = fields(input.data, ["path", "sha256", "kind"], "data");
  projectFile(root, data.path);
  if (!/^[a-f0-9]{64}$/i.test(data.sha256))
    throw new Error("data.sha256 必须是完整的 SHA-256 校验值。");
  data.sha256 = data.sha256.toLowerCase();
  if (!["provided", "synthetic"].includes(data.kind))
    throw new Error(
      "data.kind 必须是 provided（发放数据）或 synthetic（人工测试数据）。",
    );
  if (sha256(bytes) !== data.sha256)
    throw new Error(
      `数据校验失败：${data.path} 的 SHA-256 与配置不一致，请核对原文件。`,
    );
  const view = input.view ?? "overview";
  if (!["overview", "records", "diagnostics"].includes(view))
    throw new Error("view 必须是 overview、records 或 diagnostics。");
  const mapping = fields(input.mapping, ["metric", "group", "date"], "mapping");
  const filters = fields(
    input.filters,
    ["q", "filter", "value", "from", "to"],
    "filters",
  );
  if ((filters.from || filters.to) && !mapping.date)
    throw new Error("日期筛选需要先指定 mapping.date。");
  if (filters.value && !filters.filter)
    throw new Error("分类筛选值需要先指定 filters.filter。");
  const rule =
    input.rule == null
      ? null
      : fields(input.rule, ["ruleField", "op", "threshold"], "rule");
  if (rule && !["gt", "gte", "lt", "lte"].includes(rule.op))
    throw new Error("rule.op 必须是 gt、gte、lt 或 lte。");
  const dataset = {
    ...parseCsv(bytes, data.path.split("/").at(-1)),
    demo: data.kind === "synthetic",
  };
  const query = new URLSearchParams({ ...mapping, ...filters });
  const summary = summarize(dataset, query); // Validate every mapped column and filter before saving anything.
  let diagnostics = null;
  if (rule) {
    const { rows, ...result } = diagnose(
      dataset,
      new URLSearchParams({ ...mapping, ...filters, ...rule }),
    );
    diagnostics = { ...result, rowIds: rows.map((row) => row.id) };
  }
  const config = { schemaVersion: 1, data, view, mapping, filters, rule };
  const revision = sha256(JSON.stringify(config));
  const info = metadata(dataset);
  const report = {
    schemaVersion: 1,
    configurationSha256: revision,
    source: {
      ...data,
      rows: info.rowCount,
      columns: dataset.headers,
      encoding: dataset.encoding,
    },
    mapping,
    filters,
    rule,
    summary,
    diagnostics,
    notes: [
      "按配置筛选；数值排除空值/无效值；百分比使用记录等权均值，非按业务分母加权。",
      "日期统一为 UTC；summary.groups 仅列前 8 组，summary.trend 包含全部有效日期。",
      "诊断 rowIds 是原始 CSV 数据记录序号（从 1 开始，不含表头），包括全部命中记录。",
      ...(data.kind === "synthetic"
        ? ["人工测试数据，仅验证功能，不作为业务结论。"]
        : []),
    ],
  };
  return {
    config,
    dataset,
    report,
    workspace: {
      datasetId: dataset.id,
      revision,
      mapping,
      filters,
      rule,
      view,
      sourceSha256: data.sha256,
    },
  };
}

export function loadTask({
  root,
  configPath = "task.config.json",
  optional = false,
}) {
  const file = projectFile(root, configPath);
  let input;
  try {
    input = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && optional) return null;
    if (error.code === "ENOENT")
      throw new Error(
        `缺少 ${configPath}。请先运行 npm run task:prepare，考前演练可用 npm run reproduce:example。`,
      );
    throw new Error(`无法读取任务配置 ${configPath}：${error.message}`);
  }
  let bytes;
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("任务配置必须是 JSON 对象。");
  const path = projectFile(root, input.data?.path);
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(
        `缺少数据文件 ${input.data.path}。请按 README 放入原始 CSV；不会退回演示数据。`,
      );
    throw error;
  }
  return buildTask(input, bytes, root);
}
