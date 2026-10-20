import { useRef, useState } from "react";
import { netLabel } from "./presentation.mjs";
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
  compact?: boolean;
};

export default function RuleOutcomeMatrix({
  groups,
  costs,
  onShowQueue,
  compact = false,
}: Props) {
  const [team, setTeam] = useState("");
  const ledgerDetails = useRef<HTMLDetailsElement>(null);
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
      title: "未预警的成功任务",
      scope: "misses",
      outcome: "success",
      meaning: "历史渲染成功，规则也没有安排检查。",
      accounting: "新增检查工时 0 工时",
      shortAccounting: "新增检查工时 0 工时",
      tone: "smooth",
    },
    {
      key: "failureUnflagged",
      title: "漏掉的失败",
      scope: "misses",
      outcome: "failure",
      meaning: "历史渲染失败，规则没有预警。",
      accounting: `失败损失 ${counts.failureUnflagged} × ${costs.crash} ＝ ${n(costPreview.missedFailureHours)} 工时`,
      shortAccounting: `失败损失 ${n(costPreview.missedFailureHours)} 工时`,
      tone: "missed",
    },
    {
      key: "failureFlagged",
      title: "正确预警",
      scope: "hits",
      outcome: "failure",
      meaning: "规则提前识别出了历史渲染失败的任务。",
      accounting: `正确预警节约工时 ${counts.failureFlagged} × (${costs.crash} − ${costs.intercept}) ＝ +${n(costPreview.correctInterceptionNetHours)} 工时`,
      shortAccounting: `节约 ${n(costPreview.correctInterceptionNetHours)} 工时（已扣对应检查）`,
      tone: "rescue",
    },
    {
      key: "successFlagged",
      title: "多余检查",
      scope: "hits",
      outcome: "success",
      meaning: "历史渲染成功，规则仍安排了检查。",
      accounting: `检查工时 ${counts.successFlagged} × ${costs.intercept} ＝ ${n(costPreview.successfulCheckHours)} 工时`,
      shortAccounting: `检查工时 ${n(costPreview.successfulCheckHours)} 工时`,
      tone: "extra",
    },
  ] as const;
  return (
    <section
      className={`rc-panel rc-outcome-matrix${compact ? " rc-outcome-compact" : ""}`}
    >
      <div className="rc-panel-heading">
        <div>
          <h2>{compact ? "20 分钟对照方案：预警结果" : "规则的历史测算"}</h2>
          <p>
            {compact
              ? "正确预警：识别出历史失败；多余检查：历史渲染成功，仍安排检查。"
              : "历史渲染结果与规则预警交叉比较；点击数字查看任务。"}
          </p>
        </div>
        <select
          aria-label="预警结果团队筛选"
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
        onClick={() => {
          if (ledgerDetails.current) ledgerDetails.current.open = true;
          document
            .getElementById("review-cost-ledger")
            ?.scrollIntoView({ block: "start", behavior: "smooth" });
        }}
      >
        <span>
          {compact ? "检查工时" : "检查工时"} <b>{n(costPreview.checkHours)}</b>{" "}
          工时
        </span>
        <span>
          {compact ? "漏掉的失败损失" : "正确预警节约工时"}{" "}
          <b>
            {compact
              ? n(costPreview.missedFailureHours)
              : `+${n(costPreview.correctInterceptionNetHours)}`}
          </b>{" "}
          工时
        </span>
        <span>
          {netLabel(costPreview.netHours)}{" "}
          <b>{n(Math.abs(costPreview.netHours))}</b> 工时
        </span>
        {!compact && <small>查看对照方案计算明细 ↓</small>}
      </button>
      <div className="rc-outcome-grid">
        {cards.map((card) => (
          <button
            key={card.key}
            className={`rc-outcome-card ${card.tone}`}
            aria-label={`查看${card.title}`}
            onClick={() =>
              onShowQueue({ team, scope: card.scope, outcome: card.outcome })
            }
          >
            <span>{card.title}</span>
            <strong data-testid={`quadrant-${card.key}`}>
              {counts[card.key]} <small>个</small>
            </strong>
            {!compact && <p>{card.meaning}</p>}
            <span
              className="rc-quadrant-accounting"
              data-testid={`quadrant-cost-${card.key}`}
            >
              {compact ? card.shortAccounting : card.accounting}
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
        结果未知：
        <button
          onClick={() =>
            onShowQueue({ team, scope: "hits", outcome: "unknown" })
          }
        >
          已预警 {counts.unknownFlagged} 个
        </button>{" "}
        /{" "}
        <button
          onClick={() =>
            onShowQueue({ team, scope: "misses", outcome: "unknown" })
          }
        >
          未预警 {counts.unknownUnflagged} 个
        </button>
        {compact
          ? `；已预警的仍计检查工时 ${n(costPreview.unknownCheckHours)} 工时。`
          : `，不放进成功或失败。已预警的结果未知的任务仍扣 ${n(costPreview.unknownCheckHours)} 工时，不计避免失败收益。`}
      </p>
      {compact ? (
        <details className="rc-inline-details" ref={ledgerDetails}>
          <summary>查看计算明细</summary>
          <ReviewCostLedger
            groups={selectedGroups}
            costs={costs}
            onShowQueue={onShowQueue}
          />
          <p className="rc-policy-note">
            历史测算，不代表已经实际修复。正确预警后按拦截避免本轮崩溃记账；结果未知不计避免失败收益，检查仍计工时。
          </p>
        </details>
      ) : (
        <>
          <ReviewCostLedger
            groups={selectedGroups}
            costs={costs}
            onShowQueue={onShowQueue}
          />
          <p className="rc-policy-note">
            历史测算，不代表已经实际修复。检查、后续处理和重复检查的实际工时需要另行记录。
          </p>
        </>
      )}
    </section>
  );
}
