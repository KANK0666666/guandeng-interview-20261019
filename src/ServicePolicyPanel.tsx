import { useState } from "react";
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
  teamWeight,
  weightedFailureCoverage,
  type ServicePolicy,
  type ServiceScenario,
} from "./service-policy.mjs";

type TeamEvidence = {
  name: string;
  failed: number;
  policy: { intercepted: number; caughtFailures: number };
};
type Props = {
  policy: ServicePolicy;
  onChange: (policy: ServicePolicy) => void;
  teams: TeamEvidence[];
  onShowQueue: () => void;
};
const percent = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;

export default function ServicePolicyPanel({
  policy,
  onChange,
  teams,
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
  const update = (patch: Partial<ServicePolicy>) =>
    onChange(normalizeServicePolicy({ ...policy, ...patch }));
  const ranked = [...teams].sort(
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
          <strong>先满足服务保障，再决定关注顺序</strong>
          <p>
            KA
            与定制任务到达无结果时限，就建议安排人工核查。权重再低也不会取消这项保障，普通任务已有的检查继续执行。
          </p>
        </div>
        <span className="rc-pill">业务假设 · 本地演示</span>
      </div>
      <div className="rc-policy-grid">
        <section className="rc-panel">
          <div className="rc-panel-heading">
            <div>
              <h2>
                <SlidersHorizontal size={17} />
                业务关注权重
              </h2>
              <p>普通任务基准为 1；影响清单顺序与历史覆盖评价。</p>
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
          ).map(([key, label, description, hint]) => (
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
            </div>
          ))}
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
          <button className="rc-primary" onClick={onShowQueue}>
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
                <th>同步规则命中任务</th>
                <th>圈到 / 全部已知失败</th>
                <th>未圈到的失败</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((group) => (
                <tr key={group.name}>
                  <td>{group.name}</td>
                  <td>
                    <strong>{teamWeight(group.name, policy)}×</strong>
                  </td>
                  <td>{group.policy.intercepted}</td>
                  <td>
                    {group.policy.caughtFailures} / {group.failed}
                  </td>
                  <td>{group.failed - group.policy.caughtFailures}</td>
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
