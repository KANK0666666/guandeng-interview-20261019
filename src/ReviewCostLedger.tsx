import {
  reviewCostAccounting,
  type HistoryFilters,
  type ImpactGroup,
} from "./service-policy.mjs";

type Props = {
  groups: ImpactGroup[];
  effect: number;
  onEffectChange: (effect: number) => void;
  costs: { crash: number; intercept: number };
  onShowQueue: (filters?: HistoryFilters) => void;
};
const n = (value: number) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(2)}%`;

export default function ReviewCostLedger({
  groups,
  effect,
  onEffectChange,
  costs,
  onShowQueue,
}: Props) {
  const ledger = reviewCostAccounting(groups, effect, costs);
  const total = ledger.totals;
  const balance =
    total.assessment === "higher"
      ? "基准情景净增加负荷"
      : total.assessment === "lower"
        ? "基准情景净节省"
        : "基准情景工时持平";
  return (
    <div
      className="rc-cost-ledger"
      id="review-cost-ledger"
      aria-label="核查投入与工时账"
    >
      <div className="rc-panel-heading">
        <div>
          <h3>原同步规则工时账（仅基准）</h3>
          <p>
            {groups.length === 1 ? groups[0].name : "全部团队"} · 同步 ≥20
            分钟规则回放，按题目每次核查 {costs.intercept} 工时、失败损失{" "}
            {costs.crash} 工时计算。
          </p>
        </div>
        <span className="rc-pill">情景测算 · 尚非实测收益</span>
      </div>
      <div className="rc-cost-summary" aria-live="polite">
        <div>
          <span>原规则核查投入</span>
          <strong data-testid="cost-check-hours">
            {n(total.checkHours)} 工时
          </strong>
          <small>
            {total.intercepted} 个命中 × {costs.intercept}，含成功和未知
          </small>
        </div>
        <div>
          <span>原规则预计避免的失败损失</span>
          <strong data-testid="cost-avoided-hours">
            {n(total.avoidedHours)} 工时
          </strong>
          <small>
            {total.caughtFailures} 个失败 × {costs.crash} × {effect}%
          </small>
        </div>
        <div className={`rc-cost-balance ${total.assessment}`}>
          <span data-testid="cost-balance-label">{balance}</span>
          <strong data-testid="cost-net-hours">
            {n(Math.abs(total.netHours))} 工时
          </strong>
          <small>预计避免损失 − 全部核查投入 = {n(total.netHours)}</small>
        </div>
      </div>
      <label className="rc-effect-control">
        <span>
          核查后真正避免原有失败的比例（假设）<strong>{effect}%</strong>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={effect}
          aria-label="核查工时假设有效比例"
          onChange={(event) => onEffectChange(Number(event.target.value))}
        />
        <small>
          拖动看何时减轻负荷、何时增加负荷；与权重页、回放证据共用同一假设。权重不放大工时。
        </small>
      </label>
      <p className="rc-cost-comparison" data-testid="cost-comparison">
        按已知失败损失模型：不新增这条核查规则为{" "}
        <strong>{n(total.baselineFailureHours)}</strong>{" "}
        工时；采用规则后，剩余失败损失{" "}
        <strong>{n(total.remainingFailureHours)}</strong> ＋核查投入{" "}
        <strong>{n(total.checkHours)}</strong> ＝{" "}
        <strong>{n(total.totalScenarioHours)}</strong> 工时。
      </p>
      <div className="rc-table-wrap">
        <table aria-label="按团队核对核查成本">
          <thead>
            <tr>
              <th>团队</th>
              <th>成功但圈到 / 核查成本</th>
              <th>原规则核查投入</th>
              <th>预计避免损失</th>
              <th>净工时</th>
              <th>盈亏平衡 α</th>
            </tr>
          </thead>
          <tbody>
            {ledger.teams.map((group) => (
              <tr key={group.name}>
                <td>{group.name}</td>
                <td>
                  <button
                    className="rc-cost-drill"
                    aria-label={`查看${group.name}成功但被圈到的任务`}
                    onClick={() =>
                      onShowQueue({
                        team: group.name,
                        scope: "hits",
                        outcome: "success",
                      })
                    }
                  >
                    {group.policy.falseInterceptions} 个任务 →
                  </button>
                  <small>
                    {n(group.successfulCheckHours)} 工时，已计入全部投入
                  </small>
                </td>
                <td>{n(group.checkHours)}</td>
                <td>{n(group.avoidedHours)}</td>
                <td className={group.netHours < 0 ? "rc-negative" : ""}>
                  {n(group.netHours)}
                </td>
                <td>{pct(group.breakEvenEffectiveness)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rc-cost-formula">
        核查成本拆分：成功 {total.falseInterceptions} × {costs.intercept} ={" "}
        {n(total.successfulCheckHours)}；失败 {total.caughtFailures} ×{" "}
        {costs.intercept} = {n(total.failedCheckHours)}；未知{" "}
        {total.interceptedUnknown} × {costs.intercept} ={" "}
        {n(total.unknownCheckHours)}。三项合计 {n(total.checkHours)}{" "}
        工时，不能重复加计。
      </p>
      <p className="rc-policy-note">
        {total.breakEvenEffectiveness !== null
          ? `当前范围盈亏平衡 α ≈ ${pct(total.breakEvenEffectiveness)}（四舍五入）；有效比例超过精确盈亏点，模型中的净工时才为正。`
          : "当前范围没有可计算的已知失败盈亏点。"}{" "}
        这只是原规则基准，不能当作完整策略净收益。新增无结果跟进、显存检查及其他人工投入在上方完整策略工时账填写；缺少次数和工时不能当作免费，整体净值保持待核定。实际效果仍需记录干预后结果，交付保障和客户价值另行评估。
      </p>
    </div>
  );
}
