import express from "express";
import { createStore } from "./store.mjs";
import { makeDemo } from "./demo.mjs";
import {
  InputError,
  parseCsv,
  metadata,
  summarize,
  pageRows,
  diagnose,
  csvExport,
  selection,
  profile,
  PROFILE_VERSION,
} from "./data.mjs";

export function createApp({ directory = ".data", task = null } = {}) {
  const app = express();
  const store = createStore(directory);
  if (task) store.save(task.dataset);
  else if (!store.get("demo-orders-v1")) store.save(makeDemo());
  // Refresh inferred metadata for previously imported files; preserve raw rows and notes.
  for (const dataset of store.list()) {
    if (dataset.profileVersion !== PROFILE_VERSION) {
      store.save({
        ...dataset,
        columns: profile(dataset.headers, dataset.rows),
        profileVersion: PROFILE_VERSION,
      });
    }
  }
  app.locals.store = store;
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const origin = req.get("origin");
    if (
      ["POST", "PATCH", "DELETE"].includes(req.method) &&
      origin &&
      origin !== `${req.protocol}://${req.get("host")}`
    ) {
      return next(new InputError("请从本工作台页面发起操作。", 403));
    }
    next();
  });
  const query = (req) =>
    new URL(req.originalUrl, "http://localhost").searchParams;
  const getDataset = (req) => {
    const data = store.get(req.params.id);
    if (!data) throw new InputError("数据集不存在，请重新选择。", 404);
    return data;
  };

  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, storage: "SQLite", mode: "local-single-user" }),
  );
  app.get("/api/datasets", (_req, res) => res.json(store.list().map(metadata)));
  app.get("/api/workspace", (_req, res) =>
    res.json({ task: task?.workspace || null }),
  );
  app.post(
    "/api/datasets",
    express.raw({ type: () => true, limit: "5mb" }),
    (req, res) => {
      let name;
      try {
        name = decodeURIComponent(req.get("x-file-name") || "data.csv");
      } catch {
        throw new InputError("文件名编码无效。");
      }
      if (!Buffer.isBuffer(req.body)) throw new InputError("请上传 CSV 文件。");
      const dataset = parseCsv(req.body, name);
      if (!store.get(dataset.id) && store.list().length >= 21)
        throw new InputError(
          "本地最多保存 20 份上传数据，请使用新的 DATA_DIR 工作目录。",
        );
      store.save(dataset);
      res.status(201).json(metadata(dataset));
    },
  );
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/datasets/:id/summary", (req, res) =>
    res.json(summarize(getDataset(req), query(req))),
  );
  app.get("/api/datasets/:id/values", (req, res) => {
    const data = getDataset(req),
      field = query(req).get("field");
    if (!data.headers.includes(field)) throw new InputError("筛选字段无效。");
    const all = [...new Set(data.rows.map((row) => row[field]))].sort((a, b) =>
      a.localeCompare(b, "zh-CN"),
    );
    res.json({ values: all.slice(0, 200), truncated: all.length > 200 });
  });
  app.get("/api/datasets/:id/rows", (req, res) => {
    const data = getDataset(req);
    res.json(pageRows(data, query(req), store.notes(data.id)));
  });
  app.get("/api/datasets/:id/diagnostics", (req, res) => {
    const result = diagnose(getDataset(req), query(req));
    const notes = store.notes(req.params.id);
    res.json({
      ...result,
      rows: result.rows
        .slice(0, 100)
        .map((r) => ({ ...r, note: notes[r.id] ?? null })),
    });
  });
  app.patch("/api/datasets/:id/rows/:rowId", (req, res) => {
    const data = getDataset(req);
    const id = req.params.rowId;
    if (!/^[1-9]\d*$/.test(id) || Number(id) > data.rows.length)
      throw new InputError("记录不存在。", 404);
    const { status, note } = req.body || {};
    if (!["待处理", "跟进中", "已完成"].includes(status))
      throw new InputError("处理状态无效。");
    if (typeof note !== "string" || note.length > 2000)
      throw new InputError("备注必须是 2000 字以内的文字。");
    const record = {
      status,
      note: note.trim(),
      updatedAt: new Date().toISOString(),
    };
    store.setNote(data.id, id, record);
    res.json(record);
  });
  app.get("/api/datasets/:id/export", (req, res) => {
    const data = getDataset(req),
      params = query(req),
      notes = store.notes(data.id);
    let rows = params.get("ruleField")
      ? diagnose(data, params).rows
      : selection(data, params).rows;
    if (params.get("status"))
      rows = rows.filter(
        (r) => (notes[r.id]?.status || "待处理") === params.get("status"),
      );
    const unique = (base) => {
      let name = base;
      while (data.headers.includes(name)) name = `_${name}`;
      return name;
    };
    const statusColumn = unique("__处理状态"),
      noteColumn = unique("__备注");
    const output = rows.map((row) => ({
      ...row.data,
      [statusColumn]: notes[row.id]?.status || "待处理",
      [noteColumn]: notes[row.id]?.note || "",
    }));
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set(
      "Content-Disposition",
      'attachment; filename="fieldwork-export.csv"',
    );
    res.send(csvExport([...data.headers, statusColumn, noteColumn], output));
  });
  app.get("/api/datasets/:id/source", (req, res) => {
    const data = getDataset(req);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="sample.csv"');
    res.send(csvExport(data.headers, data.rows));
  });
  app.use("/api", (_req, _res, next) =>
    next(new InputError("接口不存在。", 404)),
  );
  app.use((err, _req, res, _next) => {
    const status = err.type === "entity.too.large" ? 413 : err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error:
        status === 413
          ? "文件或请求过大，CSV 上限为 5 MB。"
          : status >= 500
            ? "服务处理失败，请查看终端日志后重试。"
            : err.message,
    });
  });
  return app;
}
