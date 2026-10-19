import { useEffect, useState } from "react";
import {
  completeStrategyAccounting,
  reviewCostAccounting,
  type ImpactGroup,
  type StrategyCostInputs,
} from "./service-policy.mjs";

type Props = {
  groups: ImpactGroup[];
  effect: number;
  costs: { crash: number; intercept: number };
};
const emptyInputs = (): StrategyCostInputs => ({
  additionalChecks: null,
  otherHours: null,
  additionalAvoidedFailures: null,
});
const n = (value: number) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export default function StrategyCostPanel({ groups, effect, costs }: Props) {
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
  const total = completeStrategyAccounting(base, inputs, costs);
  const fields = [
    {
      key: "additionalChecks",
      title: "额外提前核查次数",
      step: 1,
      hint: `含无结果跟进、显存检查等尚未计入基准的核查。每次 ${costs.intercept} 工时；同一任务再次实际核查也要计次。`,
    },
    {
      key: "otherHours",
      title: "其他新增人工工时",
      step: "any",
      hint: "填写未包含在上述核查定额中的处理、协调等人工投入。已包含的时间不重复加计，等待时长不直接等于人工工时。",
    },
    {
      key: "additionalAvoidedFailures",
      title: "新增避免失败次数（假设）",
      step: "any",
      hint: `不与基准已避免的 ${n(base.expectedAvoidedFailures)} 次重复。暂不主张新增收益时填 0；最多 ${n(base.expectedRemainingFailures)} 次。`,
    },
  ] as const;
  return (
    <section className="rc-panel rc-complete-cost" aria-label="完整策略工时账">
      <div className="rc-panel-heading">
        <div>
          <h2>完整策略工时账：投入都要计入</h2>
          <p>
            全部团队 · 原同步预检＋新增跟进与处理。题目口径：避免一次失败{" "}
            {costs.crash} 工时，每次提前核查 {costs.intercept} 工时。
          </p>
        </div>
        <span className="rc-pill">可编辑假设 · 非实测结果</span>
      </div>
      <div className="rc-complete-summary" aria-live="polite">
        <div>
          <span>全部核查与处理投入</span>
          <strong data-testid="complete-cost-hours">
            {total.totalCostHours === null
              ? "成本未核定"
              : `${n(total.totalCostHours)} 工时`}
          </strong>
          <small>原规则 {n(base.checkHours)}＋额外核查＋其他人工</small>
        </div>
        <div>
          <span>预计避免的失败损失</span>
          <strong data-testid="complete-avoided-hours">
            {total.totalAvoidedHours === null
              ? "待填写收益假设"
              : `${n(total.totalAvoidedHours)} 工时`}
          </strong>
          <small>原规则按 {effect}% 有效试算，另加不重复的新增收益</small>
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
              ? "整体情景净工时"
              : total.netHours < 0
                ? "整体情景净增加负荷"
                : total.netHours > 0
                  ? "整体情景净节省"
                  : "整体情景工时持平"}
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
        {n(base.avoidedHours)} ＋ {inputs.additionalAvoidedFailures ?? "待填"} ×{" "}
        {costs.crash}
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
        {" ＋ 核查与处理投入 "}
        {total.totalCostHours === null ? "待核定" : n(total.totalCostHours)}
        {" ＝ "}
        {total.totalBurdenHours === null
          ? "总负荷暂不可计算"
          : `${n(total.totalBurdenHours)} 工时`}
        。
      </p>
      <p className="rc-policy-note">
        原规则基准净工时为 {n(base.netHours)}，只覆盖原来的 {base.intercepted}{" "}
        次核查。
        新增次数先按实际动作去重：两个规则共同触发同一次检查只计一次，另做了一次检查就再计一次。
        CSV
        没有新增跟进和处理记录，不能据此默认免费；时限或权重不会自动推导新增次数，调整服务范围后需重新估计。
        这里的填写值只保存在当前浏览器，不写入正式数据。
      </p>
      <button
        className="rc-policy-reset"
        onClick={() => setInputs(emptyInputs())}
      >
        清空假设，恢复待核定
      </button>
    </section>
  );
}
