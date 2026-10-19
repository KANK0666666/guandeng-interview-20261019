import { useState } from "react";
import RuleOutcomeMatrix from "./RuleOutcomeMatrix";
import {
  Clock3,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  CUSTOM_TEAM,
  DEFAULT_SERVICE_POLICY,
  KA_TEAM,
  TEAMS,
  normalizeServicePolicy,
  serviceDecision,
  serviceImpact,
  teamWeight,
  weightedFailureCoverage,
  type ServicePolicy,
  type ServiceScenario,
  type ImpactGroup,
  type HistoryFilters,
} from "./service-policy.mjs";

type Props = {
  policy: ServicePolicy;
  onChange: (policy: ServicePolicy) => void;
  teams: ImpactGroup[];
  effect: number;
  onEffectChange: (effect: number) => void;
  costs: { crash: number; intercept: number };
  onShowQueue: (filters?: HistoryFilters) => void;
};
const percent = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;
const number = (value: number) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export default function ServicePolicyPanel({
  policy,
  onChange,
  teams,
  effect,
  onEffectChange,
  costs,
  onShowQueue,
}: Props) {
  const [scenario, setScenario] = useState<ServiceScenario>({
    team: KA_TEAM,
    status: "pending",
    elapsedMinutes: 12,
    assigned: false,
  });
  const decision = serviceDecision(scenario, policy);
  const coverage = weightedFailureCoverage(teams, policy);
  const impact = serviceImpact(teams, policy, effect, costs);
  const totals = impact.totals;
  const update = (patch: Partial<ServicePolicy>) =>
    onChange(normalizeServicePolicy({ ...policy, ...patch }));
  const ranked = [...impact.teams].sort(
    (a, b) =>
      teamWeight(b.name, policy) - teamWeight(a.name, policy) ||
      a.name.localeCompare(b.name, "zh-CN"),
  );
  const presets = [
    {
      label: "KA 等待 9 分钟",
      team: KA_TEAM,
      status: "pending" as const,
      elapsedMinutes: 9,
    },
    {
      label: "定制等待 10 分钟",
      team: CUSTOM_TEAM,
      status: "pending" as const,
      elapsedMinutes: 10,
    },
    {
      label: "普通任务已失败",
      team: "国内电商组",
      status: "failure" as const,
      elapsedMinutes: 2,
    },
  ];
  return (
    <div className="rc-service">
      <div className="rc-service-intro">
        <ShieldCheck size={21} />
        <div>
          <strong>提前识别风险，投入人工解决问题</strong>
          <p>
            先看圈到了多少历史失败、漏过多少，再评估核查投入。权重决定关注顺序；KA
            与定制的无结果时限独立保障，普通任务已有的检查继续执行。
          </p>
        </div>
        <span className="rc-pill">业务假设 · 本地演示</span>
      </div>
      <RuleOutcomeMatrix
        groups={teams}
        costs={costs}
        onShowQueue={onShowQueue}
      />
      <section className="rc-panel rc-live-overview">
        <div className="rc-panel-heading">
          <div>
            <h2>扩展情景：实际效果与业务权重</h2>
            <p>
              以下另设有效比例检验结果变化，不改变上方“正确拦截净省
              100”的本轮账。额外人工投入在上方扩展试算另计。
            </p>
          </div>
          <span className="rc-pill">当前假设 {effect}% 有效</span>
        </div>
        <div className="rc-live-cards" aria-live="polite">
          <div>
            <span>情景预计避免失败</span>
            <strong data-testid="expected-avoided">
              {number(totals.expectedAvoidedFailures)} 次
            </strong>
            <small>原规则圈到 {totals.caughtFailures} 个历史失败</small>
          </div>
          <div>
            <span>情景仍未避免的失败</span>
            <strong data-testid="expected-remaining">
              {number(totals.expectedRemainingFailures)} 次
            </strong>
            <small>仅在 {totals.failed} 个已知失败中估算</small>
          </div>
          <div>
            <span>避免失败的加权分</span>
            <strong data-testid="weighted-avoided">
              {number(totals.weightedAvoidedFailures)} 分
            </strong>
            <small>随权重变化 · 不代表工时或续费</small>
          </div>
          <div>
            <span>扩展情景净工时 · {effect}% 有效</span>
            <strong data-testid="service-net-hours">
              {number(totals.netHours)} 工时
            </strong>
            <small>原规则预计避免损失 − 原规则核查成本</small>
          </div>
        </div>
        <p className="rc-live-facts">
          历史结果：成功 {totals.succeeded}、失败 {totals.failed}、未回传{" "}
          {totals.unknown}。 规则命中 {totals.intercepted} 个：失败{" "}
          {totals.caughtFailures}、成功 {totals.falseInterceptions}、未回传{" "}
          {totals.interceptedUnknown}； 漏过{" "}
          {totals.failed - totals.caughtFailures} 个已知失败，按题目核查成本为{" "}
          {number(totals.checkHours)} 工时。
        </p>
        <label className="rc-effect-control">
          <span>
            假设核查后能避免多少原本会发生的失败 <strong>{effect}%</strong>
          </span>
          <input
            aria-label="业务保障假设有效比例"
            type="range"
            min={0}
            max={100}
            step={1}
            value={effect}
            onChange={(event) => onEffectChange(Number(event.target.value))}
          />
          <small>
            不是从数据测得的修复率。改变它会更新失败与工时情景；只改权重不会改变原来的失败事实或核查数量。
          </small>
        </label>
        <p className="rc-policy-note">
          加权分＝Σ（预计避免失败数 × 团队权重），避免一次普通任务失败记 1
          分。它表达业务关注假设，不与工时相减；预计次数可以为小数，不生成新的成功记录。满意度、交付验收和订阅
          / 续费尚无数据。
        </p>
      </section>
      <div className="rc-policy-grid">
        <section className="rc-panel">
          <div className="rc-panel-heading">
            <div>
              <h2>
                <SlidersHorizontal size={17} />
                业务关注权重
              </h2>
              <p>每个滑块下方直接显示该组结果、核查投入和实时试算。</p>
            </div>
            <button
              className="rc-policy-reset"
              onClick={() => onChange({ ...DEFAULT_SERVICE_POLICY })}
            >
              <RotateCcw size={14} />
              恢复默认
            </button>
          </div>
          {(
            [
              [
                "kaWeight",
                "KA",
                "重要客户项目",
                "默认 100 来自你的业务判断，可调整到 500。",
              ],
              [
                "customWeight",
                "定制",
                "潜在 KA / 成交推进项目",
                "默认 30 是待确认的起点；可提高或降低。",
              ],
            ] as const
          ).map(([key, label, description, hint]) => {
            const group = impact.teams.find(
              (item) =>
                item.name === (key === "kaWeight" ? KA_TEAM : CUSTOM_TEAM),
            );
            return (
              <div className="rc-weight-control" key={key}>
                <div className="rc-weight-heading">
                  <label htmlFor={`weight-${key}`}>
                    {label}
                    <small>{description}</small>
                  </label>
                  <div>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      step={1}
                      aria-label={`${label}权重数值`}
                      value={policy[key]}
                      onChange={(event) =>
                        update({ [key]: Number(event.target.value) })
                      }
                    />
                    <span>×</span>
                  </div>
                </div>
                <input
                  id={`weight-${key}`}
                  aria-label={`${label}权重滑块`}
                  type="range"
                  min={1}
                  max={500}
                  step={1}
                  value={policy[key]}
                  onChange={(event) =>
                    update({ [key]: Number(event.target.value) })
                  }
                />
                <div className="rc-range-ends">
                  <span>1</span>
                  <span>500</span>
                </div>
                <p>{hint}</p>
                {group && (
                  <div
                    className="rc-team-feedback"
                    data-testid={`feedback-${key}`}
                  >
                    <small>历史结果 · 点击数量查看真实任务</small>
                    <OutcomeButtons group={group} onShowQueue={onShowQueue} />
                    <p>
                      规则圈到 {group.policy.intercepted} 个任务：失败{" "}
                      {group.policy.caughtFailures}、成功{" "}
                      {group.policy.falseInterceptions}、未回传{" "}
                      {group.policy.interceptedUnknown}。 另漏过{" "}
                      {group.failed - group.policy.caughtFailures} 个历史失败。
                    </p>
                    <div className="rc-team-impact" aria-live="polite">
                      <div>
                        <span>预计避免失败</span>
                        <strong data-testid={`${key}-avoided`}>
                          {number(group.expectedAvoidedFailures)} 次
                        </strong>
                      </div>
                      <div>
                        <span>避免失败的加权分</span>
                        <strong data-testid={`${key}-score`}>
                          {number(group.weightedAvoidedFailures)} 分
                        </strong>
                      </div>
                      <div>
                        <span>原规则核查投入（题目口径）</span>
                        <strong>{number(group.checkHours)} 工时</strong>
                      </div>
                      <div>
                        <span>原规则基准净工时 · {effect}% 有效</span>
                        <strong
                          data-testid={`${key}-net`}
                          className={
                            group.netHours < 0 ? "rc-negative-value" : ""
                          }
                        >
                          {number(group.netHours)} 工时
                        </strong>
                      </div>
                    </div>
                    <p className="rc-impact-formula">
                      {group.policy.caughtFailures} × {costs.crash} × {effect}%
                      − {group.policy.intercepted} × {costs.intercept} ＝{" "}
                      {number(group.netHours)}{" "}
                      工时。只调重要性不会改变这笔人力账，也不能据此撤掉必要检查。
                    </p>
                    <button
                      className="rc-policy-link"
                      onClick={() =>
                        onShowQueue({ team: group.name, scope: "hits" })
                      }
                    >
                      查看这 {group.policy.intercepted} 个命中任务
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div className="rc-baseline-note">
            <strong>普通任务 1×</strong>
            <span>
              国内电商组、生态服务商组作为本次情景基准，不减少既有保障。
            </span>
          </div>
          <p className="rc-policy-note">
            100× 是关注优先级的假设，不代表 100
            倍实际工时、收入或客户数量。当前用业务组代理项目属性；真实项目还需单独确认优先级。设置仅保存在本浏览器。
          </p>
        </section>
        <section className="rc-panel">
          <div className="rc-panel-heading">
            <div>
              <h2>
                <Clock3 size={17} />
                重点项目的主动核查时限
              </h2>
              <p>从任务提交开始计时，等待排队或执行结果。</p>
            </div>
          </div>
          <div className="rc-deadline-number">
            <strong>{policy.noResultMinutes}</strong>
            <span>分钟仍无结果</span>
          </div>
          <input
            aria-label="重点项目无结果核查时限"
            type="range"
            min={1}
            max={30}
            step={1}
            value={policy.noResultMinutes}
            onChange={(event) =>
              update({ noResultMinutes: Number(event.target.value) })
            }
          />
          <div className="rc-range-ends">
            <span>1 分钟</span>
            <span>30 分钟</span>
          </div>
          <ol className="rc-service-steps">
            <li>
              <strong>到时主动跟进</strong>
              <span>KA、定制任务达到时限仍无结果，建议平台支持先核查。</span>
            </li>
            <li>
              <strong>先查执行情况，再决定处理</strong>
              <span>
                检查排队、进度和日志；必要时转研发，不自动中断任务或要求客户重传。
              </span>
            </li>
            <li>
              <strong>有人跟进就避免重复派单</strong>
              <span>
                持续记录处理结果；已明确失败的任务无需等到时限，任何团队都进入故障处理。
              </span>
            </li>
          </ol>
          <div className="rc-clock-note">
            <strong>这里是另一只时钟</strong>
            <p>
              提交后等待结果 {policy.noResultMinutes}{" "}
              分钟，与原规则“提交前距资产同步 ≥20
              分钟”分别判断。同步刚完成的重点项目，也可能需要主动跟进。
            </p>
          </div>
        </section>
      </div>

      <section className="rc-panel rc-service-simulator">
        <div className="rc-panel-heading">
          <div>
            <h2>试一条任务，看看谁需要接手</h2>
            <p>
              以下是人工构造的演示输入，不来自正式数据、不计入分析，也不会真实派人或停止渲染。
            </p>
          </div>
          <span className="rc-pill">情景演示</span>
        </div>
        <div className="rc-policy-presets">
          {presets.map(({ label, ...sample }) => (
            <button
              key={label}
              onClick={() => setScenario({ ...sample, assigned: false })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="rc-service-form">
          <label>
            业务组
            <select
              aria-label="演示业务组"
              value={scenario.team}
              onChange={(event) =>
                setScenario({ ...scenario, team: event.target.value })
              }
            >
              {TEAMS.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            当前任务状态
            <select
              aria-label="演示当前任务状态"
              value={scenario.status}
              onChange={(event) =>
                setScenario({
                  ...scenario,
                  status: event.target.value as ServiceScenario["status"],
                })
              }
            >
              <option value="pending">排队 / 执行中，尚无结果</option>
              <option value="success">已返回成功结果</option>
              <option value="failure">已明确失败</option>
            </select>
          </label>
          <label>
            提交后等待分钟数
            <input
              aria-label="演示等待分钟数"
              type="number"
              min={0}
              step={1}
              value={scenario.elapsedMinutes ?? ""}
              onChange={(event) =>
                setScenario({
                  ...scenario,
                  elapsedMinutes:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                })
              }
            />
          </label>
        </div>
        <label className="rc-owner-checkbox">
          <input
            aria-label="演示已有人员跟进"
            type="checkbox"
            checked={scenario.assigned}
            onChange={(event) =>
              setScenario({ ...scenario, assigned: event.target.checked })
            }
          />
          演示已有人员跟进
        </label>
        <div
          className={`rc-service-decision ${decision.code}`}
          aria-live="polite"
          data-testid="service-decision"
        >
          <div>
            <strong>{decision.title}</strong>
            <span>业务关注权重 {decision.weight}×</span>
          </div>
          <p>{decision.detail}</p>
          <small>
            建议责任人：{decision.owner}。这是处理建议，尚未连接派单系统。
          </small>
        </div>
      </section>

      <section className="rc-panel">
        <div className="rc-panel-heading">
          <div>
            <h2>权重对历史核查清单的影响</h2>
            <p>
              仍为正式数据中的 272
              条同步规则命中任务；下表按权重展示团队顺序，同权重的任务按提交先后排列。
            </p>
          </div>
          <button
            className="rc-primary"
            onClick={() => onShowQueue({ scope: "hits" })}
          >
            查看排序后的历史清单
          </button>
        </div>
        <div className="rc-weight-summary">
          <div>
            <span>按业务权重计的历史失败覆盖</span>
            <strong data-testid="weighted-coverage">
              {percent(coverage.coverage)}
            </strong>
            <small>普通计数覆盖仍为 112 / 134，约 83.6%。</small>
          </div>
          <div>
            <span>重点两组未被同步规则圈到的失败</span>
            <strong>{coverage.protectedMissed} 个</strong>
            <small>KA 5 个、定制 12 个；不能因同步未命中就取消保障。</small>
          </div>
        </div>
        <div className="rc-table-wrap">
          <table aria-label="业务权重与历史覆盖">
            <thead>
              <tr>
                <th>团队</th>
                <th>关注权重</th>
                <th>全部历史结果 · 可查看任务</th>
                <th>同步规则命中任务</th>
                <th>圈到 / 全部已知失败</th>
                <th>未圈到的失败</th>
                <th>原规则净工时 / 加权分</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((group) => (
                <tr key={group.name}>
                  <td>{group.name}</td>
                  <td>
                    <strong>{teamWeight(group.name, policy)}×</strong>
                  </td>
                  <td>
                    <OutcomeButtons group={group} onShowQueue={onShowQueue} />
                  </td>
                  <td>{group.policy.intercepted}</td>
                  <td>
                    {group.policy.caughtFailures} / {group.failed}
                  </td>
                  <td>{group.failed - group.policy.caughtFailures}</td>
                  <td>
                    {number(group.netHours)} 工时
                    <small>
                      {number(group.weightedAvoidedFailures)} 分 · {effect}%
                      有效
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rc-policy-note">
          加权覆盖＝Σ（圈到的已知失败数 × 团队权重）÷ Σ（全部已知失败数 ×
          团队权重）。这是按业务假设重新评价历史覆盖，不能当作修复率。原始任务数、120/20
          工时成本与净工时不乘权重，原来的 20 分钟同步规则也不随滑块变化。
        </p>
      </section>
      <section className="rc-panel rc-service-evidence-gap">
        <h2>这条保障规则还需要什么数据</h2>
        <p>
          正式 CSV 没有观察时刻、完成 /
          回传时间、当前排队或执行状态、负责人和处理记录。51
          个历史“未回传”不能直接视为今天仍在等待，因此不能据此计算有多少任务超时，也不能计算这条新规则省了多少工时。
        </p>
        <p>
          上线需记录任务提交、首次结果、核查触发、负责人、处理动作及各方实际投入。评估设计师返工、客户额外操作、等待与按期交付，同时保留普通任务的服务保障。新增时限先进入试点验证。
        </p>
      </section>
    </div>
  );
}

function OutcomeButtons({
  group,
  onShowQueue,
}: {
  group: ImpactGroup;
  onShowQueue: Props["onShowQueue"];
}) {
  return (
    <div className="rc-outcome-buttons">
      {(
        [
          ["success", "成功", group.succeeded],
          ["failure", "失败", group.failed],
          ["unknown", "未回传", group.unknown],
        ] as const
      ).map(([outcome, label, count]) => (
        <button
          key={outcome}
          className={outcome}
          aria-label={`查看${group.name}历史${label}任务`}
          onClick={() =>
            onShowQueue({ team: group.name, outcome, scope: "all" })
          }
        >
          {label} <strong>{count}</strong>
        </button>
      ))}
    </div>
  );
}
