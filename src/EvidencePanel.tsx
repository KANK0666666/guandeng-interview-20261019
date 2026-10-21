import { useMemo } from "react";
import { compactNet, netText } from "./presentation.mjs";
import RuleOutcomeMatrix from "./RuleOutcomeMatrix";
import { calculateMemoryCandidate } from "./threshold-strategy.mjs";
import type { Metrics, Job } from "./RenderApp";
import type { HistoryFilters } from "./service-policy.mjs";
const n = (v: number) =>
  v.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;
const candidateName = (label: string) =>
  label.replaceAll("不拦截", "不检查").replaceAll("全部拦截", "全部检查");
type Policy = Metrics["all"];
type Props = {
  metrics: Metrics;
  rows: Job[];
  memory: number;
  onMemoryChange: (value: number) => void;
  onShowQueue: (filters?: HistoryFilters) => void;
};
export default function EvidencePanel({
  metrics: m,
  rows,
  memory,
  onMemoryChange: setMemory,
  onShowQueue,
}: Props) {
  const p = m.all;
  const gpu = useMemo(
    () => calculateMemoryCandidate(rows, memory, m.costs),
    [rows, memory, m.costs],
  );
  return (
    <div className="rc-evidence-focused">
      <p className="rc-context-line">
        {m.source.uniqueJobs} 个去重任务 · 20 分钟对照方案：各组同步间隔 ≥{" "}
        {m.selectedRule.lagMinutes} 分钟
      </p>
      <section className="rc-panel">
        <div className="rc-panel-heading">
          <div>
            <h2>同步间隔与失败率</h2>
            <p>仅统计已知结果；关联不能单独证明故障原因。</p>
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
                style={{
                  width: `${(g.failureRate || 0) * 100}%`,
                }}
              />
            </div>
            <small>另有 {g.unknown} 个结果未知的任务</small>
          </div>
        ))}
      </section>
      <details className="rc-panel rc-disclosure">
        <summary>
          <strong>20 分钟对照方案的历史测算</strong>
          <span>结果分布、工时账、时间复核</span>
        </summary>
        <div className="rc-disclosure-body">
          <RuleOutcomeMatrix
            groups={m.byTeam}
            costs={m.costs}
            onShowQueue={onShowQueue}
            compact
          />
          <section className="rc-panel">
            <div className="rc-panel-heading">
              <div>
                <h2>按时间复核</h2>
                <p>
                  候选共 {m.candidates.length} 项，按 9 月 1—5
                  日净节约工时选择。已探索过全量分布，因此后两天不是严格盲测。含显存候选的采集时点未知，仅为事后分析。
                </p>
              </div>
            </div>
            <div className="rc-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>范围</th>
                    <th>任务</th>
                    <th>检查次数</th>
                    <th className="rc-correct">正确预警</th>
                    <th className="rc-extra">多余检查</th>
                    <th>结果未知</th>
                    <th>净节约 / 净增加工时（100%）</th>
                    <th>净节约 / 净增加工时（假设避免 50%）</th>
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
                        <td>{compactNet(x.netHoursAtFullEffect)}</td>
                        <td>{compactNet(x.netHoursAtHalfEffect)}</td>
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
                <h2>全部检查会怎样</h2>
                <p>全量历史，按每次正确预警后拦截能避免失败测算。</p>
              </div>
            </div>
            <table className="rc-baselines">
              <thead>
                <tr>
                  <th>方案</th>
                  <th>检查次数</th>
                  <th>净节约 / 净增加工时</th>
                </tr>
              </thead>
              <tbody>
                {m.baselines.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {candidateName(b.label)}
                      {b.id.startsWith("mem-") && (
                        <small className="rc-timing-label">
                          记录时间不明 · 仅事后分析
                        </small>
                      )}
                    </td>
                    <td>{b.all.intercepted}</td>
                    <td>{compactNet(b.all.netHoursAtFullEffect)}</td>
                  </tr>
                ))}
                <tr>
                  <td>20 分钟对照方案</td>
                  <td>{p.intercepted}</td>
                  <td>{compactNet(p.netHoursAtFullEffect)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </details>
      <details className="rc-panel rc-disclosure">
        <summary>
          <strong>显存与分组线索</strong>
          <span>记录时间不明，仅供事后分析</span>
        </summary>
        <div className="rc-disclosure-body">
          <section className="rc-panel rc-strategy-memory">
            <h2>海外定制组显存线索</h2>
            <p>显存记录时间不明；此项事后分析不计入首页合计。</p>
            <label className="rc-strategy-linked">
              <span>
                剩余可用显存 ≤ <b>{memory} MB</b>
              </span>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                aria-label="海外定制组显存筛选门槛"
                value={memory}
                onChange={(event) => setMemory(Number(event.target.value))}
              />
            </label>
            <div className="rc-strategy-memory-result" aria-live="polite">
              <span>
                筛出 {gpu.policy.intercepted} 个：历史失败{" "}
                {gpu.policy.caughtFailures} · 历史成功{" "}
                {gpu.policy.falseInterceptions} · 结果未知{" "}
                {gpu.policy.interceptedUnknown}
              </span>
              <span>
                未筛出的历史失败 {gpu.missedFailures} · 检查工时{" "}
                {n(gpu.checkHours)}· {netText(gpu.netHours)}
              </span>
            </div>
            <div className="rc-strategy-caveat">
              <strong>显存记录时间不明，可能用了事后信息</strong>
              <p>{m.featureTiming.gpu_mem_free_mb.explanation}</p>
              <p>{m.featureTiming.gpu_mem_free_mb.requiredEvidence}</p>
            </div>
          </section>
          <section className="rc-panel">
            <div className="rc-panel-heading">
              <div>
                <h2>按团队与场景复核关联</h2>
                <p>
                  分别比较每个分组内的 ≥20 分钟与 &lt;20 分钟已知结果失败率。
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
        </div>
      </details>
      <details className="rc-panel rc-disclosure">
        <summary>
          <strong>数据来源与适用范围</strong>
          <span>去重、结果未知、上线验证</span>
        </summary>
        <div className="rc-disclosure-body rc-source-details">
          <p>
            原始 {m.source.rawRows} 行，合并 {m.source.duplicatesRemoved}{" "}
            行重复，得到 {m.source.uniqueJobs} 个唯一任务。渲染成功{" "}
            {m.outcomes.succeeded}、渲染失败 {m.outcomes.failed}、结果未知{" "}
            {m.outcomes.unknown}；结果未知不计避免失败收益，检查仍计工时。
          </p>
          <ul>
            <li>
              同步间隔是提交时距上次资产同步的时间，不是客户等待渲染结果的时间。上线前需确认这些时间是提交时快照。
            </li>
            <li>
              每次崩溃损失 {m.costs.crash} 工时，每次提前检查花费{" "}
              {m.costs.intercept} 工时；后续处理、重复检查与新增跟进要另记投入。
            </li>
            <li>
              商业保障与研发排查是不同的检查理由，不能只按净节约工时取消必要服务。
            </li>
            <li>
              历史关联未证明根因或近期故障增长。先记录检查动作、实际耗时和最终结果，再通过对照验证返工、成功率与交付时间。
            </li>
          </ul>
          <p>
            复现步骤与口径见仓库 README；源数据 SHA-256：
            <code>{m.source.sha256}</code>
          </p>
          <a className="rc-policy-link" href="/api/render/queue.csv">
            导出 20 分钟对照方案清单 →
          </a>
        </div>
      </details>
    </div>
  );
}
