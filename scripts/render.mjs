import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { loadRender, renderCsv } from "../server/render.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const { metrics, rows } = loadRender(root);
  const outputs = {
    "render-metrics.json": JSON.stringify(metrics, null, 2) + "\n",
    "render-audit.csv": renderCsv(rows),
    "interception-queue.csv": renderCsv(rows.filter((r) => r.intercept)),
  };
  const check = process.argv.includes("--check");
  mkdirSync(resolve(root, "results"), { recursive: true });
  for (const [name, body] of Object.entries(outputs)) {
    const path = resolve(root, "results", name);
    if (check) {
      const saved = readFileSync(path, "utf8");
      if (
        !(name.endsWith(".json")
          ? isDeepStrictEqual(JSON.parse(saved), JSON.parse(body))
          : saved === body)
      )
        throw new Error(`${name} 与复算不一致，未覆盖。`);
    } else writeFileSync(path, body);
  }
  console.log(
    `${check ? "复算核对通过" : "已生成报告与逐任务审计清单"}：${metrics.source.rawRows} 行 → ${metrics.source.uniqueJobs} 个任务；失败 ${metrics.outcomes.failed}，未知 ${metrics.outcomes.unknown}；规则命中 ${metrics.all.intercepted}。`,
  );
  console.log(
    `100%有效情景净节省 ${metrics.all.netHoursAtFullEffect} 工时；50%情景 ${metrics.all.netHoursAtHalfEffect} 工时。均为历史情景测算。`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
