import { useState } from "react";
import {
  ruleOutcomeBreakdown,
  type HistoryFilters,
  type ImpactGroup,
} from "./service-policy.mjs";

type Props = {
  groups: ImpactGroup[];
  onShowQueue: (filters?: HistoryFilters) => void;
};

export default function RuleOutcomeMatrix({ groups, onShowQueue }: Props) {
  const [team, setTeam] = useState("");
  const counts = ruleOutcomeBreakdown(
    team ? groups.filter((group) => group.name === team) : groups,
  );
  const cards = [
    {
      key: "successUnflagged",
      title: "成功，未触发规则",
      scope: "misses",
      outcome: "success",
      meaning: "历史渲染成功；按规则回放，无需新增这次核查。",
      tone: "smooth",
    },
    {
      key: "failureUnflagged",
      title: "失败，未触发规则",
      scope: "misses",
      outcome: "failure",
      meaning: "规则漏掉的失败，优先调查遗漏原因，减少客户反复重试。",
      tone: "missed",
    },
    {
      key: "failureFlagged",
      title: "失败，被规则圈到",
      scope: "hits",
      outcome: "failure",
      meaning: "提前介入的候选。需要人工核查与处理，验证能否挽救交付。",
      tone: "rescue",
    },
    {
      key: "successFlagged",
      title: "成功，但被规则圈到",
      scope: "hits",
      outcome: "success",
      meaning: "会增加检查投入；新功能、质量验证的价值需要另外记录。",
      tone: "extra",
    },
  ] as const;
  return (
    <section className="rc-panel rc-outcome-matrix">
      <div className="rc-panel-heading">
        <div>
          <h2>成功与失败，规则有没有提前圈到</h2>
          <p>历史结果 × 同步规则回放；点击查看每个真实任务。</p>
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
        ，不放进成功或失败。
      </p>
      <p className="rc-policy-note">
        “被圈到”不等于实际已经拦截、修复或成功交付。数据没有人工介入记录、质量验收、客户满意度或续费结果。更早且准确地发现风险能留出处理时间；客户收益仍需看修复、交期和额外负担的实际变化。
      </p>
    </section>
  );
}
