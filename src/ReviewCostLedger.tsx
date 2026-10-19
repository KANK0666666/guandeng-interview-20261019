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
  const balance =
    total.assessment === "higher"
      ? "本轮回放净增加工时"
      : total.assessment === "lower"
        ? "本轮回放净节约工时"
        : "本轮回放工时持平";
  return (
    <div
      className="rc-cost-ledger"
      id="review-cost-ledger"
      aria-label="核查投入与工时账"
    >
      <div className="rc-panel-heading">
        <div>
          <h3>本轮拦截账：逐项核对投入与节约</h3>
          <p>
            {groups.length === 1 ? groups[0].name : "全部团队"} · 同步 ≥20
            分钟规则回放。正确拦截每次净省 {costs.crash} − {costs.intercept} ＝{" "}
            {n(total.correctInterceptionUnitNet)} 工时。
          </p>
        </div>
        <span className="rc-pill">本轮回放 · 尚非实测收益</span>
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
          <span>正确拦截的净收益（已扣这部分成本）</span>
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
          <small>正确拦截净收益 − 成功和未知拦截成本</small>
        </div>
      </div>
      <p className="rc-cost-formula" data-testid="cost-net-equation">
        {total.caughtFailures} × {n(total.correctInterceptionUnitNet)} −{" "}
        {total.falseInterceptions} × {costs.intercept} −{" "}
        {total.interceptedUnknown} × {costs.intercept} ＝{" "}
        <strong>{n(total.netHours)} 工时</strong>。 每次正确拦截的{" "}
        {n(total.correctInterceptionUnitNet)} 已扣除 {costs.intercept}
        ，不能再扣一次。
      </p>
      <p className="rc-cost-comparison" data-testid="cost-comparison">
        不拦截的已知失败损失为 <strong>{n(total.baselineFailureHours)}</strong>{" "}
        工时；采用规则后，漏掉 {total.missedFailures} 次失败的损失{" "}
        <strong>{n(total.missedFailureHours)}</strong> ＋全部拦截投入{" "}
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
              <th>正确拦截净收益</th>
              <th>漏掉失败的损失</th>
              <th>本轮净节约</th>
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
                <td>+{n(group.correctInterceptionNetHours)}</td>
                <td>{n(group.missedFailureHours)}</td>
                <td className={group.netHours < 0 ? "rc-negative" : ""}>
                  {n(group.netHours)}
                </td>
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
        漏掉的失败仍按每次 {costs.crash}{" "}
        计入采用规则后的总成本；它在不拦截时也会发生，计算前后差额时不能重复扣除。
        本轮回放按正确拦截避免本轮崩溃记账；后续修复、重复检查等额外成本另计，客户保障价值不虚构为工时收益。
      </p>
    </div>
  );
}
