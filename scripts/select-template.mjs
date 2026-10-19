import { readFile, writeFile } from "node:fs/promises";
const name = process.argv[2];
const choices = ["overview", "records", "diagnostics", "all"];
if (!choices.includes(name)) {
  console.error("用法：npm run template -- overview|records|diagnostics|all");
  process.exit(1);
}
const file = new URL("../project.config.ts", import.meta.url);
let source = await readFile(file, "utf8");
const views = name === "all" ? ["overview", "records", "diagnostics"] : [name];
const viewsPattern = /views:\s*\[[^\]]*\]\s+as readonly View\[\]/;
const defaultPattern = /defaultView:\s*(["']).*?\1\s+as View/;
if (!viewsPattern.test(source) || !defaultPattern.test(source)) {
  console.error("配置格式已改变，请在 project.config.ts 中直接设置 views 和 defaultView。");
  process.exit(1);
}
source = source
  .replace(
    viewsPattern,
    `views: ${JSON.stringify(views)} as readonly View[]`,
  )
  .replace(
    defaultPattern,
    `defaultView: ${JSON.stringify(name === "all" ? "overview" : name)} as View`,
  );
await writeFile(file, source);
console.log(
  `已选择模板：${name}。刷新页面生效，运行 npm run template -- all 恢复全部。`,
);
