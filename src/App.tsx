import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  FileSpreadsheet,
  LayoutDashboard,
  ListFilter,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import { project } from "../project.config";
import { number, parameters, useResource } from "./api";
import {
  DataManager,
  ErrorBox,
  ExportLink,
  FilterBar,
  Loading,
  MappingBar,
  Modal,
  RecordDrawer,
} from "./components";
const Overview = lazy(() => import("./views/Overview"));
import Records from "./views/Records";
import Diagnostics from "./views/Diagnostics";
import type { Dataset, Filters, Mapping, Row, View, Workspace } from "./types";

const emptyFilters: Filters = {
  q: "",
  filter: "",
  value: "",
  from: "",
  to: "",
};
const nav = [
  {
    id: "overview" as const,
    icon: LayoutDashboard,
    hint: "分析与展示",
    letter: "A",
  },
  { id: "records" as const, icon: ListFilter, hint: "检索与跟进", letter: "B" },
  {
    id: "diagnostics" as const,
    icon: ScanLine,
    hint: "规则与核查",
    letter: "C",
  },
];
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private browsing can disable storage. */
  }
}

export default function App() {
  const [view, setView] = useState<View>(() => {
    const value = new URLSearchParams(location.search).get("view") as View;
    return project.views.includes(value) ? value : project.defaultView;
  });
  const [selectedId, setSelectedId] = useState("");
  const [listRevision, setListRevision] = useState(0),
    [rowRevision, setRowRevision] = useState(0);
  const datasets = useResource<Dataset[]>("/api/datasets", listRevision);
  const workspace = useResource<Workspace>("/api/workspace", listRevision);
  const task = workspace.data?.task;
  const initialDatasetId =
    task?.datasetId || stored("fieldwork-dataset") || "demo-orders-v1";
  const dataset =
    datasets.data?.find((d) => d.id === (selectedId || initialDatasetId)) ||
    datasets.data?.[0];
  const activeTask = dataset?.id === task?.datasetId ? task : null;
  const connectionError = datasets.error || workspace.error;
  const [mapping, setMapping] = useState<Mapping>({
    metric: "",
    group: "",
    date: "",
  });
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dataOpen, setDataOpen] = useState(false),
    [guideOpen, setGuideOpen] = useState(false);
  const [record, setRecord] = useState<Row | null>(null),
    [toast, setToast] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.q), 220);
    return () => clearTimeout(timer);
  }, [filters.q]);
  useEffect(() => {
    if (!dataset || !workspace.data) return;
    let value: Mapping =
      activeTask?.mapping ||
      (dataset.id === "demo-orders-v1"
        ? project.demoMapping
        : { metric: "", group: "", date: "" });
    try {
      if (!activeTask)
        value =
          JSON.parse(stored(`fieldwork-mapping-${dataset.id}`) || "null") ||
          value;
    } catch {
      /* Use the default mapping. */
    }
    const valid = (name: string, type?: string) =>
      dataset.columns.some((c) => c.name === name && (!type || c.type === type))
        ? name
        : "";
    setMapping({
      metric: valid(value.metric, "number"),
      group: valid(value.group),
      date: valid(value.date, "date"),
    });
    setFilters(activeTask?.filters || emptyFilters);
    setDebouncedSearch(activeTask?.filters.q || "");
    setRecord(null);
    save("fieldwork-dataset", dataset.id);
  }, [dataset?.id, workspace.data, activeTask?.revision]);
  useEffect(() => {
    const urlView = new URLSearchParams(location.search).get("view") as View;
    if (
      task &&
      !project.views.includes(urlView) &&
      project.views.includes(task.view)
    )
      setView(task.view);
  }, [task?.revision]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  function navigate(next: View) {
    setView(next);
    const url = new URL(location.href);
    url.searchParams.set("view", next);
    history.replaceState(null, "", url);
  }
  function map(value: Mapping) {
    setMapping(value);
    setFilters(emptyFilters);
    if (dataset) save(`fieldwork-mapping-${dataset.id}`, JSON.stringify(value));
  }
  useEffect(() => {
    document.title = `${project.name} · ${project.titles[view]}`;
  }, [view]);
  const query = parameters(mapping, { ...filters, q: debouncedSearch });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="?view=overview">
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          <strong>
            {project.name}
            <span> / 工作空间</span>
          </strong>
        </a>
        <div className="workspace-name">
          <span className="workspace-avatar">F</span>
          <span>
            <strong>{project.subtitle}</strong>
            <small>
              {project.templateMode ? "全栈实战 · 模板工作区" : "项目工作区"}
            </small>
          </span>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">
          工作台 <span>WORKSPACE</span>
        </div>
        <nav aria-label="模板导航">
          {nav
            .filter((n) => project.views.includes(n.id))
            .map((n) => (
              <button
                key={n.id}
                className={`nav-item ${view === n.id ? "active" : ""}`}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={19} />
                <span>{project.titles[n.id]}</span>
                {project.templateMode && (
                  <span className="nav-letter">{n.letter}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-label">数据与资源</div>
        <button
          className="nav-item"
          onClick={() => setDataOpen(true)}
          disabled={!dataset}
        >
          <Database size={18} />
          <span>数据源</span>
          <span className="nav-count">{datasets.data?.length || 0}</span>
        </button>
        {project.templateMode && (
          <button className="nav-item" onClick={() => setGuideOpen(true)}>
            <BookOpen size={18} />
            <span>模板使用指引</span>
            <ArrowUpRight size={14} />
          </button>
        )}
        <div className="sidebar-bottom">
          <div className="ready-card">
            <span className="ready-icon">
              <ChartNoAxesCombined size={22} />
            </span>
            <strong>从一份 CSV 开始</strong>
            <p>
              导入数据，选好字段。
              <br />
              把时间留给真正的问题。
            </p>
            <button onClick={() => setDataOpen(true)} disabled={!dataset}>
              接入你的数据
              <ArrowRightIcon />
            </button>
          </div>
          <div className="user-block">
            <span className="user-avatar">访</span>
            <div>
              <strong>本地工作区</strong>
              <small>
                <i className={connectionError ? "offline" : ""} />
                {connectionError
                  ? "服务未连接"
                  : datasets.loading || workspace.loading
                    ? "正在连接"
                    : "服务已连接"}
              </small>
            </div>
            <span className="version">v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>{project.titles[view]}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={`source-badge ${dataset?.demo ? "demo-badge" : ""}`}
            >
              <i />
              {dataset?.demo
                ? "演示数据 · 人工构造"
                : dataset
                  ? "已导入数据"
                  : "连接数据中"}
            </span>
            <span className="topbar-divider" />
            <button
              className="topbar-import"
              onClick={() => setDataOpen(true)}
              disabled={!dataset}
            >
              <Upload size={15} />
              导入 CSV
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {project.templateMode
                  ? `TEMPLATE ${nav.find((n) => n.id === view)?.letter}`
                  : project.name.toUpperCase()}{" "}
                <span>/</span> {nav.find((n) => n.id === view)?.hint}
              </div>
              <h1>
                {project.titles[view]}
                <span className="title-dot">.</span>
              </h1>
              <p>{project.descriptions[view]}</p>
            </div>
            {dataset && (
              <div className="heading-actions">
                <button
                  className="button button-secondary dataset-switch"
                  onClick={() => setDataOpen(true)}
                >
                  <FileSpreadsheet size={16} />
                  <span>{dataset.name}</span>
                  <ChevronDown size={13} />
                </button>
                <ExportLink
                  href={`/api/datasets/${dataset.id}/export?${query}`}
                  label="导出数据"
                />
              </div>
            )}
          </div>
          {connectionError ? (
            <>
              <ErrorBox error={connectionError} />
              <button
                className="button button-primary"
                onClick={() => setListRevision((n) => n + 1)}
              >
                重新连接
              </button>
            </>
          ) : !dataset || !workspace.data ? (
            <Loading />
          ) : (
            <>
              <div className="context-line">
                <span>
                  <i />
                  {dataset.demo
                    ? "人工构造示例，用于验证模板功能"
                    : "当前工作区已保存此数据集"}
                </span>
                <span>
                  {number(dataset.rowCount)} 行 <b>·</b>{" "}
                  {dataset.headers.length} 个字段 <b>·</b> {dataset.encoding}
                </span>
              </div>
              <MappingBar dataset={dataset} mapping={mapping} onChange={map} />
              <FilterBar
                dataset={dataset}
                mapping={mapping}
                filters={filters}
                onChange={setFilters}
              />
              {view === "overview" && (
                <Suspense fallback={<Loading />}>
                  <Overview
                    key={dataset.id}
                    dataset={dataset}
                    mapping={mapping}
                    query={query}
                    onOpen={setRecord}
                    onRecords={() => navigate("records")}
                    revision={rowRevision}
                  />
                </Suspense>
              )}
              {view === "records" && (
                <Records
                  key={dataset.id}
                  dataset={dataset}
                  query={query}
                  onOpen={setRecord}
                  revision={rowRevision}
                />
              )}
              {view === "diagnostics" && (
                <Diagnostics
                  key={`${dataset.id}-${activeTask?.revision || "local"}`}
                  dataset={dataset}
                  mapping={mapping}
                  query={query}
                  onOpen={setRecord}
                  revision={rowRevision}
                  defaultRule={activeTask ? activeTask.rule : undefined}
                />
              )}
              <footer className="page-footer">
                <span>
                  FIELDWORK <b>/</b> 从数据到行动
                </span>
                <span>
                  {dataset.demo
                    ? "所有示例数值均为人工生成"
                    : "统计口径可追溯到源记录"}
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {dataOpen && dataset && (
        <DataManager
          datasets={datasets.data || []}
          current={dataset}
          onClose={() => setDataOpen(false)}
          onChoose={(d) => {
            setSelectedId(d.id);
            setDataOpen(false);
          }}
          onImported={(d) => {
            setSelectedId(d.id);
            setListRevision((n) => n + 1);
            setDataOpen(false);
            setToast(`已导入 ${d.rowCount} 条记录，请选择分析字段。`);
          }}
        />
      )}
      {record && dataset && (
        <RecordDrawer
          key={`${dataset.id}-${record.id}`}
          dataset={dataset}
          row={record}
          onClose={() => setRecord(null)}
          onSave={() => {
            setRecord(null);
            setRowRevision((n) => n + 1);
            setToast("处理记录已保存。");
          }}
        />
      )}
      {guideOpen && (
        <Modal
          title="选一套模板，从问题出发"
          onClose={() => setGuideOpen(false)}
          wide
        >
          <div className="modal-body guide">
            <p>
              三套模板共用上传、筛选、数据处理和持久化。拿到任务后，选择最贴近目标的一套作为主页面。
            </p>
            {nav
              .filter((n) => project.views.includes(n.id))
              .map((n) => (
                <button
                  className="guide-card"
                  key={n.id}
                  onClick={() => {
                    navigate(n.id);
                    setGuideOpen(false);
                  }}
                >
                  <span className="guide-letter">{n.letter}</span>
                  <span>
                    <strong>{project.titles[n.id]}</strong>
                    <small>
                      {n.id === "overview"
                        ? "适合：经营分析、趋势观察、分类比较。交付重点是指标口径与证据。"
                        : n.id === "records"
                          ? "适合：客户、订单、线索、工单等内部工具。交付重点是操作闭环。"
                          : "适合：超时、低库存等阈值筛选。交付重点是规则解释与核查清单。"}
                    </small>
                  </span>
                  <ArrowUpRight size={19} />
                </button>
              ))}
            <div className="guide-steps">
              <strong>正式任务的最短路径</strong>
              <ol>
                <li>先写一句话：谁要用它，做什么决定。</li>
                <li>导入真实 CSV，核对字段、空值和统计口径。</li>
                <li>保留最有用的主页面，补上题目要求的业务规则。</li>
                <li>验证一个完整案例，再整理 README 和提交仓库。</li>
              </ol>
            </div>
            <p className="footnote">
              当前演示数据与阈值均为人工构造，不能用作正式题目的分析结论。
            </p>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function ArrowRightIcon() {
  return <ArrowDownToLine size={15} style={{ transform: "rotate(-90deg)" }} />;
}
