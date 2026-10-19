import { useState } from "react";
import ReviewCostLedger from "./ReviewCostLedger";
import {
  ruleOutcomeBreakdown,
  interceptionCostAccounting,
  type HistoryFilters,
  type ImpactGroup,
} from "./service-policy.mjs";

type Props = {
  groups: ImpactGroup[];
  costs: { crash: number; intercept: number };
  onShowQueue: (filters?: HistoryFilters) => void;
};

export default function RuleOutcomeMatrix({
  groups,
  costs,
  onShowQueue,
}: Props) {
  const [team, setTeam] = useState("");
  const selectedGroups = team
    ? groups.filter((group) => group.name === team)
    : groups;
  const counts = ruleOutcomeBreakdown(selectedGroups);
  const costPreview = interceptionCostAccounting(selectedGroups, costs).totals;
  const n = (value: number) =>
    value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  const cards = [
    {
      key: "successUnflagged",
      title: "成功，未触发规则",
      scope: "misses",
      outcome: "success",
      meaning: "历史渲染成功；按规则回放，无需新增这次核查。",
      accounting: "本轮新增拦截成本 0 工时",
      tone: "smooth",
    },
    {
      key: "failureUnflagged",
      title: "失败，未触发规则",
      scope: "misses",
      outcome: "failure",
      meaning: "规则漏掉的失败，优先调查遗漏原因，减少客户反复重试。",
      accounting: `失败损失 ${counts.failureUnflagged} × ${costs.crash} ＝ ${n(costPreview.missedFailureHours)} 工时`,
      tone: "missed",
    },
    {
      key: "failureFlagged",
      title: "失败，被规则圈到",
      scope: "hits",
      outcome: "failure",
      meaning: "本轮按正确提前拦截避免崩溃记账；后续处理与交付需继续跟进。",
      accounting: `正确拦截净收益 ${counts.failureFlagged} × (${costs.crash} − ${costs.intercept}) ＝ +${n(costPreview.correctInterceptionNetHours)} 工时`,
      tone: "rescue",
    },
    {
      key: "successFlagged",
      title: "成功，但被规则圈到",
      scope: "hits",
      outcome: "success",
      meaning: "会增加检查投入；新功能、质量验证的价值需要另外记录。",
      accounting: `额外拦截成本 ${counts.successFlagged} × ${costs.intercept} ＝ ${n(costPreview.successfulCheckHours)} 工时`,
      tone: "extra",
    },
  ] as const;
  return (
    <section className="rc-panel rc-outcome-matrix">
      <div className="rc-panel-heading">
        <div>
          <h2>成功与失败，规则有没有提前圈到</h2>
          <p>
            历史结果 × 同步规则回放；按任务计数，不代表客户人数。点击查看明细。
          </p>
        </div>
        <select
          aria-label="结果四象限团队筛选"
          value={team}
          onChange={(event) => setTeam(event.target.value)}
        >
          <option value="">全部团队</option>
          {groups.map((group) => (
            <option key={group.name}>{group.name}</option>
          ))}
        </select>
      </div>
      <button
        className="rc-cost-preview"
        data-testid="cost-preview"
        onClick={() =>
          document
            .getElementById("review-cost-ledger")
            ?.scrollIntoView({ block: "start", behavior: "smooth" })
        }
      >
        <span>
          原规则投入 <b>{n(costPreview.checkHours)}</b> 工时
        </span>
        <span>
          正确拦截净收益 <b>+{n(costPreview.correctInterceptionNetHours)}</b>{" "}
          工时
        </span>
        <span>
          {costPreview.assessment === "higher"
            ? "本轮净增加工时"
            : costPreview.assessment === "equal"
              ? "本轮工时持平"
              : "本轮净节约"}{" "}
          <b>{n(Math.abs(costPreview.netHours))}</b> 工时
        </span>
        <small>查看原规则明细 ↓</small>
      </button>
      <div className="rc-outcome-grid">
        {cards.map((card) => (
          <button
            key={card.key}
            className={`rc-outcome-card ${card.tone}`}
            aria-label={`查看${card.title}任务`}
            onClick={() =>
              onShowQueue({ team, scope: card.scope, outcome: card.outcome })
            }
          >
            <span>{card.title}</span>
            <strong data-testid={`quadrant-${card.key}`}>
              {counts[card.key]} <small>个</small>
            </strong>
            <p>{card.meaning}</p>
            <span
              className="rc-quadrant-accounting"
              data-testid={`quadrant-cost-${card.key}`}
            >
              {card.accounting}
            </span>
            {card.key === "successFlagged" && (
              <span
                className="rc-quadrant-breakdown"
                data-testid="successful-flagged-breakdown"
              >
                {selectedGroups.map((group) => (
                  <span key={group.name}>
                    {group.name} <b>{group.policy.falseInterceptions}</b>
                  </span>
                ))}
              </span>
            )}
            <small>查看任务 →</small>
          </button>
        ))}
      </div>
      <p className="rc-matrix-unknown">
        未回传单列：
        <button
          onClick={() =>
            onShowQueue({ team, scope: "hits", outcome: "unknown" })
          }
        >
          已触发 {counts.unknownFlagged} 个
        </button>{" "}
        /{" "}
        <button
          onClick={() =>
            onShowQueue({ team, scope: "misses", outcome: "unknown" })
          }
        >
          未触发 {counts.unknownUnflagged} 个
        </button>
        ，不放进成功或失败。已触发的未知任务仍扣{" "}
        {n(costPreview.unknownCheckHours)} 工时，不计避免失败收益。
      </p>
      <ReviewCostLedger
        groups={selectedGroups}
        costs={costs}
        onShowQueue={onShowQueue}
      />
      <p className="rc-policy-note">
        “被圈到”不等于实际已经拦截、修复或成功交付。数据没有人工介入记录、质量验收、客户满意度或续费结果。更早且准确地发现风险能留出处理时间；客户收益仍需看修复、交期和额外负担的实际变化。
      </p>
    </section>
  );
}
