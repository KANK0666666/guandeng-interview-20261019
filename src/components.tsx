import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSpreadsheet,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { number, percentage, request, useResource } from "./api";
import type { Dataset, Filters, Mapping, Row, RowsPage, Note } from "./types";

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Database size={23} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={21} className="spin" /> 正在读取数据…
    </div>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="error-box" role="alert">
      {error}
    </div>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
  empty = "暂不选择",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  empty?: string | false;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="select-wrap">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {empty !== false && <option value="">{empty}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </div>
    </label>
  );
}
export function MappingBar({
  dataset,
  mapping,
  onChange,
}: {
  dataset: Dataset;
  mapping: Mapping;
  onChange: (mapping: Mapping) => void;
}) {
  const options = (type?: string) =>
    dataset.columns
      .filter((c) => !type || c.type === type)
      .map((c) => ({ value: c.name, label: c.name }));
  return (
    <>
      <div className="mapping-bar">
        <div className="mapping-label">
          <SlidersHorizontal size={16} />
          <strong>分析字段</strong>
        </div>
        <Select
          label="数值指标"
          value={mapping.metric}
          onChange={(metric) => onChange({ ...mapping, metric })}
          options={options("number")}
          empty="选择数值字段"
        />
        <Select
          label="分组维度"
          value={mapping.group}
          onChange={(group) => onChange({ ...mapping, group })}
          options={options()}
          empty="选择分类字段"
        />
        <Select
          label="日期字段"
          value={mapping.date}
          onChange={(date) => onChange({ ...mapping, date })}
          options={options("date")}
          empty="选择日期字段"
        />
        <span className="mapping-hint">按数据含义选择字段</span>
      </div>
      {dataset.columns
        .filter((c) => c.warning)
        .map((c) => (
          <ErrorBox key={c.name} error={c.warning!} />
        ))}
    </>
  );
}
export function FilterBar({
  dataset,
  mapping,
  filters,
  onChange,
  children,
}: {
  dataset: Dataset;
  mapping: Mapping;
  filters: Filters;
  onChange: (f: Filters) => void;
  children?: ReactNode;
}) {
  const values = useResource<{ values: string[]; truncated: boolean }>(
    mapping.group
      ? `/api/datasets/${dataset.id}/values?field=${encodeURIComponent(mapping.group)}`
      : null,
  );
  const active = filters.q || filters.filter || filters.from || filters.to;
  return (
    <div className="filter-bar">
      <label className="search">
        <Search size={17} />
        <input
          aria-label="搜索所有字段"
          placeholder="搜索记录、关键词…"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
        />
      </label>
      {mapping.group && (
        <label className="compact-select">
          <span className="sr-only">筛选{mapping.group}</span>
          <select
            value={filters.filter ? JSON.stringify(filters.value) : ""}
            onChange={(e) =>
              onChange({
                ...filters,
                filter: e.target.value === "" ? "" : mapping.group,
                value: e.target.value === "" ? "" : JSON.parse(e.target.value),
              })
            }
          >
            <option value="">全部{mapping.group}</option>
            {values.data?.values.map((v) => (
              <option key={v} value={JSON.stringify(v)}>
                {v || "（空值）"}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
      )}
      {mapping.date && (
        <div className="date-range">
          <input
            aria-label="开始日期"
            type="date"
            value={filters.from}
            onChange={(e) => onChange({ ...filters, from: e.target.value })}
          />
          <span>—</span>
          <input
            aria-label="结束日期"
            type="date"
            value={filters.to}
            onChange={(e) => onChange({ ...filters, to: e.target.value })}
          />
        </div>
      )}
      {active && (
        <button
          className="text-button"
          onClick={() =>
            onChange({ q: "", filter: "", value: "", from: "", to: "" })
          }
        >
          清除
        </button>
      )}
      {children}
      {values.data?.truncated && (
        <small className="filter-note">
          筛选选项仅列前 200 个值，可用关键词搜索。
        </small>
      )}
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <article className={`stat ${accent ? "stat-accent" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <p>{detail}</p>
    </article>
  );
}
export function DataTable({
  dataset,
  rows,
  onOpen,
  compact = false,
  sort,
  onSort,
  annotations = false,
  priorityColumns = [],
}: {
  dataset: Dataset;
  rows: Row[];
  onOpen: (r: Row) => void;
  compact?: boolean;
  sort?: string;
  onSort?: (field: string) => void;
  annotations?: boolean;
  priorityColumns?: string[];
}) {
  const ordered = [
    ...new Set([
      dataset.columns[0]?.name,
      ...priorityColumns,
      ...dataset.columns.map((c) => c.name),
    ]),
  ]
    .map((name) => dataset.columns.find((c) => c.name === name))
    .filter((c): c is Dataset["columns"][number] => Boolean(c));
  const columns = compact ? ordered.slice(0, 6) : ordered;
  if (!rows.length)
    return (
      <Empty title="没有符合条件的记录">试试清除筛选，或者更换关键词。</Empty>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="row-index">#</th>
            {columns.map((c) => (
              <th key={c.name} className={c.type === "number" ? "numeric" : ""}>
                {onSort ? (
                  <button onClick={() => onSort(c.name)}>
                    {c.name}
                    <span className={sort === c.name ? "sort active" : "sort"}>
                      ↕
                    </span>
                  </button>
                ) : (
                  c.name
                )}
              </th>
            ))}
            {annotations && <th>处理状态</th>}
            <th className="table-action">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="row-index">{row.id.padStart(3, "0")}</td>
              {columns.map((c, i) => (
                <td
                  key={c.name}
                  className={c.type === "number" ? "numeric" : ""}
                  title={row.data[c.name]}
                >
                  {i === 0 ? (
                    <button className="cell-link" onClick={() => onOpen(row)}>
                      {row.data[c.name] || "（空值）"}
                    </button>
                  ) : (
                    row.data[c.name] || <span className="muted">—</span>
                  )}
                </td>
              ))}
              {annotations && (
                <td>
                  <span
                    className={`status-badge ${row.note?.status === "已完成" ? "done" : row.note?.status === "跟进中" ? "progress" : ""}`}
                  >
                    <i />
                    {row.note?.status || "待处理"}
                  </span>
                </td>
              )}
              <td className="table-action">
                <button
                  className="icon-button"
                  aria-label={`查看第 ${row.id} 条记录`}
                  onClick={() => onOpen(row)}
                >
                  <ArrowUpRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({
  page,
  onChange,
}: {
  page: RowsPage;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        共 {number(page.total)} 条 · 每页 {page.pageSize} 条
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="上一页"
          disabled={page.page <= 1}
          onClick={() => onChange(page.page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {page.page} / {page.pages}
        </span>
        <button
          className="icon-button"
          aria-label="下一页"
          disabled={page.page >= page.pages}
          onClick={() => onChange(page.page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function ExportLink({
  href,
  label = "导出结果",
}: {
  href: string;
  label?: string;
}) {
  return (
    <a className="button button-secondary" href={href}>
      <ArrowDownToLine size={15} />
      {label}
    </a>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  drawer = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${wide ? "modal-wide" : ""} ${drawer ? "drawer" : ""}`}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">FIELDWORK / WORKSPACE</span>
          <h2>{title}</h2>
        </div>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function DataManager({
  datasets,
  current,
  onClose,
  onChoose,
  onImported,
}: {
  datasets: Dataset[];
  current: Dataset;
  onClose: () => void;
  onChoose: (d: Dataset) => void;
  onImported: (d: Dataset) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dragging, setDragging] = useState(false);
  async function upload(file?: File) {
    if (!file || busy) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("文件超过 5 MB，请先缩小范围。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const dataset = await request<Dataset>("/api/datasets", {
        method: "POST",
        headers: {
          "Content-Type": "text/csv",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      onImported(dataset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <Modal title="数据源" onClose={onClose} wide>
      <div className="modal-body">
        <button
          className={`upload-zone ${dragging ? "dragging" : ""}`}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload(e.dataTransfer.files[0]);
          }}
        >
          {busy ? (
            <LoaderCircle className="spin" size={28} />
          ) : (
            <Upload size={28} />
          )}
          <strong>
            {busy ? "正在解析和保存…" : "拖入 CSV，或者点击选择文件"}
          </strong>
          <span>UTF-8 / GB18030 · 最多 5 MB、20,000 行、80 列</span>
          <small>支持逗号、制表符、分号分隔；第一行为唯一表头。</small>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          className="sr-only"
          aria-label="上传 CSV 文件"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        {error && <ErrorBox error={error} />}
        <div className="section-heading">
          <h3>工作区数据</h3>
          <a className="text-button" href="/api/datasets/demo-orders-v1/source">
            <ArrowDownToLine size={14} />
            下载演示 CSV
          </a>
        </div>
        <div className="dataset-list">
          {datasets.map((d) => (
            <button
              key={d.id}
              className={`dataset-option ${d.id === current.id ? "selected" : ""}`}
              disabled={busy}
              onClick={() => onChoose(d)}
            >
              <span className="file-icon">
                <FileSpreadsheet size={21} />
              </span>
              <span>
                <strong>{d.name}</strong>
                <small>
                  {number(d.rowCount)} 行 · {d.headers.length} 列 · {d.encoding}
                  {d.demo ? " · 人工演示数据" : ""}
                </small>
              </span>
              {d.id === current.id && <Check size={18} />}
            </button>
          ))}
        </div>
        <p className="footnote">
          上传后保留原始字段和记录。分析字段可以重新选择，重复行和空值不会被自动删除。
        </p>
      </div>
    </Modal>
  );
}

export function RecordDrawer({
  dataset,
  row,
  onClose,
  onSave,
}: {
  dataset: Dataset;
  row: Row;
  onClose: () => void;
  onSave: () => void;
}) {
  const [status, setStatus] = useState(row.note?.status || "待处理");
  const [note, setNote] = useState(row.note?.note || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await request<Note>(`/api/datasets/${dataset.id}/rows/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`记录 #${row.id.padStart(3, "0")}`} onClose={onClose} drawer>
      <div className="modal-body">
        <div className="record-source">
          <FileSpreadsheet size={15} />
          {dataset.name}
        </div>
        <dl className="record-fields">
          {dataset.headers.map((h) => (
            <div key={h}>
              <dt>{h}</dt>
              <dd>{row.data[h] || "（空值）"}</dd>
            </div>
          ))}
        </dl>
        <div className="annotation">
          <h3>处理记录</h3>
          <p>添加状态和备注，便于后续核查。</p>
          <Select
            label="处理状态"
            value={status}
            onChange={setStatus}
            options={["待处理", "跟进中", "已完成"].map((v) => ({
              value: v,
              label: v,
            }))}
            empty={false}
          />
          <label className="field note-field">
            <span>备注</span>
            <textarea
              placeholder="发现了什么？下一步需要核查什么？"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
            <small>{note.length} / 2000</small>
          </label>
          {row.note && (
            <p className="footnote">
              上次更新：{new Date(row.note.updatedAt).toLocaleString("zh-CN")}
            </p>
          )}
          {error && <ErrorBox error={error} />}
          <button
            className="button button-primary full-width"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            保存处理记录
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Quality({ dataset }: { dataset: Dataset }) {
  return (
    <details className="quality">
      <summary>
        <span className="quality-indicator" />
        <strong>全量数据检查</strong>
        <span>
          {number(dataset.emptyCells)} 个空值 · {number(dataset.duplicateRows)}{" "}
          条完全重复行
        </span>
        <span className="quality-right">
          完整度 {percentage(dataset.completeness)} <ChevronDown size={14} />
        </span>
      </summary>
      <div className="quality-body">
        <p>
          类型来自字段内容推断；含前导零的编号保留为文本。数值统计跳过空值与无效值，不把它们当作
          0。百分比换算后按有效记录等权求均值；日期按 UTC
          日历日期分组，无时区时间按 UTC 解释。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>字段</th>
                <th>识别类型</th>
                <th>空值</th>
                <th>非空无效值</th>
                <th>不同值数量</th>
              </tr>
            </thead>
            <tbody>
              {dataset.columns.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>
                    {c.format === "percent"
                      ? "百分比"
                      : { text: "文本", number: "数值", date: "日期" }[c.type]}
                  </td>
                  <td>{c.missing}</td>
                  <td>{c.invalid}</td>
                  <td>{c.unique}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
