import { useMemo, type ReactNode } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import "./threshold-strategy.css";
import { compactNet, netLabel } from "./presentation.mjs";
import StrategyLogicCards from "./StrategyLogicCards";
import { type HistoryFilters, type ServicePolicy } from "./service-policy.mjs";
import {
  calculateSyncStrategy,
  REVIEW_THRESHOLDS,
  STANDARD_THRESHOLDS,
  type StrategyRow,
  type Thresholds,
} from "./threshold-strategy.mjs";

type Props = {
  rows: StrategyRow[];
  costs: { crash: number; intercept: number };
  thresholds: Thresholds;
  onThresholdsChange: (thresholds: Thresholds) => void;
  memory: number;
  onMemoryChange: (value: number) => void;
  servicePolicy: ServicePolicy;
  serviceSettings: ReactNode;
  settingsOpen: boolean;
  onSettingsToggle: (open: boolean) => void;
  onShowQueue: (filters?: HistoryFilters) => void;
};
const number = (value: number) => value.toLocaleString("zh-CN");
const tone = (value: number) => (value < 0 ? "negative" : "positive");

export default function ThresholdStrategyPanel({
  rows,
  costs,
  thresholds,
  onThresholdsChange,
  memory,
  onMemoryChange,
  servicePolicy,
  serviceSettings,
  settingsOpen,
  onSettingsToggle,
  onShowQueue,
}: Props) {
  const current = useMemo(
    () => calculateSyncStrategy(rows, thresholds, costs),
    [rows, thresholds, costs],
  );
  const baseline = useMemo(
    () => calculateSyncStrategy(rows, STANDARD_THRESHOLDS, costs),
    [rows, costs],
  );
  const total = current.totals;
  return (
    <div
      className="rc-strategy rc-strategy-focused"
      data-testid="threshold-strategy"
    >
      <div className="rc-strategy-stats" aria-live="polite">
        <button
          onClick={() => onShowQueue({ scope: "hits", outcome: "failure" })}
        >
          <span>
            正确预警 <ArrowRight size={14} />
          </span>
          <strong data-testid="strategy-caught">
            {number(total.caughtFailures)} <small>个</small>
          </strong>
          <p>漏掉的失败 {total.missedFailures} 个</p>
        </button>
        <button
          onClick={() => onShowQueue({ scope: "hits", outcome: "success" })}
        >
          <span>
            多余检查 <ArrowRight size={14} />
          </span>
          <strong data-testid="strategy-false-hits">
            {number(total.falseInterceptions)} <small>个</small>
          </strong>
          <p>历史渲染成功，检查仍计工时</p>
        </button>
        <div>
          <span>检查工时</span>
          <strong data-testid="strategy-cost">
            {number(total.checkHours)} <small>工时</small>
          </strong>
          <p>
            <span data-testid="strategy-hits">{total.intercepted} 次</span> ×{" "}
            {costs.intercept} 工时，含 {total.interceptedUnknown} 个结果未知
          </p>
        </div>
        <div className={`rc-strategy-net ${tone(total.netHours)}`}>
          <span>{netLabel(total.netHours)}</span>
          <strong data-testid="strategy-net">
            {number(Math.abs(total.netHours))}
          </strong>
          <p>历史测算 · 正确预警并拦截一次省 {costs.crash - costs.intercept}</p>
        </div>
      </div>

      <section className="rc-panel rc-strategy-table-panel">
        <div className="rc-panel-heading">
          <div>
            <h2>调整检查门槛</h2>
            <p>同步间隔达到门槛就预警，并按每个预警检查一次测算。</p>
          </div>
          <button
            className="rc-policy-reset"
            onClick={() => onThresholdsChange({ ...STANDARD_THRESHOLDS })}
          >
            <RotateCcw size={14} />
            全部设为 20 分钟
          </button>
        </div>
        <div className="rc-strategy-table-scroll">
          <table
            className="rc-strategy-table rc-strategy-main-table"
            aria-label="各组检查门槛与结果"
          >
            <thead>
              <tr>
                <th>团队</th>
                <th>同步间隔门槛</th>
                <th className="rc-correct">正确预警</th>
                <th className="rc-extra">多余检查</th>
                <th>检查工时</th>
                <th>净节约 / 净增加工时</th>
              </tr>
            </thead>
            <tbody>
              {current.teams.map((row) => (
                <tr key={row.name}>
                  <th scope="row">{row.name}</th>
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
                          onThresholdsChange({
                            ...thresholds,
                            [row.name]: Number(event.target.value),
                          })
                        }
                      />
                      <span>{thresholds[row.name]} 分钟</span>
                    </label>
                  </td>
                  <td>
                    <button
                      className="rc-cell-link"
                      aria-label={`查看${row.name}正确预警`}
                      onClick={() =>
                        onShowQueue({
                          team: row.name,
                          scope: "hits",
                          outcome: "failure",
                        })
                      }
                    >
                      {row.policy.caughtFailures}
                    </button>
                  </td>
                  <td>
                    <button
                      className="rc-cell-link rc-extra"
                      aria-label={`查看${row.name}多余检查`}
                      onClick={() =>
                        onShowQueue({
                          team: row.name,
                          scope: "hits",
                          outcome: "success",
                        })
                      }
                    >
                      {row.policy.falseInterceptions}
                    </button>
                  </td>
                  <td>{number(row.checkHours)}</td>
                  <td className={tone(row.netHours)}>
                    {compactNet(row.netHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rc-rule-legend">
          正确预警：识别出历史失败；多余检查：历史渲染成功，仍被安排检查。
        </p>
        <p className="rc-strategy-scroll-hint">左右滑动查看各组结果与工时</p>
        <details className="rc-inline-details rc-strategy-calculation">
          <summary>查看计算明细</summary>
          <div className="rc-strategy-reconcile">
            <strong>
              {total.caughtFailures} × {costs.crash - costs.intercept} −{" "}
              {total.falseInterceptions} × {costs.intercept} −{" "}
              {total.interceptedUnknown} × {costs.intercept} ={" "}
              {number(total.netHours)} 工时
            </strong>
            <span>
              不检查：失败损失 {number(total.baselineFailureHours)}
              ；采用规则：检查 {number(total.checkHours)} ＋ 漏掉的失败损失{" "}
              {number(total.missedFailureHours)} ={" "}
              {number(total.totalScenarioHours)}。两者相减得到净节约工时。
            </span>
          </div>
          <div className="rc-table-wrap">
            <table aria-label="当前方案完整工时明细">
              <thead>
                <tr>
                  <th>团队</th>
                  <th>检查次数</th>
                  <th>其中结果未知</th>
                  <th>漏掉的失败</th>
                  <th>漏掉的失败损失</th>
                </tr>
              </thead>
              <tbody>
                {current.teams.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.policy.intercepted}</td>
                    <td>{row.policy.interceptedUnknown}</td>
                    <td>{row.missedFailures}</td>
                    <td>{number(row.missedFailureHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="rc-detail-intro">
            按正确预警后拦截可避免本轮崩溃进行历史测算；新增跟进、重复检查和后续处理另计。0
            分钟表示全查，初始 KA 8 分钟、其余 20 分钟是业务设置，未验证最优。
          </p>
          <button
            className="rc-policy-reset"
            onClick={() => onThresholdsChange({ ...REVIEW_THRESHOLDS })}
          >
            恢复初始方案
          </button>
        </details>
      </section>

      <StrategyLogicCards
        rows={rows}
        costs={costs}
        current={current}
        baseline={baseline}
        thresholds={thresholds}
        onThresholdsChange={onThresholdsChange}
        memory={memory}
        onMemoryChange={onMemoryChange}
      />

      <details
        id="manual-followup-settings"
        className="rc-panel rc-disclosure rc-protection-settings"
        open={settingsOpen}
        onToggle={(event) => onSettingsToggle(event.currentTarget.open)}
      >
        <summary>
          <strong>人工跟进规则</strong>
          <span>
            {servicePolicy.enabled
              ? `已配置 · ${servicePolicy.noResultMinutes} 分钟 · 仅用于模拟`
              : servicePolicy.noResultMinutes === null ||
                  servicePolicy.teams.length === 0
                ? "待配置 · 未启用"
                : "已停用"}
          </span>
        </summary>
        <div className="rc-disclosure-body">{serviceSettings}</div>
      </details>
      <p className="rc-page-note">
        历史测算，不代表已经实际修复。预警是规则提示，检查是人工动作。
      </p>
    </div>
  );
}
