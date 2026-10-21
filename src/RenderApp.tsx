import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Clock3,
  Database,
  FileCheck2,
  Info,
  Layers3,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { syncReason } from "./presentation.mjs";
import ServicePolicyPanel from "./ServicePolicyPanel";
import ThresholdStrategyPanel from "./ThresholdStrategyPanel";
import EvidencePanel from "./EvidencePanel";
import { normalizeThresholds } from "./threshold-strategy.mjs";
import {
  normalizeServicePolicy,
  selectHistoricalTasks,
  type HistoryFilters,
  type ServicePolicy,
} from "./service-policy.mjs";
import "./render.css";
import "./focused-layout.css";

type Counts = {
  jobs: number;
  failed: number;
  succeeded: number;
  unknown: number;
  known: number;
  failureRate: number | null;
};
type Policy = Counts & {
  intercepted: number;
  caughtFailures: number;
  falseInterceptions: number;
  interceptedUnknown: number;
  missedFailures: number;
  knownPrecision: number | null;
  recall: number | null;
  interceptCost: number;
  baselineKnownCrashHours: number;
  netHoursAtFullEffect: number;
  netHoursAtHalfEffect: number;
  breakEvenEffectiveness: number | null;
};
export type Job = {
  job_id: string;
  created_at: string;
  asset_synced_at: string;
  team_id: string;
  scene_type: string;
  gpu_mem_free_mb: string;
  polygon_count: string;
  outcome: "success" | "failure" | "unknown";
  lagMinutes: number;
  sourceRows: number[];
  partition: string;
  intercept: boolean;
  reason: string;
};
type Group = Counts & {
  name: string;
  below: Counts;
  above: Counts;
  policy: Policy;
};
type Fraction = { numerator: number; denominator: number; value: number };
export type Metrics = {
  source: {
    rawRows: number;
    uniqueJobs: number;
    duplicatesRemoved: number;
    duplicateJobs: number;
    sha256: string;
  };
  outcomes: Counts;
  featureTiming: {
    gpu_mem_free_mb: {
      label: string;
      explanation: string;
      requiredEvidence: string;
    };
  };
  costs: { crash: number; intercept: number };
  selectedRule: { label: string; lagMinutes: number };
  all: Policy;
  train: Policy;
  validation: Policy;
  lagGroups: ({ name: string } & Counts)[];
  candidates: { id: string; label: string; train: Policy }[];
  baselines: { id: string; label: string; all: Policy; validation: Policy }[];
  byDay: Group[];
  byTeam: Group[];
  ruleSensitivity: {
    segments: {
      from: Fraction;
      to: Fraction;
      label: string;
      preferredRuleId: string;
      intercepted: number;
      caughtFailures: number;
    }[];
    boundaries: {
      effectiveness: Fraction;
      ruleIds: string[];
      preferredRuleId: string;
      label: string;
    }[];
  };
  stratification: {
    groups: {
      dimension: string;
      total: number;
      comparable: number;
      positive: number;
    }[];
    caveat: string;
  };
  split: { caveat: string };
};
type Report = { metrics: Metrics; rows: Job[] };
const date = (v: string) =>
  new Date(v).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const outcomeName = {
  success: "渲染成功",
  failure: "渲染失败",
  unknown: "结果未知",
};

export default function RenderApp() {
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState("");
  const [tab, setTab] = useState<"queue" | "evidence" | "strategy">(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    return view === "queue" || view === "evidence" ? view : "strategy";
  });
  const [settingsOpen, setSettingsOpen] = useState(
    () => new URLSearchParams(window.location.search).get("view") === "service",
  );
  const [memory, setMemory] = useState(3);
  const [queueBasis, setQueueBasis] = useState<"current" | "original">(
    "current",
  );
  const [thresholds, setThresholds] = useState(() => {
    try {
      return normalizeThresholds(
        JSON.parse(localStorage.getItem("render-thresholds-v1") || "null"),
      );
    } catch {
      return normalizeThresholds(null);
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("render-thresholds-v1", JSON.stringify(thresholds));
    } catch {
      /* The calculator remains usable when storage is unavailable. */
    }
  }, [thresholds]);
  function openServiceSettings() {
    setSettingsOpen(true);
    setTab("strategy");
  }
  useEffect(() => {
    if (settingsOpen && tab === "strategy") {
      document
        .getElementById("manual-followup-settings")
        ?.scrollIntoView({ block: "start" });
    }
  }, [settingsOpen, tab]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", tab);
    window.history.replaceState(null, "", url);
  }, [tab]);
  const [servicePolicy, setServicePolicy] = useState<ServicePolicy>(() => {
    try {
      return normalizeServicePolicy(
        JSON.parse(localStorage.getItem("render-service-policy-v2") || "null"),
      );
    } catch {
      return normalizeServicePolicy(null);
    }
  });
  const [search, setSearch] = useState(""),
    [team, setTeam] = useState(""),
    [status, setStatus] = useState<HistoryFilters["outcome"]>(""),
    [page, setPage] = useState(1);
  const [scope, setScope] = useState<"all" | "hits" | "misses">("all");
  const [queueFocus, setQueueFocus] = useState(0);
  const [selected, setSelected] = useState<Job | null>(null);
  const [reviewed, setReviewed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("render-review-v1") || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    document.title = "RenderCare · 渲染提交预检";
    fetch("/api/render/report")
      .then(async (r) => {
        if (!r.ok) throw new Error("无法读取分析结果，请确认服务已启动。");
        return r.json();
      })
      .then((r: Report) => setReport(r))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setPage(1);
  }, [search, team, status, scope, thresholds, queueBasis]);
  useEffect(() => {
    if (queueFocus && tab === "queue") {
      document
        .getElementById("historical-tasks")
        ?.scrollIntoView({ block: "start" });
    }
  }, [queueFocus, tab]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "render-service-policy-v2",
        JSON.stringify(servicePolicy),
      );
    } catch {
      // The current session remains usable when browser storage is unavailable.
    }
  }, [servicePolicy]);
  const strategyRows = useMemo(
    () =>
      (report?.rows || []).map((row) => {
        const threshold = thresholds[row.team_id];
        const intercept = row.lagMinutes >= threshold;
        return {
          ...row,
          intercept,
          reason: syncReason(intercept, row.lagMinutes, threshold),
        };
      }),
    [report, thresholds],
  );
  const queue = useMemo(
    () =>
      selectHistoricalTasks(
        queueBasis === "original"
          ? (report?.rows || []).map((row) => ({
              ...row,
              reason: syncReason(row.intercept, row.lagMinutes, 20),
            }))
          : strategyRows,
        { scope, team, outcome: status, query: search },
      ),
    [report, strategyRows, queueBasis, scope, team, status, search],
  );
  function showHistory(
    filters: HistoryFilters = {},
    basis: "current" | "original" = queueBasis,
  ) {
    setQueueBasis(basis);
    setScope(filters.scope || "all");
    setTeam(filters.team || "");
    setStatus(filters.outcome || "");
    setSearch("");
    setPage(1);
    setTab("queue");
    setQueueFocus((value) => value + 1);
  }
  function mark(id: string) {
    const next = reviewed.includes(id)
      ? reviewed.filter((x) => x !== id)
      : [...reviewed, id];
    setReviewed(next);
    try {
      localStorage.setItem("render-review-v1", JSON.stringify(next));
    } catch {
      /* Local notes are optional. */
    }
  }
  if (error || !report)
    return (
      <div className="render-loading">
        <ShieldCheck size={30} />
        <h1>RenderCare</h1>
        <p>{error || "正在核对正式任务数据…"}</p>
        {error && <button onClick={() => location.reload()}>重试</button>}
      </div>
    );
  const m = report.metrics;
  return (
    <div className="render-app">
      <aside className="rc-sidebar">
        <a className="rc-brand" href="/">
          <span>
            <Layers3 size={23} />
          </span>
          RenderCare
        </a>
        <div className="rc-workspace">
          <span className="rc-dot" />
          渲染可靠性工作区<small>设计协作 / 提交预检</small>
        </div>
        <div className="rc-nav-label">工作空间</div>
        <button
          className={tab === "strategy" ? "active" : ""}
          onClick={() => {
            setTab("strategy");
            window.scrollTo({ top: 0 });
          }}
        >
          <SlidersHorizontal size={18} />
          策略测算
        </button>
        <button
          className={tab === "queue" ? "active" : ""}
          onClick={() => {
            setTab("queue");
            window.scrollTo({ top: 0 });
          }}
        >
          <ShieldCheck size={18} />
          任务明细<span>{m.source.uniqueJobs}</span>
        </button>
        <button
          className={tab === "evidence" ? "active" : ""}
          onClick={() => {
            setTab("evidence");
            window.scrollTo({ top: 0 });
          }}
        >
          <FileCheck2 size={18} />
          数据依据
        </button>
        <div className="rc-sidebar-note">
          <Clock3 size={23} />
          <strong>历史测算</strong>
          <small>用于比较方案，尚未连接线上队列。</small>
        </div>
      </aside>
      <main className="rc-main">
        <header className="rc-top">
          <span>
            工作空间 <b>/</b>{" "}
            {tab === "strategy"
              ? "策略测算"
              : tab === "queue"
                ? "任务明细"
                : "数据依据"}
          </span>
          <span className="rc-source">
            <Database size={13} />
            题目数据 · 09.01—09.07
          </span>
        </header>
        <div className="rc-content">
          <div className="rc-page-heading">
            <div>
              <h1>
                {tab === "strategy"
                  ? "策略测算"
                  : tab === "queue"
                    ? "任务明细"
                    : "数据依据"}
              </h1>
              <p>
                {tab === "strategy"
                  ? "调节检查门槛，比较正确预警、多余检查和工时。"
                  : tab === "queue"
                    ? "按方案筛选任务，查看渲染结果与本机检查标记。"
                    : "查看 20 分钟对照方案的历史表现与计算依据。"}
              </p>
            </div>
          </div>
          {tab === "strategy" ? (
            <ThresholdStrategyPanel
              rows={report.rows}
              costs={m.costs}
              thresholds={thresholds}
              onThresholdsChange={(value) =>
                setThresholds(normalizeThresholds(value))
              }
              servicePolicy={servicePolicy}
              memory={memory}
              onMemoryChange={setMemory}
              serviceSettings={
                <ServicePolicyPanel
                  policy={servicePolicy}
                  onChange={setServicePolicy}
                />
              }
              settingsOpen={settingsOpen}
              onSettingsToggle={setSettingsOpen}
              onShowQueue={(filters) => showHistory(filters, "current")}
            />
          ) : tab === "queue" ? (
            <div className="rc-queue-focused">
              <div className="rc-history-summary">
                <button onClick={() => showHistory()}>
                  {m.source.uniqueJobs} 个历史任务
                </button>
                <button onClick={() => showHistory({ outcome: "success" })}>
                  渲染成功 <b>{m.outcomes.succeeded}</b>
                </button>
                <button onClick={() => showHistory({ outcome: "failure" })}>
                  渲染失败 <b>{m.outcomes.failed}</b>
                </button>
                <button onClick={() => showHistory({ outcome: "unknown" })}>
                  结果未知 <b>{m.outcomes.unknown}</b>
                </button>
              </div>
              <section className="rc-panel rc-queue" id="historical-tasks">
                <div className="rc-panel-heading">
                  <div>
                    <h2>
                      {scope === "hits"
                        ? status === "failure"
                          ? "正确预警"
                          : status === "success"
                            ? "多余检查"
                            : "已预警的任务"
                        : scope === "misses"
                          ? status === "failure"
                            ? "漏掉的失败"
                            : "未预警的任务"
                          : "全部历史任务"}{" "}
                      <span>{queue.length}</span>
                    </h2>
                    <p>按提交时间排序；检查标记只保存在本机。</p>
                  </div>
                  <button
                    className="rc-policy-link"
                    onClick={openServiceSettings}
                  >
                    人工跟进规则
                  </button>
                </div>
                <div className="rc-filters">
                  <select
                    aria-label="查看方案"
                    value={queueBasis}
                    onChange={(event) =>
                      setQueueBasis(
                        event.target.value as "current" | "original",
                      )
                    }
                  >
                    <option value="current">当前方案</option>
                    <option value="original">20 分钟对照方案</option>
                  </select>
                  <label className="rc-search">
                    <Search size={16} />
                    <input
                      aria-label="搜索任务"
                      placeholder="搜索任务编号、场景…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="任务数据范围"
                    value={scope}
                    onChange={(event) =>
                      setScope(event.target.value as "all" | "hits" | "misses")
                    }
                  >
                    <option value="all">全部历史任务</option>
                    <option value="hits">仅已预警</option>
                    <option value="misses">仅未预警</option>
                  </select>
                  <select
                    aria-label="团队筛选"
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                  >
                    <option value="">全部团队</option>
                    {m.byTeam.map((t) => (
                      <option key={t.name}>{t.name}</option>
                    ))}
                  </select>
                  <select
                    aria-label="历史结果筛选"
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as HistoryFilters["outcome"])
                    }
                  >
                    <option value="">全部历史结果</option>
                    <option value="failure">渲染失败</option>
                    <option value="success">渲染成功</option>
                    <option value="unknown">结果未知</option>
                  </select>
                </div>
                <div className="rc-table-wrap">
                  <table aria-label="历史渲染任务">
                    <thead>
                      <tr>
                        <th>任务 / 场景</th>
                        <th>团队</th>
                        <th>提交时间</th>
                        <th>同步间隔</th>
                        <th>
                          <details className="rc-resource-help">
                            <summary>
                              模型与显存 <Info size={13} aria-hidden="true" />
                            </summary>
                            <p>
                              按 CSV 原值显示。显存记录时间未知，仅供事后分析。
                            </p>
                          </details>
                        </th>
                        <th>历史结果</th>
                        <th>本机检查标记</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {queue.slice((page - 1) * 10, page * 10).map((r) => (
                        <tr key={r.job_id}>
                          <td>
                            <button
                              className="rc-job"
                              onClick={() => setSelected(r)}
                            >
                              #{r.job_id}
                            </button>
                            <small>{r.scene_type}</small>
                          </td>
                          <td>{r.team_id}</td>
                          <td>{date(r.created_at)}</td>
                          <td>
                            <span className="rc-age">{r.lagMinutes} 分钟</span>
                            <small>{r.intercept ? "已预警" : "未预警"}</small>
                          </td>
                          <td>
                            <div className="rc-resource-values">
                              <span>面数：{r.polygon_count || "—"}</span>
                              <span>
                                剩余显存：
                                {r.gpu_mem_free_mb
                                  ? `${r.gpu_mem_free_mb} MB`
                                  : "—"}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className={`rc-outcome ${r.outcome}`}>
                              {outcomeName[r.outcome]}
                            </span>
                          </td>
                          <td>
                            <button
                              className={`rc-review ${reviewed.includes(r.job_id) ? "done" : ""}`}
                              onClick={() => mark(r.job_id)}
                            >
                              {reviewed.includes(r.job_id) ? (
                                <>
                                  <Check size={13} />
                                  已标记检查
                                </>
                              ) : r.intercept ? (
                                "未标记检查"
                              ) : (
                                "未标记"
                              )}
                            </button>
                          </td>
                          <td>
                            <button
                              className="rc-icon-button"
                              aria-label={`查看任务 ${r.job_id}`}
                              onClick={() => setSelected(r)}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!queue.length && (
                        <tr>
                          <td colSpan={8}>没有符合筛选条件的任务。</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="rc-pagination">
                  <span>筛选后 {queue.length} 个任务 · 每页 10 条</span>
                  <div>
                    <button
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      上一页
                    </button>
                    <span>
                      {page} / {Math.max(1, Math.ceil(queue.length / 10))}
                    </span>
                    <button
                      disabled={page * 10 >= queue.length}
                      onClick={() => setPage(page + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <EvidencePanel
              metrics={m}
              rows={report.rows}
              memory={memory}
              onMemoryChange={setMemory}
              onShowQueue={(filters) => showHistory(filters, "original")}
            />
          )}
          <footer className="rc-footer">
            <span>
              RENDERCARE <b>/</b> 渲染提交预检
            </span>
            <span>仅使用题目数据 · 统计可复算 · 业务收益待实验验证</span>
          </footer>
        </div>
      </main>
      {selected && (
        <div className="rc-modal-backdrop" onClick={() => setSelected(null)}>
          <section className="rc-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="rc-close"
              aria-label="关闭详情"
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            <span className="rc-eyebrow">任务证据</span>
            <h2>
              #{selected.job_id} · {selected.scene_type}
            </h2>
            <p className="rc-detail-reason">{selected.reason}</p>
            <dl>
              {[
                ["团队", selected.team_id],
                ["提交时间", selected.created_at],
                ["同步完成时间", selected.asset_synced_at],
                ["剩余显存（原始 MB；采集时点未知）", selected.gpu_mem_free_mb],
                ["多边形面数（原始值）", selected.polygon_count],
                ["历史结果", outcomeName[selected.outcome]],
                ["源数据记录序号（不含表头）", selected.sourceRows.join(", ")],
              ].map(([k, value]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="rc-feature-timing rc-detail-timing">
              <strong>显存记录时间不明，可能用了事后信息</strong>
              CSV
              未记录它何时被采集、何时可被系统使用。若来自运行中或失败后，不能用于提交前预测。
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
