import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";

export const LIMITS = { bytes: 5 * 1024 * 1024, rows: 20000, columns: 80 };
export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function numeric(value) {
  const s = String(value ?? "").trim();
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s))
    return null;
  if (/^[+-]?0\d/.test(s)) return null; // Preserve identifiers with leading zeroes.
  const n = Number(s.replaceAll(",", ""));
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER
    ? n
    : null;
}

export function day(value) {
  if (
    String(value).includes("T") &&
    !Number.isFinite(Date.parse(String(value)))
  )
    return null;
  const match =
    /^(\d{4})[-/](\d{2})[-/](\d{2})(?:$|T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$)/.exec(
      String(value),
    );
  if (!match) return null;
  const [, y, m, d] = match;
  const key = `${y}-${m}-${d}`;
  const date = new Date(`${key}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== key
  )
    return null;
  return key;
}

export function profile(headers, rows) {
  return headers.map((name) => {
    const values = rows.map((r) => r[name]).filter((v) => v !== "");
    const isIdentifier = /(^id$|_id$|编号|编码|手机|电话|邮编|证件|代码)/i.test(
      name,
    );
    const numerical = values.filter((v) => numeric(v) !== null).length;
    const dates = values.filter((v) => day(v) !== null).length;
    const type =
      values.length && !isIdentifier && numerical / values.length >= 0.9
        ? "number"
        : values.length && dates === values.length
          ? "date"
          : "text";
    return {
      name,
      type,
      missing: rows.length - values.length,
      unique: new Set(values).size,
      invalid: type === "number" ? values.length - numerical : 0,
      examples: [...new Set(values)].slice(0, 3),
    };
  });
}

export function parseCsv(buffer, filename = "data.csv") {
  if (!buffer.length)
    throw new InputError("文件为空，请选择包含表头和数据的 CSV。");
  if (buffer.length > LIMITS.bytes)
    throw new InputError("文件超过 5 MB，请先截取相关数据。", 413);
  let text,
    encoding = "UTF-8";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      text = new TextDecoder("gb18030", { fatal: true }).decode(buffer);
      encoding = "GB18030";
    } catch {
      throw new InputError("无法解码文件，请另存为 UTF-8 CSV。");
    }
  }
  if (text.includes("\0"))
    throw new InputError("文件包含二进制内容，请上传 CSV 文本文件。");
  const candidates = [",", "\t", ";"];
  const results = [];
  for (const delimiter of candidates) {
    try {
      const cells = parse(text, {
        bom: true,
        skip_empty_lines: true,
        delimiter,
        trim: true,
        max_record_size: 100000,
        relax_column_count: true,
      });
      if (cells.length) results.push({ cells, delimiter });
    } catch {
      /* Try the other supported delimiters. */
    }
  }
  results.sort((a, b) => b.cells[0].length - a.cells[0].length);
  const result = results[0];
  if (!result)
    throw new InputError("CSV 格式错误：请检查引号和每行列数是否一致。");
  const [headers, ...cells] = result.cells;
  if (cells.some((row) => row.length !== headers.length)) {
    throw new InputError("CSV 列数不一致，请检查表头和数据行。");
  }
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
    throw new InputError("表头不能留空或重复，请为每一列设置唯一名称。");
  if (headers.length > LIMITS.columns)
    throw new InputError(`最多支持 ${LIMITS.columns} 列。`);
  if (!cells.length) throw new InputError("文件只有表头，没有可分析的数据。");
  if (cells.length > LIMITS.rows)
    throw new InputError(
      `最多支持 ${LIMITS.rows.toLocaleString()} 行，请先缩小数据范围。`,
    );
  const rows = cells.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]])),
  );
  const safeName =
    String(filename)
      .replace(/[\x00-\x1f/\\]/g, "_")
      .slice(0, 160) || "data.csv";
  return {
    id: createHash("sha256").update(buffer).digest("hex").slice(0, 24),
    name: safeName,
    demo: false,
    encoding,
    importedAt: new Date().toISOString(),
    headers,
    rows,
    columns: profile(headers, rows),
  };
}

export function metadata(dataset) {
  const { rows, ...rest } = dataset;
  const emptyCells = dataset.columns.reduce((n, c) => n + c.missing, 0);
  const distinctRows = new Set(rows.map((r) => JSON.stringify(r))).size;
  return {
    ...rest,
    rowCount: rows.length,
    emptyCells,
    duplicateRows: rows.length - distinctRows,
    completeness: 1 - emptyCells / (rows.length * dataset.headers.length),
  };
}

function column(dataset, value, label, types) {
  if (!value) return "";
  const field = dataset.columns.find((c) => c.name === value);
  if (!field || (types && !types.includes(field.type)))
    throw new InputError(`${label}字段无效，请重新选择。`);
  return value;
}

export function selection(dataset, query) {
  const metric = column(dataset, query.get("metric"), "指标", ["number"]);
  const group = column(dataset, query.get("group"), "分组");
  const date = column(dataset, query.get("date"), "日期", ["date"]);
  const filter = column(dataset, query.get("filter"), "筛选");
  const value = query.get("value") ?? "";
  const q = (query.get("q") ?? "").trim().toLocaleLowerCase();
  const from = query.get("from") || "",
    to = query.get("to") || "";
  if ((from && !day(from)) || (to && !day(to)) || (from && to && from > to))
    throw new InputError("日期范围无效。");
  const rows = dataset.rows
    .map((data, i) => ({ id: String(i + 1), data }))
    .filter(({ data }) => {
      if (
        q &&
        !Object.values(data).some((v) => v.toLocaleLowerCase().includes(q))
      )
        return false;
      if (filter && data[filter] !== value) return false;
      const dt = date ? day(data[date]) : null;
      if (date && from && (!dt || dt < from)) return false;
      if (date && to && (!dt || dt > to)) return false;
      return true;
    });
  return { metric, group, date, rows };
}

export function summarize(dataset, query) {
  const { rows, metric, group, date } = selection(dataset, query);
  const values = metric
    ? rows.map((r) => numeric(r.data[metric])).filter((n) => n !== null)
    : [];
  const total = values.reduce((a, b) => a + b, 0);
  const groups = new Map(),
    trend = new Map();
  const add = (map, key, row) => {
    const entry = map.get(key) ?? { name: key, count: 0, value: 0 };
    entry.count++;
    entry.value += metric ? (numeric(row.data[metric]) ?? 0) : 1;
    map.set(key, entry);
  };
  for (const row of rows) {
    if (group) add(groups, row.data[group] || "（空值）", row);
    const dt = date && day(row.data[date]);
    if (dt) add(trend, dt, row);
  }
  const missing = rows.reduce(
    (sum, row) => sum + Object.values(row.data).filter((v) => v === "").length,
    0,
  );
  return {
    count: rows.length,
    metric,
    total: metric ? total : null,
    average: values.length ? total / values.length : null,
    validValues: values.length,
    excludedValues: metric ? rows.length - values.length : 0,
    completeness: rows.length
      ? 1 - missing / (rows.length * dataset.headers.length)
      : null,
    groupCount: groups.size,
    groups: [...groups.values()].sort((a, b) => b.value - a.value).slice(0, 8),
    trend: [...trend.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function diagnose(dataset, query) {
  const { rows } = selection(dataset, query);
  const field = column(dataset, query.get("ruleField"), "规则", ["number"]);
  if (!field) throw new InputError("请先选择用于诊断的数值字段。");
  const op = query.get("op") || "gt";
  const thresholdText = query.get("threshold") ?? "";
  const threshold = Number(thresholdText);
  if (!thresholdText.trim() || !Number.isFinite(threshold))
    throw new InputError("请填写有效的数字阈值。");
  if (!["gt", "gte", "lt", "lte"].includes(op))
    throw new InputError("规则比较方式无效。");
  const valid = rows.filter((row) => numeric(row.data[field]) !== null);
  const matches = valid
    .filter((row) => {
      const value = numeric(row.data[field]);
      return op === "gt"
        ? value > threshold
        : op === "gte"
          ? value >= threshold
          : op === "lt"
            ? value < threshold
            : value <= threshold;
    })
    .sort((a, b) =>
      op.startsWith("g")
        ? numeric(b.data[field]) - numeric(a.data[field])
        : numeric(a.data[field]) - numeric(b.data[field]),
    );
  return {
    field,
    op,
    threshold,
    evaluated: valid.length,
    excluded: rows.length - valid.length,
    matched: matches.length,
    rate: valid.length ? matches.length / valid.length : null,
    rows: matches,
  };
}

export function pageRows(dataset, query, notes = {}) {
  const selected = selection(dataset, query);
  let rows = selected.rows;
  const status = query.get("status") || "";
  if (status)
    rows = rows.filter((r) => (notes[r.id]?.status || "待处理") === status);
  const sort = column(dataset, query.get("sort"), "排序");
  if (sort) {
    const type = dataset.columns.find((c) => c.name === sort).type;
    const direction = query.get("direction") === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      if (type === "number") {
        const av = numeric(a.data[sort]),
          bv = numeric(b.data[sort]);
        if (av === null || bv === null)
          return av === bv ? 0 : av === null ? 1 : -1;
        return (av - bv) * direction;
      }
      return a.data[sort].localeCompare(b.data[sort], "zh-CN") * direction;
    });
  }
  const rawPage = Number(query.get("page") || 1);
  if (!Number.isInteger(rawPage) || rawPage < 1)
    throw new InputError("页码无效。");
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(rawPage, pages);
  return {
    rows: rows
      .slice((page - 1) * pageSize, page * pageSize)
      .map((r) => ({ ...r, note: notes[r.id] ?? null })),
    total: rows.length,
    page,
    pages,
    pageSize,
  };
}

export function csvExport(headers, rows) {
  const cell = (value) => {
    let s = String(value ?? "");
    // Spreadsheet formula neutralization. Ordinary negative numbers remain numeric.
    if (/^[\s]*[=+@-]/.test(s) && numeric(s) === null) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [headers, ...rows.map((r) => headers.map((h) => r[h]))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
