import { compactNet, netLabel } from "./presentation.mjs";
import {
  interceptionCostAccounting,
  type HistoryFilters,
  type ImpactGroup,
} from "./service-policy.mjs";

type Props = {
  groups: ImpactGroup[];
  costs: { crash: number; intercept: number };
  onShowQueue: (filters?: HistoryFilters) => void;
};
const n = (value: number) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
export default function ReviewCostLedger({
  groups,
  costs,
  onShowQueue,
}: Props) {
  const ledger = interceptionCostAccounting(groups, costs);
  const total = ledger.totals;
  const balance = netLabel(total.netHours);
  return (
    <div
      className="rc-cost-ledger"
      id="review-cost-ledger"
      aria-label="检查工时与节约明细"
    >
      <div className="rc-panel-heading">
        <div>
          <h3>检查工时与节约明细</h3>
          <p>
            {groups.length === 1 ? groups[0].name : "全部团队"} · 20
            分钟对照方案。正确预警并拦截后，每次净省 {costs.crash} −{" "}
            {costs.intercept} ＝ {n(total.correctInterceptionUnitNet)} 工时。
          </p>
        </div>
        <span className="rc-pill">历史测算</span>
      </div>
      <div className="rc-cost-summary" aria-live="polite">
        <div>
          <span>检查工时</span>
          <strong data-testid="cost-check-hours">
            {n(total.checkHours)} 工时
          </strong>
          <small>
            {total.intercepted} 次检查 × {costs.intercept}，含多余检查和结果未知
          </small>
        </div>
        <div>
          <span>正确预警节约工时（已扣对应检查工时）</span>
          <strong data-testid="cost-correct-net">
            +{n(total.correctInterceptionNetHours)} 工时
          </strong>
          <small>
            {total.caughtFailures} × ({costs.crash} − {costs.intercept})
          </small>
        </div>
        <div className={`rc-cost-balance ${total.assessment}`}>
          <span data-testid="cost-balance-label">{balance}</span>
          <strong data-testid="cost-net-hours">
            {n(Math.abs(total.netHours))} 工时
          </strong>
          <small>正确预警节约工时 − 多余检查及结果未知的检查工时</small>
        </div>
      </div>
      <p className="rc-cost-formula" data-testid="cost-net-equation">
        {total.caughtFailures} × {n(total.correctInterceptionUnitNet)} −{" "}
        {total.falseInterceptions} × {costs.intercept} −{" "}
        {total.interceptedUnknown} × {costs.intercept} ＝{" "}
        <strong>{n(total.netHours)} 工时</strong>。 每次正确预警并拦截所节约的{" "}
        {n(total.correctInterceptionUnitNet)} 已扣除 {costs.intercept}
        ，不能再扣一次。
      </p>
      <p className="rc-cost-comparison" data-testid="cost-comparison">
        不检查时的历史失败损失为{" "}
        <strong>{n(total.baselineFailureHours)}</strong>{" "}
        工时；采用对照方案后，漏掉 {total.missedFailures} 次失败的损失{" "}
        <strong>{n(total.missedFailureHours)}</strong> ＋全部检查工时{" "}
        <strong>{n(total.checkHours)}</strong> ＝{" "}
        <strong>{n(total.totalScenarioHours)}</strong> 工时。
      </p>
      <div className="rc-table-wrap">
        <table aria-label="按团队核对检查工时">
          <thead>
            <tr>
              <th>团队</th>
              <th>多余检查 / 检查工时</th>
              <th>检查工时</th>
              <th>正确预警节约工时</th>
              <th>漏掉的失败损失</th>
              <th>净节约 / 净增加工时</th>
            </tr>
          </thead>
          <tbody>
            {ledger.teams.map((group) => (
              <tr key={group.name}>
                <td>{group.name}</td>
                <td>
                  <button
                    className="rc-cost-drill rc-extra"
                    aria-label={`查看${group.name}多余检查任务`}
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
                <td>+{n(group.correctInterceptionNetHours)}</td>
                <td>{n(group.missedFailureHours)}</td>
                <td className={group.netHours < 0 ? "rc-negative" : ""}>
                  {compactNet(group.netHours)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rc-cost-formula">
        检查工时拆分：多余检查 {total.falseInterceptions} × {costs.intercept} ={" "}
        {n(total.successfulCheckHours)}；正确预警 {total.caughtFailures} ×{" "}
        {costs.intercept} = {n(total.failedCheckHours)}；结果未知{" "}
        {total.interceptedUnknown} × {costs.intercept} ={" "}
        {n(total.unknownCheckHours)}。三项合计 {n(total.checkHours)}{" "}
        工时，不能重复加计。
      </p>
      <p className="rc-policy-note">
        漏掉的失败仍按每次 {costs.crash}{" "}
        计入采用规则后的总成本；它在不检查时也会发生，计算前后差额时不能重复扣除。
        历史测算按正确预警后拦截避免本轮崩溃记账；后续修复、重复检查等额外成本另计，客户保障价值不虚构为工时收益。
      </p>
    </div>
  );
}
