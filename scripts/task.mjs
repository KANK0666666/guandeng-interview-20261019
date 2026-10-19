import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { buildTask, loadTask, projectFile, sha256 } from "../server/task.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const strings = [
  "file",
  "config",
  "output",
  "kind",
  "view",
  "metric",
  "group",
  "date",
  "q",
  "filter",
  "value",
  "from",
  "to",
  "rule-field",
  "op",
  "threshold",
];
try {
  const { values: args } = parseArgs({
    args: process.argv.slice(3),
    options: Object.fromEntries([
      ...strings.map((key) => [key, { type: "string" }]),
      ["check", { type: "boolean" }],
    ]),
  });
  const configPath =
    args.config || process.env.TASK_CONFIG || "task.config.json";
  const configFile = projectFile(root, configPath);
  const output = projectFile(root, args.output || "results/task-metrics.json");
  if (output === configFile) throw new Error("报告路径不能与配置文件相同。");
  let task;
  if (mode === "prepare") {
    if (!args.file)
      throw new Error(
        "请指定 --file CSV路径，以及 --metric / --group / --date 等实际字段。纯类别任务可不指定 --metric。",
      );
    if (args.check) throw new Error("--check 只适用于 reproduce。");
    const source = resolve(process.cwd(), args.file);
    const bytes = readFileSync(source),
      hash = sha256(bytes);
    const rel = relative(root, source);
    const outside = rel === ".." || rel.startsWith(`..${sep}`);
    const inputPath = outside
      ? `private-inputs/task-${hash.slice(0, 12)}.csv`
      : rel.split(sep).join("/");
    if ([configFile, output].includes(projectFile(root, inputPath)))
      throw new Error("配置或报告路径不能覆盖原始 CSV。");
    const hasRule = ["rule-field", "op", "threshold"].some(
      (key) => args[key] !== undefined,
    );
    task = buildTask(
      {
        schemaVersion: 1,
        data: { path: inputPath, sha256: hash, kind: args.kind || "provided" },
        view: args.view || "overview",
        mapping: {
          metric: args.metric || "",
          group: args.group || "",
          date: args.date || "",
        },
        filters: Object.fromEntries(
          ["q", "filter", "value", "from", "to"].map((key) => [
            key,
            args[key] || "",
          ]),
        ),
        rule: hasRule
          ? {
              ruleField: args["rule-field"] || "",
              op: args.op || "gt",
              threshold: args.threshold ?? "",
            }
          : null,
      },
      bytes,
      root,
    );
    if (outside) {
      const dest = projectFile(root, inputPath);
      mkdirSync(dirname(dest), { recursive: true });
      if (existsSync(dest)) {
        if (sha256(readFileSync(dest)) !== hash)
          throw new Error("暂存数据同名但内容不同，请核对后再执行。");
      } else writeFileSync(dest, bytes, { flag: "wx" });
    }
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(configFile, JSON.stringify(task.config, null, 2) + "\n");
  } else if (mode === "reproduce") {
    if (
      strings
        .filter((key) => !["config", "output"].includes(key))
        .some((key) => args[key] !== undefined)
    )
      throw new Error(
        "复算只读取已保存配置，请使用 prepare 修改字段或输入文件。",
      );
    task = loadTask({ root, configPath });
    if (output === projectFile(root, task.config.data.path))
      throw new Error("报告路径不能覆盖原始 CSV。");
  } else
    throw new Error(
      "用法：npm run task:prepare -- --file CSV路径 ...；或 npm run reproduce [-- --check]。",
    );
  if (args.check) {
    const expected = JSON.parse(readFileSync(output, "utf8"));
    if (!isDeepStrictEqual(task.report, expected))
      throw new Error(
        "复算结果与已保存报告不同，请检查代码、配置和数据；报告未被覆盖。",
      );
    console.log("复算核对通过：配置、来源校验值和所有结果均一致。");
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(task.report, null, 2) + "\n");
    console.log(
      `已保存 ${relative(root, output)}；${task.dataset.rows.length} 条源记录，筛选后 ${task.report.summary.count} 条。`,
    );
  }
  if (mode === "prepare")
    console.log(
      `已保存 ${configPath}，数据 SHA-256：${task.config.data.sha256}\n${configPath === "task.config.json" ? "重启 npm run dev 后自动载入数据与默认分析条件。" : `启动服务时请将 TASK_CONFIG 环境变量设为 ${configPath}。`}原始数据的公开范围按任务要求处理。`,
    );
} catch (error) {
  console.error(`[错误] ${error.message}`);
  process.exitCode = 1;
}
