import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Clock3,
  Database,
  FileCheck2,
  Layers3,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import ServicePolicyPanel from "./ServicePolicyPanel";
import RuleOutcomeMatrix from "./RuleOutcomeMatrix";
import StrategyCostPanel from "./StrategyCostPanel";
import {
  normalizeServicePolicy,
  selectHistoricalTasks,
  teamWeight,
  type HistoryFilters,
  type ServicePolicy,
} from "./service-policy.mjs";
import "./render.css";

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
type Job = {
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
type Metrics = {
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
type CheckResult = {
  decision: "intercept" | "pass" | "review";
  lagMinutes: number | null;
  reason: string;
};
const n = (v: number) =>
  v.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;
const pct2 = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(2)}%`;
const localInput = (v: string) =>
  new Date(Date.parse(v) + 8 * 3600000).toISOString().slice(0, 16);
const date = (v: string) =>
  new Date(v).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const outcomeName = { success: "成功", failure: "失败", unknown: "未回传" };

export default function RenderApp() {
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState("");
  const [tab, setTab] = useState<"queue" | "evidence" | "service">("queue");
  const [servicePolicy, setServicePolicy] = useState<ServicePolicy>(() => {
    try {
      return normalizeServicePolicy(
        JSON.parse(localStorage.getItem("render-service-policy-v1") || "null"),
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
  const [effect, setEffect] = useState(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("render-effectiveness-v1") || "null",
        );
        if (
          typeof saved === "number" &&
          Number.isFinite(saved) &&
          saved >= 0 &&
          saved <= 100
        )
          return saved;
      } catch {
        /* Use the labeled default scenario if no valid setting exists. */
      }
      return 50;
    }),
    [selected, setSelected] = useState<Job | null>(null);
  const [created, setCreated] = useState(""),
    [synced, setSynced] = useState(""),
    [checkResult, setCheckResult] = useState<CheckResult | null>(null),
    [checking, setChecking] = useState(false);
  const [reviewed, setReviewed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("render-review-v1") || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("render-effectiveness-v1", JSON.stringify(effect));
    } catch {
      /* Keep the live calculation available without persistent storage. */
    }
  }, [effect]);
  useEffect(() => {
    document.title = "RenderCare · 渲染提交预检";
    fetch("/api/render/report")
      .then(async (r) => {
        if (!r.ok) throw new Error("无法读取分析结果，请确认服务已启动。");
        return r.json();
      })
      .then((r: Report) => {
        setReport(r);
        const first = r.rows.find((j) => j.intercept)!;
        setCreated(localInput(first.created_at));
        setSynced(localInput(first.asset_synced_at));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setPage(1);
  }, [search, team, status, scope, servicePolicy]);
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
        "render-service-policy-v1",
        JSON.stringify(servicePolicy),
      );
    } catch {
      // The current session remains usable when browser storage is unavailable.
    }
  }, [servicePolicy]);
  const queue = useMemo(
    () =>
      selectHistoricalTasks(report?.rows || [], servicePolicy, {
        scope,
        team,
        outcome: status,
        query: search,
      }),
    [report, search, team, status, scope, servicePolicy],
  );
  function showHistory(filters: HistoryFilters = {}) {
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
  async function runCheck() {
    setChecking(true);
    setCheckResult(null);
    try {
      const r = await fetch("/api/render/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          created_at: created ? `${created}:00+08:00` : "",
          asset_synced_at: synced ? `${synced}:00+08:00` : "",
        }),
      });
      if (!r.ok) throw new Error("预检请求失败");
      setCheckResult(await r.json());
    } catch (e) {
      setCheckResult({
        decision: "review",
        lagMinutes: null,
        reason: String(e),
      });
    } finally {
      setChecking(false);
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
  const m = report.metrics,
    p = m.all,
    v = m.validation;
  const net =
    (p.caughtFailures * m.costs.crash * effect) / 100 - p.interceptCost;
  const vnet =
    (v.caughtFailures * m.costs.crash * effect) / 100 - v.interceptCost;
  const scenarioBest = [...m.candidates].sort((a, b) => {
    const difference =
      ((b.train.caughtFailures - a.train.caughtFailures) *
        m.costs.crash *
        effect) /
        100 -
      (b.train.interceptCost - a.train.interceptCost);
    return Math.abs(difference) > 1e-9
      ? difference
      : a.train.intercepted - b.train.intercepted;
  })[0];
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
          className={tab === "queue" ? "active" : ""}
          onClick={() => setTab("queue")}
        >
          <ShieldCheck size={18} />
          任务结果与预检<span>{m.source.uniqueJobs}</span>
        </button>
        <button
          className={tab === "evidence" ? "active" : ""}
          onClick={() => setTab("evidence")}
        >
          <FileCheck2 size={18} />
          回放证据
        </button>
        <button
          className={tab === "service" ? "active" : ""}
          onClick={() => {
            setTab("service");
            window.scrollTo({ top: 0 });
          }}
        >
          <SlidersHorizontal size={18} />
          业务保障与权重
        </button>
        <div className="rc-sidebar-note">
          <Clock3 size={23} />
          <strong>先检查，再提交</strong>
          <p>核对云端资产版本，减少失败后的重复定位。</p>
          <small>原型采用历史任务回放，尚未连接线上渲染队列。</small>
        </div>
        <div className="rc-user">
          <span>设</span>
          <div>
            三维设计师<small>本地单人工作区</small>
          </div>
        </div>
      </aside>
      <main className="rc-main">
        <header className="rc-top">
          <span>
            工作空间 <b>/</b>{" "}
            {tab === "queue"
              ? "任务结果与预检"
              : tab === "service"
                ? "业务保障与权重"
                : "回放证据"}
          </span>
          <span className="rc-source">
            <Database size={13} />
            {tab === "service"
              ? "业务假设与服务规则演示"
              : "题目发放数据 · 09.01—09.07"}
          </span>
        </header>
        <div className="rc-content">
          <div className="rc-page-heading">
            <div>
              <span className="rc-eyebrow">RENDER RELIABILITY</span>
              <h1>
                {tab === "queue"
                  ? "先看任务结果，再安排核查"
                  : tab === "service"
                    ? "重要项目，提前有人跟进"
                    : "每一个判断，都能回到数据"}
                <span>.</span>
              </h1>
              <p>
                {tab === "queue"
                  ? "提前识别失败风险，投入人工定位与处理问题，验证是否减少失败和返工。"
                  : tab === "service"
                    ? "按业务重要性安排关注顺序，用独立的无结果时限保障 KA 与定制项目。"
                    : "按唯一任务核算收益与成本，保留误拦、未知结果和适用边界。"}
              </p>
            </div>
            <a className="rc-primary" href="/api/render/queue.csv">
              <ArrowDownToLine size={16} />
              导出全部预检清单
            </a>
          </div>
          <details className="rc-feature-timing" data-testid="feature-timing">
            <summary>{m.featureTiming.gpu_mem_free_mb.label}</summary>
            <p>{m.featureTiming.gpu_mem_free_mb.explanation}</p>
            <p>
              示意（非本题记录）：12:00 提交，12:30 才采到显存不足。12:30
              可以触发运行中处理，但不能说 12:00 就已预知。
            </p>
            <small>{m.featureTiming.gpu_mem_free_mb.requiredEvidence}</small>
          </details>
          {tab !== "service" && (
            <>
              <div className="rc-notice">
                <ShieldCheck size={17} />
                <span>
                  <strong>
                    当前候选规则：同步间隔 ≥ {m.selectedRule.lagMinutes} 分钟
                  </strong>
                  　先提示设计师核对版本与同步状态；不直接判定故障原因。
                </span>
                <span className="rc-pill">历史回放</span>
              </div>
              <section className="rc-kpis">
                <Kpi
                  label="纳入分析的唯一任务"
                  value={n(m.source.uniqueJobs)}
                  detail={`原始 ${m.source.rawRows} 行 · 合并 ${m.source.duplicatesRemoved} 行重复`}
                  onClick={() => showHistory()}
                />
                <Kpi
                  label="历史渲染成功"
                  value={`${n(m.outcomes.succeeded)} 个`}
                  detail="已返回成功结果 · 点击查看原始任务"
                  onClick={() => showHistory({ outcome: "success" })}
                  accent
                />
                <Kpi
                  label="历史渲染失败"
                  value={`${n(m.outcomes.failed)} 个`}
                  detail={`已知结果失败率 ${pct(m.outcomes.failureRate)} · 点击查看`}
                  onClick={() => showHistory({ outcome: "failure" })}
                />
                <Kpi
                  label="历史结果未回传"
                  value={`${n(m.outcomes.unknown)} 个`}
                  detail="不能当作成功或失败 · 点击查看原始任务"
                  onClick={() => showHistory({ outcome: "unknown" })}
                />
              </section>
            </>
          )}
          <StrategyCostPanel
            groups={m.byTeam}
            effect={effect}
            costs={m.costs}
          />
          {tab === "service" ? (
            <ServicePolicyPanel
              policy={servicePolicy}
              onChange={setServicePolicy}
              teams={m.byTeam}
              effect={effect}
              onEffectChange={setEffect}
              costs={m.costs}
              onShowQueue={showHistory}
            />
          ) : tab === "queue" ? (
            <>
              <RuleOutcomeMatrix
                groups={m.byTeam}
                effect={effect}
                onEffectChange={setEffect}
                costs={m.costs}
                onShowQueue={showHistory}
              />
              <div className="rc-two-col">
                <section className="rc-panel rc-checker">
                  <div className="rc-panel-heading">
                    <div>
                      <h2>
                        <ShieldCheck size={18} />
                        提交前预检
                      </h2>
                      <p>
                        仅用两个时间；上线需确认是提交时快照，不读取最终结果或显存。
                      </p>
                    </div>
                    <span className="rc-small-label">北京时间 UTC+8</span>
                  </div>
                  <div className="rc-check-inputs">
                    <label>
                      准备提交时间
                      <input
                        aria-label="准备提交时间"
                        type="datetime-local"
                        value={created}
                        onChange={(e) => {
                          setCreated(e.target.value);
                          setCheckResult(null);
                        }}
                      />
                    </label>
                    <label>
                      资产最后同步完成时间
                      <input
                        aria-label="资产最后同步完成时间"
                        type="datetime-local"
                        value={synced}
                        onChange={(e) => {
                          setSynced(e.target.value);
                          setCheckResult(null);
                        }}
                      />
                    </label>
                  </div>
                  <div className="rc-check-bottom">
                    <small>
                      初始值来自原始任务，可修改试算；输入不会写入分析数据。
                    </small>
                    <button
                      className="rc-primary"
                      disabled={checking}
                      onClick={runCheck}
                    >
                      {checking ? "检查中…" : "检查再提交"}
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                  {checkResult && (
                    <div className={`rc-check-result ${checkResult.decision}`}>
                      <strong>
                        {checkResult.decision === "intercept"
                          ? "建议先核对资产"
                          : checkResult.decision === "pass"
                            ? "未触发同步规则"
                            : "需要核对输入"}
                      </strong>
                      <p>{checkResult.reason}</p>
                    </div>
                  )}
                </section>
                <section className="rc-panel rc-action">
                  <span className="rc-eyebrow">建议处理步骤</span>
                  <h2>一次核查，避免盲目重试</h2>
                  <ol>
                    <li>
                      <span>01</span>
                      <div>
                        <strong>核对版本</strong>
                        <p>确认云端缓存对应当前场景版本。</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <strong>必要时重新同步</strong>
                        <p>等同步完成再预检，每个任务只触发一次人工核查。</p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <strong>记录结果</strong>
                        <p>跟踪是否仍失败及真实耗时，验证规则是否有用。</p>
                      </div>
                    </li>
                  </ol>
                </section>
              </div>
              <section className="rc-panel rc-queue" id="historical-tasks">
                <div className="rc-panel-heading">
                  <div>
                    <h2>
                      {scope === "hits"
                        ? "同步规则命中任务"
                        : scope === "misses"
                          ? "未命中同步规则的任务"
                          : "全部历史任务"}{" "}
                      <span>{queue.length}</span>
                    </h2>
                    <p>
                      成功、失败、未回传来自原始数据；权重不改变历史结果。“已核查”仅为本机标记，不表示已修复。
                    </p>
                  </div>
                  <button
                    className="rc-policy-link"
                    onClick={() => setTab("service")}
                  >
                    按业务权重、提交时间排序 · 调整权重
                  </button>
                </div>
                <div className="rc-filters">
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
                    <option value="hits">仅同步规则命中</option>
                    <option value="misses">仅未命中同步规则</option>
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
                    <option value="failure">失败</option>
                    <option value="success">成功</option>
                    <option value="unknown">未回传</option>
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
                        <th>历史结果</th>
                        <th>核查状态</th>
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
                          <td>
                            {r.team_id}
                            <small>
                              关注权重 {teamWeight(r.team_id, servicePolicy)}×
                            </small>
                          </td>
                          <td>{date(r.created_at)}</td>
                          <td>
                            <span className="rc-age">{r.lagMinutes} 分钟</span>
                            <small>
                              {r.intercept ? "命中同步规则" : "未命中同步规则"}
                            </small>
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
                                  已核查
                                </>
                              ) : r.intercept ? (
                                "待核查"
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
                          <td colSpan={7}>没有符合筛选条件的任务。</td>
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
            </>
          ) : (
            <>
              <div className="rc-two-col">
                <section className="rc-panel">
                  <div className="rc-panel-heading">
                    <div>
                      <h2>
                        <SlidersHorizontal size={18} />
                        拦截不一定消除失败
                      </h2>
                      <p>
                        设 α
                        为核查/同步后真正避免原有失败的比例；提醒是否被执行也影响这个比例。
                      </p>
                    </div>
                  </div>
                  <label className="rc-slider-label">
                    假设有效比例 <strong>{effect}%</strong>
                    <input
                      aria-label="假设有效比例"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={effect}
                      onChange={(e) => setEffect(Number(e.target.value))}
                    />
                  </label>
                  <div className="rc-scenario">
                    <span>原同步规则基准净工时</span>
                    <strong className={net < 0 ? "negative" : ""}>
                      {n(net)} <small>工时</small>
                    </strong>
                    <p>
                      {p.caughtFailures} × 120 × {effect}% − {p.intercepted} ×
                      20
                    </p>
                  </div>
                  <div className="rc-scenario-foot">
                    后两天时间复核：{n(vnet)} 工时 · 全量盈亏平衡 α ≈{" "}
                    {pct(p.breakEvenEffectiveness)}
                  </div>
                </section>
                <section className="rc-panel">
                  <div className="rc-panel-heading">
                    <div>
                      <h2>命中不是精准预测</h2>
                      <p>触发预检的 {p.intercepted} 个任务中</p>
                    </div>
                  </div>
                  <div className="rc-stack">
                    <span
                      style={{
                        width: `${(p.caughtFailures / p.intercepted) * 100}%`,
                      }}
                    />
                    <span
                      style={{
                        width: `${(p.falseInterceptions / p.intercepted) * 100}%`,
                      }}
                    />
                    <span
                      style={{
                        width: `${(p.interceptedUnknown / p.intercepted) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="rc-outcome-list">
                    <div>
                      <i className="failure" />
                      历史失败<strong>{p.caughtFailures}</strong>
                    </div>
                    <div>
                      <i className="success" />
                      历史成功，属于误拦<strong>{p.falseInterceptions}</strong>
                    </div>
                    <div>
                      <i className="unknown" />
                      结果未知，收益按 0 计算
                      <strong>{p.interceptedUnknown}</strong>
                    </div>
                  </div>
                  <p className="rc-fineprint">
                    所有 {p.intercepted} 次拦截均扣 20 工时；另有{" "}
                    {p.missedFailures}{" "}
                    个已知失败未被规则覆盖。没有把未知状态算成成功。
                  </p>
                </section>
              </div>
              <section className="rc-panel">
                <div className="rc-panel-heading">
                  <div>
                    <h2>先选规则，再做时间复核</h2>
                    <p>
                      候选共 {m.candidates.length} 项，按 9 月 1—5
                      日净收益选择。已探索过全量分布，因此后两天不是严格盲测。含显存候选的采集时点未知，仅为事后比较。
                    </p>
                  </div>
                </div>
                <div className="rc-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>范围</th>
                        <th>任务</th>
                        <th>拦截</th>
                        <th>命中失败</th>
                        <th>误拦成功</th>
                        <th>未知</th>
                        <th>100% 情景净工时</th>
                        <th>50% 情景净工时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["开发期 09.01—09.05", m.train],
                        ["时间复核 09.06—09.07", m.validation],
                        ["全部历史", m.all],
                      ].map(([label, data]) => {
                        const x = data as Policy;
                        return (
                          <tr key={String(label)}>
                            <td>{String(label)}</td>
                            <td>{x.jobs}</td>
                            <td>{x.intercepted}</td>
                            <td>{x.caughtFailures}</td>
                            <td>{x.falseInterceptions}</td>
                            <td>{x.interceptedUnknown}</td>
                            <td>{n(x.netHoursAtFullEffect)}</td>
                            <td>{n(x.netHoursAtHalfEffect)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="rc-panel">
                <div className="rc-panel-heading">
                  <div>
                    <h2>有效比例变化时，最优候选也会变化</h2>
                    <p>
                      开发期 35 项候选的完整区间比较。所有候选暂用同一个
                      α；不代表未来最优或真实干预效果。
                    </p>
                  </div>
                </div>
                <div className="rc-notice">
                  当前 {effect}% 情景下，开发期最优候选为{" "}
                  <strong>{scenarioBest.label}</strong>。 预检仍采用初版固定的
                  20 分钟规则。
                </div>
                <div className="rc-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>α 区间内部</th>
                        <th>开发期最优候选</th>
                        <th>拦截数</th>
                        <th>命中失败</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.ruleSensitivity.segments.map((segment) => (
                        <tr key={segment.preferredRuleId}>
                          <td>
                            {pct2(segment.from.value)}—{pct2(segment.to.value)}
                          </td>
                          <td>{segment.label}</td>
                          <td>{segment.intercepted}</td>
                          <td>{segment.caughtFailures}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="rc-fineprint">
                  精确切点：
                  {m.ruleSensitivity.boundaries
                    .filter((b) => b.ruleIds.length > 1)
                    .map(
                      (b) =>
                        `${b.effectiveness.numerator}/${b.effectiveness.denominator}（约 ${pct2(b.effectiveness.value)}），平局取“${b.label}”`,
                    )
                    .join("；")}
                  。端点附近以精确分数为准，不能把盈亏平衡点当成最优规则的切换点。
                </p>
              </section>
              <section className="rc-panel">
                <div className="rc-panel-heading">
                  <div>
                    <h2>统一成本下的团队工时情景</h2>
                    <p>
                      全量历史、固定同步间隔 ≥20
                      分钟规则。失败率只计已知结果，成本计入全部命中任务。此表不用于决定客户重要性或取消必要检查。
                    </p>
                  </div>
                </div>
                <div className="rc-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>团队</th>
                        <th>&lt;20 分钟失败率</th>
                        <th>≥20 分钟失败率</th>
                        <th>命中 / 其中未知</th>
                        <th>α={effect}% 净工时</th>
                        <th>盈亏平衡 α</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.byTeam.map((group) => {
                        const benefit =
                          (group.policy.caughtFailures *
                            m.costs.crash *
                            effect) /
                            100 -
                          group.policy.interceptCost;
                        return (
                          <tr key={group.name}>
                            <td>{group.name}</td>
                            <td>
                              {pct2(group.below.failureRate)}
                              <small>
                                {group.below.failed} / {group.below.known}
                              </small>
                            </td>
                            <td>
                              {pct2(group.above.failureRate)}
                              <small>
                                {group.above.failed} / {group.above.known}
                              </small>
                            </td>
                            <td>
                              {group.policy.intercepted} /{" "}
                              {group.policy.interceptedUnknown}
                            </td>
                            <td className={benefit < 0 ? "rc-negative" : ""}>
                              {n(benefit)}
                            </td>
                            <td>{pct2(group.policy.breakEvenEffectiveness)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="rc-fineprint">
                  海外定制组命中 69 个任务，含 1 个未知；50% 情景净损失 600
                  工时，盈亏点约
                  88.46%。这是减少渲染失败的情景账，未计入交付保障、新功能验证和客户额外投入，不能据此削减重点项目服务。业务权重和无结果核查另见“业务保障与权重”。
                </p>
              </section>
              <section className="rc-panel">
                <div className="rc-panel-heading">
                  <div>
                    <h2>分层之后，关联是否仍然存在</h2>
                    <p>
                      分别比较每个分组内的 ≥20 分钟与 &lt;20
                      分钟已知结果失败率。
                    </p>
                  </div>
                </div>
                <div className="rc-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>分层维度</th>
                        <th>可比较分组</th>
                        <th>高同步间隔失败率更高的分组</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.stratification.groups.map((group) => (
                        <tr key={group.dimension}>
                          <td>{group.dimension}</td>
                          <td>
                            {group.comparable} / {group.total}
                          </td>
                          <td>
                            {group.positive} / {group.comparable}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="rc-fineprint">{m.stratification.caveat}</p>
              </section>
              <div className="rc-two-col">
                <section className="rc-panel">
                  <div className="rc-panel-heading">
                    <div>
                      <h2>同步间隔与失败的关联</h2>
                      <p>失败率仅以已回传结果作为分母。</p>
                    </div>
                  </div>
                  {m.lagGroups.map((g) => (
                    <div className="rc-rate-row" key={g.name}>
                      <div>
                        <strong>{g.name}</strong>
                        <span>
                          {g.failed} / {g.known} · {pct(g.failureRate)}
                        </span>
                      </div>
                      <div className="rc-rate-track">
                        <span
                          style={{ width: `${(g.failureRate || 0) * 100}%` }}
                        />
                      </div>
                      <small>另有 {g.unknown} 个未回传任务</small>
                    </div>
                  ))}
                </section>
                <section className="rc-panel">
                  <div className="rc-panel-heading">
                    <div>
                      <h2>为什么不全部拦截</h2>
                      <p>全量历史，α = 100% 的同一计量口径。</p>
                    </div>
                  </div>
                  <table className="rc-baselines">
                    <thead>
                      <tr>
                        <th>策略</th>
                        <th>拦截数</th>
                        <th>净工时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.baselines.map((b) => (
                        <tr key={b.id}>
                          <td>
                            {b.label}
                            {b.id.startsWith("mem-") && (
                              <small className="rc-timing-label">
                                时点未知 · 仅事后比较
                              </small>
                            )}
                          </td>
                          <td>{b.all.intercepted}</td>
                          <td>{n(b.all.netHoursAtFullEffect)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td>同步间隔 ≥ 20 分钟</td>
                        <td>{p.intercepted}</td>
                        <td>{n(p.netHoursAtFullEffect)}</td>
                      </tr>
                    </tbody>
                  </table>
                </section>
              </div>
              <section className="rc-panel rc-limits">
                <h2>下一步怎样证明真的有用</h2>
                <p>
                  先影子运行记录预检命中；再对命中任务随机分配“提醒核查”与“原流程”，按唯一任务比较实际返工工时、排队延迟、首次成功率与重复拦截次数。记录资产版本、失败原因、修复动作和最终回传，只有实际避免失败比例超过约{" "}
                  {pct(p.breakEvenEffectiveness)}
                  ，本题成本假设下才可能实现正净收益。
                </p>
                <p>
                  最后同步完成时间不等于资产变更时间。这里能确认的是关联，尚不能确认根因；没有更长的对照窗口，也无法证明近期失败频度上升。显存与面数沿用原数据单位，不推测倍率。
                </p>
                <p>
                  当前按题目每次 20
                  工时记账，不能仅因界面是提醒就自行降低成本。上线前需确认同步时间是否为提交时快照，测量提醒响应、核查耗时与实际避免失败的比例；若任务共享资产，需要考虑按资产或团队分组实验。
                </p>
                <small>来源 SHA-256：{m.source.sha256}</small>
              </section>
            </>
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
              <strong>显存可能含未来信息</strong>
              CSV
              未记录它何时被采集、何时可被系统使用。若来自运行中或失败后，不能用于提交前预测；“带入预检”仅带入两个时间。
            </p>
            <button
              className="rc-primary"
              onClick={() => {
                setCreated(localInput(selected.created_at));
                setSynced(localInput(selected.asset_synced_at));
                setCheckResult(null);
                setSelected(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <RefreshCw size={16} />
              带入预检
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function Kpi({
  label,
  value,
  detail,
  accent = false,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`rc-kpi ${accent ? "accent" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </Tag>
  );
}
