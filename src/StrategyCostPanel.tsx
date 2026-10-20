import { netLabel, netText } from "./presentation.mjs";
import { useEffect, useState } from "react";
import {
  completeStrategyAccounting,
  interceptionCostAccounting,
  reviewCostAccounting,
  type ImpactGroup,
  type StrategyCostInputs,
} from "./service-policy.mjs";

type Props = {
  groups: ImpactGroup[];
  effect: number;
  costs: { crash: number; intercept: number };
  additionalOnly?: boolean;
};
const emptyInputs = (): StrategyCostInputs => ({
  additionalChecks: null,
  otherHours: null,
  additionalAvoidedFailures: null,
});
const n = (value: number) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export default function StrategyCostPanel({
  groups,
  effect,
  costs,
  additionalOnly = false,
}: Props) {
  const [inputs, setInputs] = useState<StrategyCostInputs>(() => {
    const initial = emptyInputs();
    try {
      const saved = JSON.parse(
        localStorage.getItem("render-complete-cost-v1") || "null",
      );
      for (const key of Object.keys(initial) as (keyof StrategyCostInputs)[]) {
        if (typeof saved?.[key] === "number" && Number.isFinite(saved[key]))
          initial[key] = saved[key];
      }
    } catch {
      /* Missing or invalid saved inputs remain explicitly unknown. */
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem("render-complete-cost-v1", JSON.stringify(inputs));
    } catch {
      /* The live calculation still works if storage is unavailable. */
    }
  }, [inputs]);
  const base = reviewCostAccounting(groups, effect, costs).totals;
  const replay = interceptionCostAccounting(groups, costs).totals;
  const total = completeStrategyAccounting(base, inputs, costs);
  const fields = [
    {
      key: "additionalChecks",
      title: "额外提前检查次数",
      step: 1,
      hint: `含无结果跟进、显存检查等尚未计入对照方案的检查。每次 ${costs.intercept} 工时；同一任务再次实际检查也要计次。`,
    },
    {
      key: "otherHours",
      title: "其他新增人工工时",
      step: "any",
      hint: "填写未包含在上述检查定额中的处理、协调等人工投入。已包含的时间不重复加计，等待时长不直接等于人工工时。",
    },
    {
      key: "additionalAvoidedFailures",
      title: "新增避免失败次数（假设）",
      step: "any",
      hint: `不与对照方案已避免的 ${n(base.expectedAvoidedFailures)} 次重复。暂不主张新增收益时填 0；最多 ${n(base.expectedRemainingFailures)} 次。`,
    },
  ] as const;
  return (
    <section
      className={
        additionalOnly ? "rc-additional-cost" : "rc-panel rc-complete-cost"
      }
      aria-label={additionalOnly ? "额外检查与人工投入" : "检查工时与节约明细"}
    >
      {!additionalOnly && (
        <>
          <div className="rc-panel-heading">
            <div>
              <h2>
                正确预警并拦截一次，净节约{" "}
                {n(replay.correctInterceptionUnitNet)} 工时
              </h2>
              <p>
                历史测算：正确预警后拦截避免本轮崩溃，省 {costs.crash}、花{" "}
                {costs.intercept}； 多余检查与结果未知的检查也计工时。
              </p>
            </div>
            <span className="rc-pill">
              20 分钟对照方案的历史测算 · 非线上实测
            </span>
          </div>
          <div className="rc-complete-summary" aria-live="polite">
            <div>
              <span>正确预警节约工时（已扣对应检查工时）</span>
              <strong data-testid="replay-correct-net">
                +{n(replay.correctInterceptionNetHours)} 工时
              </strong>
              <small>
                {replay.caughtFailures} × ({costs.crash} − {costs.intercept}
                )，已扣这部分检查工时
              </small>
            </div>
            <div className="rc-complete-loss">
              <span>还要扣除的多余检查与结果未知检查工时</span>
              <strong data-testid="replay-other-cost">
                −{n(replay.otherInterceptionHours)} 工时
              </strong>
              <small>
                多余检查 {replay.falseInterceptions} × {costs.intercept} ＋
                结果未知 {replay.interceptedUnknown} × {costs.intercept}
              </small>
            </div>
            <div className={replay.netHours < 0 ? "rc-complete-loss" : ""}>
              <span>{netLabel(replay.netHours)}</span>
              <strong data-testid="replay-net-hours">
                {n(Math.abs(replay.netHours))} 工时
              </strong>
              <small>正确预警节约工时 − 其他检查工时</small>
            </div>
          </div>
          <p className="rc-complete-equation" data-testid="replay-equation">
            {replay.caughtFailures} × {n(replay.correctInterceptionUnitNet)} −{" "}
            {replay.falseInterceptions} × {costs.intercept} −{" "}
            {replay.interceptedUnknown} × {costs.intercept} ＝{" "}
            <strong>{n(replay.netHours)} 工时</strong>
          </p>
          <p className="rc-policy-note" data-testid="replay-burden">
            不检查：{replay.failed} × {costs.crash} ＝{" "}
            {n(replay.baselineFailureHours)} 工时。 采用规则：全部{" "}
            {replay.intercepted} 次检查 × {costs.intercept} ＝{" "}
            {n(replay.checkHours)}， 加上漏掉的 {replay.missedFailures} 次失败 ×{" "}
            {costs.crash} ＝ {n(replay.missedFailureHours)}， 合计{" "}
            {n(replay.totalScenarioHours)} 工时。 前后相减：
            {n(replay.baselineFailureHours)} − {n(replay.totalScenarioHours)} ＝{" "}
            {n(replay.netHours)}。
          </p>
          <p className="rc-policy-note">
            历史测算按正确预警后拦截避免本轮崩溃记账；不代表已经实际修复。
            结果未知不计避免失败收益。重复检查、后续处理等额外投入在下方另算。
          </p>
        </>
      )}
      <details className="rc-accounting-details">
        <summary>
          {additionalOnly
            ? "额外检查与人工投入"
            : "扩展试算：避免失败比例假设、额外检查与人工投入（未计入上述本轮主账）"}
        </summary>
        <div className="rc-panel-heading">
          <div>
            <h3>
              {additionalOnly
                ? "把新增投入也算进去"
                : "扩展策略工时账：另行输入假设"}
            </h3>
            <p>
              20 分钟对照方案的 {replay.caughtFailures} 个正确预警、
              {replay.intercepted}{" "}
              次检查已自动计入，不要重复填到“新增”中。沿用本页的 {effect}%
              避免失败比例假设；这项扩展试算不改变策略首页。
            </p>
          </div>
          <span className="rc-pill">可编辑假设 · 非实测结果</span>
        </div>
        <div className="rc-complete-summary" aria-live="polite">
          <div>
            <span>全部检查与处理投入</span>
            <strong data-testid="complete-cost-hours">
              {total.totalCostHours === null
                ? "成本未核定"
                : `${n(total.totalCostHours)} 工时`}
            </strong>
            <small>对照方案 {n(base.checkHours)}＋额外检查＋其他人工</small>
          </div>
          <div>
            <span>预计避免的失败损失</span>
            <strong data-testid="complete-avoided-hours">
              {total.totalAvoidedHours === null
                ? "待填写收益假设"
                : `${n(total.totalAvoidedHours)} 工时`}
            </strong>
            <small>
              对照方案按避免失败比例 {effect}% 测算，另加不重复的新增收益
            </small>
          </div>
          <div
            className={
              total.netHours !== null && total.netHours < 0
                ? "rc-complete-loss"
                : ""
            }
          >
            <span data-testid="complete-balance-label">
              {total.netHours === null
                ? "净节约 / 净增加工时"
                : total.netHours < 0
                  ? "净增加工时"
                  : total.netHours > 0
                    ? "净节约工时"
                    : "净节约工时"}
            </span>
            <strong data-testid="complete-net-hours">
              {total.netHours === null
                ? "暂不可计算"
                : `${n(Math.abs(total.netHours))} 工时`}
            </strong>
            <small>预计避免损失 − 全部人工投入</small>
          </div>
        </div>
        <p
          className="rc-complete-status"
          data-testid="complete-cost-status"
          aria-live="polite"
        >
          {total.errors.length
            ? total.errors.join("；")
            : total.missing.length
              ? `尚未填写：${total.missing.join("、")}。空白不按 0 计算。`
              : "以上为你填写假设后的情景结果，尚不能证明实际节省。"}
        </p>
        <div className="rc-complete-inputs">
          {fields.map(({ key, title, step, hint }) => (
            <label key={key}>
              <span>{title}</span>
              <input
                type="number"
                min={0}
                step={step}
                aria-label={title}
                placeholder="未知，请填写"
                value={inputs[key] ?? ""}
                onChange={(event) =>
                  setInputs({
                    ...inputs,
                    [key]:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
              <small>{hint}</small>
            </label>
          ))}
        </div>
        <p className="rc-complete-equation" data-testid="complete-equation">
          {n(base.avoidedHours)} ＋ {inputs.additionalAvoidedFailures ?? "待填"}{" "}
          × {costs.crash}
          {" − ("}
          {n(base.checkHours)} ＋ {inputs.additionalChecks ?? "待填"} ×{" "}
          {costs.intercept}
          {" ＋ "}
          {inputs.otherHours ?? "待填"}
          {") = "}
          {total.netHours === null ? "暂不可计算" : `${n(total.netHours)} 工时`}
        </p>
        <p className="rc-policy-note" data-testid="complete-burden">
          已知失败口径：原失败损失 {n(base.baselineFailureHours)}{" "}
          工时；采用完整方案后，剩余失败损失{" "}
          {total.remainingFailureHours === null
            ? "待核定"
            : n(total.remainingFailureHours)}
          {" ＋ 检查与处理投入 "}
          {total.totalCostHours === null ? "待核定" : n(total.totalCostHours)}
          {" ＝ "}
          {total.totalBurdenHours === null
            ? "总负荷暂不可计算"
            : `${n(total.totalBurdenHours)} 工时`}
          。
        </p>
        <p className="rc-policy-note">
          20 分钟对照方案：{netText(base.netHours)}，只覆盖原来的{" "}
          {base.intercepted} 次检查。
          新增次数先按实际动作去重：两个规则共同触发同一次检查只计一次，另做了一次检查就再计一次。
          CSV
          没有新增跟进和处理记录，不能据此默认免费；跟进时限不能自动推导新增次数，调整服务范围后需重新估计。
          这里的填写值只保存在当前浏览器，不写入正式数据。
        </p>
        <button
          className="rc-policy-reset"
          onClick={() => setInputs(emptyInputs())}
        >
          清空假设，恢复待核定
        </button>
      </details>
    </section>
  );
}
