import { useMemo } from "react";
import { KA_TEAM } from "./service-policy.mjs";
import {
  calculateMemoryCandidate,
  type calculateSyncStrategy,
  type StrategyRow,
  type Thresholds,
} from "./threshold-strategy.mjs";
import "./strategy-logic.css";
import { comparisonText, netText } from "./presentation.mjs";

type Props = {
  rows: StrategyRow[];
  costs: { crash: number; intercept: number };
  current: ReturnType<typeof calculateSyncStrategy>;
  baseline: ReturnType<typeof calculateSyncStrategy>;
  thresholds: Thresholds;
  onThresholdsChange: (thresholds: Thresholds) => void;
  memory: number;
  onMemoryChange: (value: number) => void;
};
const n = (value: number) => value.toLocaleString("zh-CN");
const tone = (value: number) => (value < 0 ? "negative" : "positive");
const rate = (failures: number, known: number) =>
  known ? `${((failures / known) * 100).toFixed(1)}%` : "—";

export default function StrategyLogicCards({
  rows,
  costs,
  current,
  baseline,
  thresholds,
  onThresholdsChange,
  memory,
  onMemoryChange,
}: Props) {
  const ka = current.teams.find((row) => row.name === KA_TEAM)!;
  const kaBaseline = baseline.teams.find((row) => row.name === KA_TEAM)!;
  const gpu = useMemo(
    () => calculateMemoryCandidate(rows, memory, costs),
    [rows, memory, costs],
  );
  const lowMemory = useMemo(
    () => calculateMemoryCandidate(rows, 5, costs),
    [rows, costs],
  );
  const lowKnown =
    lowMemory.policy.caughtFailures + lowMemory.policy.falseInterceptions;
  const highKnown = lowMemory.failed + lowMemory.succeeded - lowKnown;
  const highFailed = lowMemory.failed - lowMemory.policy.caughtFailures;
  return (
    <div className="rc-logic-cards">
      <section
        className="rc-panel rc-logic-card rc-logic-commercial"
        aria-labelledby="commercial-logic-title"
      >
        <header>
          <span className="rc-logic-tag">商业逻辑</span>
          <h2 id="commercial-logic-title">KA 大客户保障</h2>
          <p>负责人可按客户需求调整门槛；增加的检查照常计入工时。</p>
        </header>
        <div className="rc-logic-block rc-logic-controls">
          <div className="rc-logic-control">
            <label>
              <span>
                KA：提交距上次同步 ≥ <b>{thresholds[KA_TEAM]} 分钟</b>就预警
              </span>
              <input
                type="range"
                min={0}
                max={70}
                step={1}
                aria-label={`${KA_TEAM}同步间隔门槛（商业逻辑）`}
                value={thresholds[KA_TEAM]}
                onChange={(event) =>
                  onThresholdsChange({
                    ...thresholds,
                    [KA_TEAM]: Number(event.target.value),
                  })
                }
              />
            </label>
            <div
              className="rc-logic-results"
              data-testid="logic-ka-results"
              aria-live="polite"
            >
              <p>
                检查 <b>{ka.policy.intercepted}</b> 次 · 正确预警{" "}
                <b className="rc-logic-failure">{ka.policy.caughtFailures}</b>
                {" · "}多余检查{" "}
                <b className="rc-extra">{ka.policy.falseInterceptions}</b>
                {" · "}结果未知 <b>{ka.policy.interceptedUnknown}</b>
              </p>
              <p>
                检查工时 <b>{n(ka.checkHours)}</b>
                {" · "}
                <b className={tone(ka.netHours)}>{netText(ka.netHours)}</b>
              </p>
            </div>
          </div>
        </div>
        <div className="rc-logic-block rc-logic-context">
          <div className="rc-logic-comparison" aria-live="polite">
            <strong>KA：与 20 分钟对照方案相比</strong>
            <p data-testid="logic-ka-comparison">
              {comparisonText(ka, kaBaseline)}
            </p>
            <small>
              对照方案：{netText(kaBaseline.netHours)} → 当前方案：
              {netText(ka.netHours)}
            </small>
          </div>
        </div>
      </section>

      <section
        className="rc-panel rc-logic-card rc-logic-technical"
        aria-labelledby="technical-logic-title"
      >
        <header>
          <span className="rc-logic-tag">技术逻辑</span>
          <h2 id="technical-logic-title">海外定制组</h2>
          <p aria-live="polite">
            低显存与历史失败有关联，可作为排查线索；尚不能认定失败原因。
          </p>
        </header>
        <div className="rc-logic-block rc-logic-controls">
          <div className="rc-logic-control">
            <label>
              <span>
                事后分析：剩余可用显存 ≤ <b>{memory} MB</b>
              </span>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                aria-label="海外定制组显存筛选门槛"
                value={memory}
                onChange={(event) => onMemoryChange(Number(event.target.value))}
              />
            </label>
            <div
              className="rc-logic-results"
              data-testid="logic-memory-results"
              aria-live="polite"
            >
              <p>
                筛出 <b>{gpu.policy.intercepted}</b> 个 · 历史失败{" "}
                <b>{gpu.policy.caughtFailures}</b>
                {" · "}历史成功 <b>{gpu.policy.falseInterceptions}</b>
                {" · "}结果未知 <b>{gpu.policy.interceptedUnknown}</b>
              </p>
              <p>
                检查工时 <b>{n(gpu.checkHours)}</b>
                {" · "}
                <b className={tone(gpu.netHours)}>{netText(gpu.netHours)}</b>
              </p>
            </div>
          </div>
        </div>
        <div className="rc-logic-block rc-logic-context">
          <strong className="rc-logic-risk">
            显存记录时间不明，可能用了事后信息。
          </strong>
          <p>需先确认显存在什么时候可知，再判断能否提前预警。</p>
          <p className="rc-logic-boundary">
            此项未计入首页合计，重复任务不能相加。
          </p>
          <details className="rc-logic-evidence">
            <summary>为什么关注低显存</summary>
            <p>
              海外定制组已知结果：≤5 MB 失败率为{" "}
              {lowMemory.policy.caughtFailures}/{lowKnown}＝
              {rate(lowMemory.policy.caughtFailures, lowKnown)}；&gt;5 MB 为{" "}
              {highFailed}/{highKnown}＝{rate(highFailed, highKnown)}。
              数据缺少错误码、渲染特性与版本，只能说明关联。
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}
