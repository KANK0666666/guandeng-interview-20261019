import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";

export const LIMITS = { bytes: 5 * 1024 * 1024, rows: 20000, columns: 80 };
export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function numeric(value, format = "number") {
  const s = String(value ?? "").trim();
  if (format === "percent") {
    if (!/[%％]$/.test(s)) return null;
    const n = numeric(s.slice(0, -1).trim());
    return n === null ? null : n / 100;
  }
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s))
    return null;
  if (/^[+-]?0\d/.test(s)) return null; // Preserve identifiers with leading zeroes.
  const n = Number(s.replaceAll(",", ""));
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER
    ? n
    : null;
}

export function day(value) {
  let text = String(value ?? "").trim();
  if (/^\d{4}$/.test(text)) text += "-01-01";
  else if (/^\d{6}$/.test(text))
    text = `${text.slice(0, 4)}-${text.slice(4)}-01`;
  else if (/^\d{8}$/.test(text))
    text = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  else if (/^\d{4}[-/]\d{2}$/.test(text)) text += "-01";
  const match =
    /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      text,
    );
  if (!match) return null;
  const [, y, m, d, hour, minute, second, fraction, zone] = match;
  const key = `${y}-${m}-${d}`;
  const date = new Date(`${key}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== key
  )
    return null;
  if (!hour) return key;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second || 0) > 59)
    return null;
  const instant = new Date(
    `${key}T${hour}:${minute}:${second || "00"}${fraction || ""}${zone || "Z"}`,
  );
  return Number.isFinite(instant.getTime())
    ? instant.toISOString().slice(0, 10)
    : null;
}

export const PROFILE_VERSION = 2;

export function profile(headers, rows) {
  return headers.map((name) => {
    const values = rows.map((r) => r[name]).filter((v) => v !== "");
    const isIdentifier =
      /(^id$|[_ -]id$|[^\x00-\x7f]id$|编号|编码|手机|电话|邮编|证件|代码|订单号|流水号|序号|^(sku|uid|userid|customerid|orderid|用户|客户|会员|user|customer)$)/i.test(
        name,
      ) || /(?:[a-z]Id|[a-z]ID)$/.test(name);
    const namedDate =
      /(date|time|日期|时间|月份|统计期|^dt$|^day$|^month$|^period$|^year$|年份)/i.test(
        name,
      );
    const numerical = values.filter((v) => numeric(v) !== null).length;
    const percent = values.filter((v) => numeric(v, "percent") !== null).length;
    const hasPercent = values.some((v) => /[%％]$/.test(v));
    const mixedUnits = hasPercent && numerical > 0;
    const dates = values.filter((v) => day(v) !== null).length;
    // Compact calendar dates need a date-like header; amounts and IDs stay intact.
    const dateCandidate =
      namedDate || values.some((v) => /^\d{4}[-/]\d{2}[-/]\d{2}/.test(v));
    const format =
      !isIdentifier && hasPercent && !mixedUnits ? "percent" : "number";
    const validNumbers = format === "percent" ? percent : numerical;
    const type =
      values.length &&
      !isIdentifier &&
      dateCandidate &&
      dates / values.length >= 0.9
        ? "date"
        : values.length &&
            !isIdentifier &&
            !mixedUnits &&
            !(
              namedDate && values.some((v) => /^\d{4}(?:\d{2}){0,2}$/.test(v))
            ) &&
            validNumbers / values.length >= 0.9
          ? "number"
          : "text";
    return {
      name,
      type,
      format: type === "number" ? format : undefined,
      warning:
        !isIdentifier && mixedUnits
          ? `「${name}」混用百分号与无单位数字，已保留为文本；请统一单位后重新导入。`
          : undefined,
      missing: rows.length - values.length,
      unique: new Set(values).size,
      invalid:
        type === "number"
          ? values.length - validNumbers
          : type === "date"
            ? values.length - dates
            : 0,
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
    profileVersion: PROFILE_VERSION,
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
  const fromText = query.get("from") || "",
    toText = query.get("to") || "";
  const from = fromText ? day(fromText) : "",
    to = toText ? day(toText) : "";
  if ((fromText && !from) || (toText && !to) || (from && to && from > to))
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
  const metricFormat =
    dataset.columns.find((c) => c.name === metric)?.format || "number";
  const aggregation = !metric
    ? "count"
    : metricFormat === "percent"
      ? "mean"
      : "sum";
  const values = metric
    ? rows
        .map((r) => numeric(r.data[metric], metricFormat))
        .filter((n) => n !== null)
    : [];
  const total = values.reduce((a, b) => a + b, 0);
  const groups = new Map(),
    trend = new Map();
  const add = (map, key, row) => {
    const entry = map.get(key) ?? {
      name: key,
      count: 0,
      sum: 0,
      validValues: 0,
    };
    entry.count++;
    const value = metric ? numeric(row.data[metric], metricFormat) : 1;
    if (value !== null) {
      entry.sum += value;
      entry.validValues++;
    }
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
  const aggregate = ({ sum, ...entry }) => ({
    ...entry,
    excludedValues: entry.count - entry.validValues,
    value: entry.validValues
      ? aggregation === "mean"
        ? sum / entry.validValues
        : sum
      : null,
  });
  return {
    count: rows.length,
    metric,
    metricFormat,
    aggregation,
    total: metric && values.length && metricFormat !== "percent" ? total : null,
    average: values.length ? total / values.length : null,
    validValues: values.length,
    excludedValues: metric ? rows.length - values.length : 0,
    completeness: rows.length
      ? 1 - missing / (rows.length * dataset.headers.length)
      : null,
    groupCount: groups.size,
    groups: [...groups.values()]
      .map(aggregate)
      .sort((a, b) =>
        a.value === null || b.value === null
          ? a.value === b.value
            ? 0
            : a.value === null
              ? 1
              : -1
          : b.value - a.value,
      )
      .slice(0, 8),
    trend: [...trend.values()]
      .map(aggregate)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function diagnose(dataset, query) {
  const { rows } = selection(dataset, query);
  const field = column(dataset, query.get("ruleField"), "规则", ["number"]);
  if (!field) throw new InputError("请先选择用于诊断的数值字段。");
  const op = query.get("op") || "gt";
  const thresholdText = query.get("threshold") ?? "";
  const threshold = Number(thresholdText);
  const format =
    dataset.columns.find((c) => c.name === field)?.format || "number";
  // UI/API thresholds for percentage columns use percentage points: 12.5 means 12.5%.
  const comparisonThreshold =
    format === "percent" ? threshold / 100 : threshold;
  if (!thresholdText.trim() || !Number.isFinite(threshold))
    throw new InputError("请填写有效的数字阈值。");
  if (!["gt", "gte", "lt", "lte"].includes(op))
    throw new InputError("规则比较方式无效。");
  const valid = rows.filter((row) => numeric(row.data[field], format) !== null);
  const matches = valid
    .filter((row) => {
      const value = numeric(row.data[field], format);
      return op === "gt"
        ? value > comparisonThreshold
        : op === "gte"
          ? value >= comparisonThreshold
          : op === "lt"
            ? value < comparisonThreshold
            : value <= comparisonThreshold;
    })
    .sort((a, b) =>
      op.startsWith("g")
        ? numeric(b.data[field], format) - numeric(a.data[field], format)
        : numeric(a.data[field], format) - numeric(b.data[field], format),
    );
  return {
    field,
    op,
    threshold,
    format,
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
    const { type, format } = dataset.columns.find((c) => c.name === sort);
    const direction = query.get("direction") === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      if (type === "number") {
        const av = numeric(a.data[sort], format),
          bv = numeric(b.data[sort], format);
        if (av === null || bv === null)
          return av === bv ? 0 : av === null ? 1 : -1;
        return (av - bv) * direction;
      }
      if (type === "date") {
        const av = day(a.data[sort]),
          bv = day(b.data[sort]);
        if (av === null || bv === null)
          return av === bv ? 0 : av === null ? 1 : -1;
        return av.localeCompare(bv) * direction;
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
    if (
      /^[\s]*[=+@-]/.test(s) &&
      numeric(s) === null &&
      numeric(s, "percent") === null
    )
      s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [headers, ...rows.map((r) => headers.map((h) => r[h]))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
