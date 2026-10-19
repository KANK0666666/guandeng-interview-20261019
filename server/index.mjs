import { createApp } from "./app.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express from "express";
import { loadTask } from "./task.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const production = process.argv.includes("--production");
let task;
try {
  task = loadTask({
    root,
    configPath: process.env.TASK_CONFIG || "task.config.json",
    optional: !process.env.TASK_CONFIG,
  });
} catch (error) {
  console.error(`[任务配置错误] ${error.message}`);
  process.exit(1);
}
const app = createApp({
  directory: process.env.DATA_DIR || resolve(root, ".data"),
  task,
});
const port = Number(process.env.PORT || 4317);
const host = process.env.HOST || "127.0.0.1";
let vite;
if (production) {
  if (!existsSync(resolve(root, "dist/index.html"))) {
    console.error("请先运行 npm run build，再运行 npm start。");
    process.exit(1);
  }
  app.use(express.static(resolve(root, "dist")));
  app.use((req, res) =>
    req.method === "GET"
      ? res.sendFile(resolve(root, "dist/index.html"))
      : res.sendStatus(404),
  );
} else {
  const { createServer } = await import("vite");
  vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, host, () =>
  console.log(
    `\n  Fieldwork · 数据工作台\n  Local: http://${host}:${port}\n  API:   http://${host}:${port}/api/health\n`,
  ),
);
server.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await vite?.close();
    server.close(() => {
      app.locals.store.close();
      process.exit(0);
    });
  });
