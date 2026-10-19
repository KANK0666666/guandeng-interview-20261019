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
type Metrics = {
  source: {
    rawRows: number;
    uniqueJobs: number;
    duplicatesRemoved: number;
    duplicateJobs: number;
    sha256: string;
  };
  outcomes: Counts;
  costs: { crash: number; intercept: number };
  selectedRule: { label: string; lagMinutes: number };
  all: Policy;
  train: Policy;
  validation: Policy;
  lagGroups: ({ name: string } & Counts)[];
  candidates: { id: string; label: string; train: Policy }[];
  baselines: { id: string; label: string; all: Policy; validation: Policy }[];
  byDay: ({ name: string } & Counts)[];
  byTeam: ({ name: string } & Counts)[];
  split: { caveat: string };
};
type Report = { metrics: Metrics; rows: Job[] };
type CheckResult = {
  decision: "intercept" | "pass" | "review";
  lagMinutes: number | null;
  reason: string;
};
const n = (v: number) =>
  v.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
const pct = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;
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
  const [tab, setTab] = useState<"queue" | "evidence">("queue");
  const [search, setSearch] = useState(""),
    [team, setTeam] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1);
  const [effect, setEffect] = useState(50),
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
  }, [search, team, status]);
  const queue = useMemo(
    () =>
      report?.rows.filter(
        (r) =>
          r.intercept &&
          (!team || r.team_id === team) &&
          (!status || r.outcome === status) &&
          (!search || `${r.job_id} ${r.scene_type}`.includes(search)),
      ) || [],
    [report, search, team, status],
  );
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
          预检工作台<span>{p.intercepted}</span>
        </button>
        <button
          className={tab === "evidence" ? "active" : ""}
          onClick={() => setTab("evidence")}
        >
          <FileCheck2 size={18} />
          回放证据
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
            工作空间 <b>/</b> {tab === "queue" ? "预检工作台" : "回放证据"}
          </span>
          <span className="rc-source">
            <Database size={13} />
            题目发放数据 · 09.01—09.07
          </span>
        </header>
        <div className="rc-content">
          <div className="rc-page-heading">
            <div>
              <span className="rc-eyebrow">RENDER RELIABILITY</span>
              <h1>
                {tab === "queue"
                  ? "把返工留在提交之前"
                  : "每一个判断，都能回到数据"}
                <span>.</span>
              </h1>
              <p>
                {tab === "queue"
                  ? "优先核查资产同步间隔较长的任务，给设计师一条明确的处理路径。"
                  : "按唯一任务核算收益与成本，保留误拦、未知结果和适用边界。"}
              </p>
            </div>
            <a className="rc-primary" href="/api/render/queue.csv">
              <ArrowDownToLine size={16} />
              导出全部预检清单
            </a>
          </div>
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
            />
            <Kpi
              label="已知结果的失败率"
              value={pct(m.outcomes.failureRate)}
              detail={`${m.outcomes.failed} / ${m.outcomes.known} · 另有 ${m.outcomes.unknown} 个未回传`}
            />
            <Kpi
              label="规则命中的历史失败"
              value={`${p.caughtFailures} / ${m.outcomes.failed}`}
              detail={`覆盖 ${pct(p.recall)} 的已知失败`}
            />
            <Kpi
              label="50% 有效情景净节省"
              value={`${n(p.netHoursAtHalfEffect)} 工时`}
              detail="扣除所有拦截成本 · 尚非实测收益"
              accent
            />
          </section>
          {tab === "queue" ? (
            <>
              <div className="rc-two-col">
                <section className="rc-panel rc-checker">
                  <div className="rc-panel-heading">
                    <div>
                      <h2>
                        <ShieldCheck size={18} />
                        提交前预检
                      </h2>
                      <p>仅使用提交前可获得的两个时间，不读取最终结果。</p>
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
              <section className="rc-panel rc-queue">
                <div className="rc-panel-heading">
                  <div>
                    <h2>
                      待核查任务 <span>{queue.length}</span>
                    </h2>
                    <p>
                      历史回放中触发规则的任务；“已核查”仅为本机标记，不表示资产已修复。
                    </p>
                  </div>
                  <span className="rc-small-label">按提交时间排序</span>
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
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">全部历史结果</option>
                    <option value="failure">失败</option>
                    <option value="success">成功（误拦）</option>
                    <option value="unknown">未回传</option>
                  </select>
                </div>
                <div className="rc-table-wrap">
                  <table>
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
                          <td>{r.team_id}</td>
                          <td>{date(r.created_at)}</td>
                          <td>
                            <span className="rc-age">{r.lagMinutes} 分钟</span>
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
                              ) : (
                                "待核查"
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
                      <p>设 α 为核查/同步后真正避免原有失败的比例。</p>
                    </div>
                  </div>
                  <label className="rc-slider-label">
                    假设有效比例 <strong>{effect}%</strong>
                    <input
                      aria-label="假设有效比例"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={effect}
                      onChange={(e) => setEffect(Number(e.target.value))}
                    />
                  </label>
                  <div className="rc-scenario">
                    <span>全量历史净收益</span>
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
                      日净收益选择。已探索过全量分布，因此后两天不是严格盲测。
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
                          <td>{b.label}</td>
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
                ["剩余显存（原始 MB）", selected.gpu_mem_free_mb],
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
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className={`rc-kpi ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
