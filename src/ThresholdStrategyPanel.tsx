import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, RotateCcw } from "lucide-react";
import "./threshold-strategy.css";
import { CUSTOM_TEAM, KA_TEAM, type ServicePolicy } from "./service-policy.mjs";
import {
  calculateMemoryCandidate,
  calculateSyncStrategy,
  normalizeThresholds,
  REVIEW_THRESHOLDS,
  STANDARD_THRESHOLDS,
  type StrategyRow,
} from "./threshold-strategy.mjs";

type Props = {
  rows: StrategyRow[];
  costs: { crash: number; intercept: number };
  servicePolicy: ServicePolicy;
  onOpenService: () => void;
};
const number = (value: number) => value.toLocaleString("zh-CN");
const signed = (value: number) =>
  `${value >= 0 ? "+" : "−"}${number(Math.abs(value))}`;
const tone = (value: number) => (value < 0 ? "negative" : "positive");

export default function ThresholdStrategyPanel({
  rows,
  costs,
  servicePolicy,
  onOpenService,
}: Props) {
  const [thresholds, setThresholds] = useState(() => {
    try {
      return normalizeThresholds(
        JSON.parse(localStorage.getItem("render-thresholds-v1") || "null"),
      );
    } catch {
      return normalizeThresholds(null);
    }
  });
  const [memory, setMemory] = useState(3);
  useEffect(() => {
    try {
      localStorage.setItem("render-thresholds-v1", JSON.stringify(thresholds));
    } catch {
      // The calculator still works when storage is unavailable.
    }
  }, [thresholds]);
  const current = useMemo(
    () => calculateSyncStrategy(rows, thresholds, costs),
    [rows, thresholds, costs],
  );
  const baseline = useMemo(
    () => calculateSyncStrategy(rows, STANDARD_THRESHOLDS, costs),
    [rows, costs],
  );
  const gpu = useMemo(
    () => calculateMemoryCandidate(rows, memory, costs),
    [rows, memory, costs],
  );
  const total = current.totals;
  const base = baseline.totals;
  const change = (name: string, value: number) =>
    setThresholds((previous) =>
      normalizeThresholds({ ...previous, [name]: value }),
    );
  const custom = current.teams.find((row) => row.name === CUSTOM_TEAM)!;
  return (
    <div className="rc-strategy" data-testid="threshold-strategy">
      <div className="rc-strategy-formula">
        <strong>正确拦截一次净省 {costs.crash - costs.intercept} 工时</strong>
        <span>
          历史失败被圈到 × {costs.crash} − 全部检查次数 × {costs.intercept}
          。成功和未知任务，只要检查就计成本。
        </span>
      </div>
      <div className="rc-strategy-stats" aria-live="polite">
        <div>
          <span>准备检查</span>
          <strong data-testid="strategy-hits">
            {number(total.intercepted)} <small>次</small>
          </strong>
          <p>
            覆盖历史失败 {total.caughtFailures} 个 · 漏过 {total.missedFailures}{" "}
            个
          </p>
        </div>
        <div>
          <span>检查成本</span>
          <strong data-testid="strategy-cost">
            {number(total.checkHours)} <small>工时</small>
          </strong>
          <p>
            每次 {costs.intercept} 工时，包含 {total.interceptedUnknown}{" "}
            个未知结果
          </p>
        </div>
        <div className={`rc-strategy-net ${tone(total.netHours)}`}>
          <span>本轮净节约 · 历史回算</span>
          <strong data-testid="strategy-net">
            {signed(total.netHours)} <small>工时</small>
          </strong>
          <p>按正确拦截阻止本轮崩溃计算</p>
        </div>
      </div>
      <section className="rc-panel rc-strategy-table-panel">
        <div className="rc-panel-heading">
          <div>
            <h2>调门槛，看每一组的检查代价</h2>
            <p>门槛越低，检查范围越大。0 分钟表示全部检查。</p>
          </div>
          <button
            className="rc-policy-reset"
            onClick={() => setThresholds({ ...STANDARD_THRESHOLDS })}
          >
            <RotateCcw size={14} />
            全部恢复 20 分钟
          </button>
        </div>
        <div className="rc-strategy-table-scroll">
          <table className="rc-strategy-table">
            <thead>
              <tr>
                <th>团队 / 历史任务</th>
                <th>提交距上次同步 ≥</th>
                <th>检查</th>
                <th>历史失败</th>
                <th>历史成功</th>
                <th>未知</th>
                <th>漏过失败</th>
                <th>检查工时</th>
                <th>净节约工时</th>
              </tr>
            </thead>
            <tbody>
              {current.teams.map((row) => (
                <tr key={row.name}>
                  <th scope="row">
                    {row.name}
                    <small>
                      {row.jobs} 个任务 · {row.failed} 个历史失败
                    </small>
                  </th>
                  <td className="rc-strategy-slider-cell">
                    <label>
                      <input
                        type="range"
                        min={0}
                        max={70}
                        step={1}
                        aria-label={`${row.name}同步间隔门槛`}
                        value={thresholds[row.name]}
                        onChange={(event) =>
                          change(row.name, Number(event.target.value))
                        }
                      />
                      <span>{thresholds[row.name]} 分钟</span>
                    </label>
                  </td>
                  <td>{row.policy.intercepted}</td>
                  <td>{row.policy.caughtFailures}</td>
                  <td>{row.policy.falseInterceptions}</td>
                  <td>{row.policy.interceptedUnknown}</td>
                  <td>{row.missedFailures}</td>
                  <td>{number(row.checkHours)}</td>
                  <td className={tone(row.netHours)}>{signed(row.netHours)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">合计</th>
                <td>{total.jobs} 个唯一任务</td>
                <td>{total.intercepted}</td>
                <td>{total.caughtFailures}</td>
                <td>{total.falseInterceptions}</td>
                <td>{total.interceptedUnknown}</td>
                <td>{total.missedFailures}</td>
                <td>{number(total.checkHours)}</td>
                <td className={tone(total.netHours)}>
                  {signed(total.netHours)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="rc-strategy-scroll-hint">
          左右滑动表格，可查看结果、成本和净节约。
        </p>
        <div className="rc-strategy-reconcile">
          <strong>
            {total.caughtFailures} × {costs.crash - costs.intercept}
            {" − "}
            {total.falseInterceptions} × {costs.intercept}
            {" − "}
            {total.interceptedUnknown} × {costs.intercept}
            {" = "}
            {number(total.netHours)} 工时
          </strong>
          <span>
            不检查：失败损失 {number(total.baselineFailureHours)}；
            采用规则：检查 {number(total.checkHours)} ＋ 漏检崩溃{" "}
            {number(total.missedFailureHours)}
            {" = "}
            {number(total.totalScenarioHours)}
            。前后相减得到同一净值，漏检损失不重复扣除。
          </span>
        </div>
        <div className="rc-strategy-comparison" aria-live="polite">
          <div>
            <strong>相对全部 20 分钟</strong>
            <p>
              基准：检查 {base.intercepted} 次，覆盖失败 {base.caughtFailures}{" "}
              个，净节约 {number(base.netHours)} 工时。
            </p>
          </div>
          <span>检查 {signed(total.intercepted - base.intercepted)} 次</span>
          <span>
            覆盖失败 {signed(total.caughtFailures - base.caughtFailures)} 个
          </span>
          <b className={tone(total.netHours - base.netHours)}>
            净节约 {signed(total.netHours - base.netHours)} 工时
          </b>
        </div>
        <p className="rc-strategy-note">
          初始方案为 KA 8 分钟、其他组 20
          分钟，来自待比较的业务设置。所有门槛都可调，不代表已经验证的最优策略；
          历史成功 / 失败是原始结果，不是介入后的结果。
          <button onClick={() => setThresholds({ ...REVIEW_THRESHOLDS })}>
            恢复初始方案
          </button>
        </p>
      </section>
      <div className="rc-strategy-panels">
        <section className="rc-panel rc-strategy-protection">
          <span className="rc-eyebrow">客户保障</span>
          <h2>KA 与定制，都需要提前关注</h2>
          <p>
            可分别降低同步检查门槛，查看多投入多少工时、多覆盖几个历史失败。续约和客户价值单独判断，不乘进工时。
          </p>
          {[KA_TEAM, CUSTOM_TEAM].map((name) => (
            <label className="rc-strategy-linked" key={name}>
              <span>
                {name} <b>{thresholds[name]} 分钟</b>
              </span>
              <input
                type="range"
                min={0}
                max={70}
                step={1}
                aria-label={`${name}保障卡同步门槛`}
                value={thresholds[name]}
                onChange={(event) => change(name, Number(event.target.value))}
              />
            </label>
          ))}
          <div className="rc-strategy-clock">
            <Clock3 size={18} />
            <div>
              <strong>
                提交后 {servicePolicy.noResultMinutes} 分钟仍无结果，KA
                与定制均主动跟进
              </strong>
              <p>
                这是等待时限，和上面的同步间隔是两回事。现有 CSV
                无法复算实际触发次数及额外工时，尚未接入线上派单。
              </p>
              <button onClick={onOpenService}>
                查看服务规则与权重 <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </section>
        <section className="rc-panel rc-strategy-memory">
          <span className="rc-eyebrow">定制组 · 技术排查线索</span>
          <h2>显存候选，先确认何时可知</h2>
          <p>
            原始数据有低显存与失败的关联；缺少错误码和渲染参数，还不能确认具体失败原因。
          </p>
          <label className="rc-strategy-linked">
            <span>
              剩余可用显存 ≤ <b>{memory} MB</b>
            </span>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              aria-label="定制组显存探索门槛"
              value={memory}
              onChange={(event) => setMemory(Number(event.target.value))}
            />
          </label>
          <div className="rc-strategy-memory-result" aria-live="polite">
            <span>
              圈到 <b>{gpu.policy.intercepted}</b> 个 · 历史失败{" "}
              <b>{gpu.policy.caughtFailures}</b> 个
            </span>
            <span>
              历史成功 {gpu.policy.falseInterceptions} · 未知{" "}
              {gpu.policy.interceptedUnknown} · 漏过失败 {gpu.missedFailures}
            </span>
            <span>
              检查工时 {number(gpu.checkHours)} · 事后测算净值{" "}
              <b className={tone(gpu.netHours)}>{signed(gpu.netHours)}</b>
            </span>
          </div>
          <small>
            当前定制同步规则净值 {signed(custom.netHours)}{" "}
            工时。显存是独立候选，未加入上方合计，不把两条规则的重复任务相加。
          </small>
          <div className="rc-strategy-caveat">
            <strong>采集时点未知，存在未来信息风险</strong>
            <p>
              若节点分配后、开跑前可知，可验证第二道检查；若运行后才可知，只能从那时开始处理。这里的数字不能直接当成提交时可实现的收益。
            </p>
          </div>
        </section>
      </div>
      <p className="rc-strategy-footnote">
        同步间隔示例（仅解释时间）：10:00 同步、10:08 提交，间隔是 8
        分钟，此时客户尚未等待 8 分钟。 本页用于方案比较，原预检清单仍按统一 20
        分钟生成。新门槛仍需新数据验证； 重复检查与后续处理按实际发生另计。
      </p>
    </div>
  );
}
