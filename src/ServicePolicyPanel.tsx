import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import "./service-policy.css";
import {
  TEAMS,
  normalizeServicePolicy,
  serviceDecision,
  type ServicePolicy,
  type ServiceScenario,
} from "./service-policy.mjs";

type Props = {
  policy: ServicePolicy;
  onChange: (policy: ServicePolicy) => void;
};
export default function ServicePolicyPanel({ policy, onChange }: Props) {
  const [minutes, setMinutes] = useState(
    policy.noResultMinutes === null ? "" : String(policy.noResultMinutes),
  );
  const [teams, setTeams] = useState<readonly string[]>(policy.teams);
  const [scenario, setScenario] = useState<ServiceScenario>({
    team: "",
    status: "",
    elapsedMinutes: null,
    assigned: false,
  });
  useEffect(() => {
    setMinutes(
      policy.noResultMinutes === null ? "" : String(policy.noResultMinutes),
    );
    setTeams(policy.teams);
  }, [policy]);
  const draft = normalizeServicePolicy({
    noResultMinutes: minutes === "" ? null : Number(minutes),
    teams,
    enabled: true,
  });
  const dirty =
    draft.noResultMinutes !== policy.noResultMinutes ||
    draft.teams.join("|") !== policy.teams.join("|");
  const decision = serviceDecision(scenario, policy);
  return (
    <div className="rc-service rc-service-focused">
      <p className="rc-detail-intro">
        由负责人选择适用团队和跟进时限。这里只配置并模拟建议，不会真实派单。
      </p>
      <div className="rc-followup-config">
        <fieldset>
          <legend>适用团队</legend>
          <div className="rc-followup-teams">
            {TEAMS.map((team) => (
              <label key={team}>
                <input
                  type="checkbox"
                  checked={teams.includes(team)}
                  onChange={(event) =>
                    setTeams(
                      event.target.checked
                        ? [...teams, team]
                        : teams.filter((item) => item !== team),
                    )
                  }
                />
                {team}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="rc-followup-minutes">
          跟进时限（分钟）
          <input
            aria-label="跟进时限（分钟）"
            type="number"
            min={1}
            step={1}
            placeholder="由负责人填写"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
          <small>
            {minutes !== "" && draft.noResultMinutes === null
              ? "请填写大于 0 的整数分钟。"
              : "从任务提交开始计时，仍无结果时提醒检查。"}
          </small>
        </label>
      </div>
      <div className="rc-followup-actions">
        <button
          className="rc-primary"
          disabled={!draft.enabled || (!dirty && policy.enabled)}
          onClick={() => onChange(draft)}
        >
          保存并用于模拟
        </button>
        {policy.enabled && (
          <button
            className="rc-policy-reset"
            onClick={() => onChange({ ...policy, enabled: false })}
          >
            停用模拟规则
          </button>
        )}
        {(minutes !== "" || teams.length > 0) && (
          <button
            className="rc-policy-reset"
            onClick={() => onChange(normalizeServicePolicy(null))}
          >
            清空配置
          </button>
        )}
        <span role="status">
          {dirty
            ? "配置尚未保存"
            : policy.enabled
              ? "已配置 · 仅用于模拟"
              : policy.noResultMinutes === null || policy.teams.length === 0
                ? "待配置 · 未启用"
                : "已停用"}
        </span>
      </div>
      <details className="rc-panel rc-service-disclosure rc-service-simulator">
        <summary>
          <span>
            <strong>人工模拟</strong>
            <small>填写任务信息，查看这条规则的建议</small>
          </span>
          <ChevronDown size={18} />
        </summary>
        <div className="rc-disclosure-body">
          <div className="rc-service-form">
            <label>
              团队
              <select
                aria-label="模拟团队"
                value={scenario.team}
                onChange={(event) =>
                  setScenario({ ...scenario, team: event.target.value })
                }
              >
                <option value="">请选择</option>
                {TEAMS.map((team) => (
                  <option key={team}>{team}</option>
                ))}
              </select>
            </label>
            <label>
              当前状态
              <select
                aria-label="模拟任务状态"
                value={scenario.status}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    status: event.target.value as ServiceScenario["status"],
                  })
                }
              >
                <option value="">请选择</option>
                <option value="pending">排队或执行中，尚无结果</option>
                <option value="success">渲染成功</option>
                <option value="failure">渲染失败</option>
              </select>
            </label>
            <label>
              已等待时间（分钟）
              <input
                aria-label="模拟已等待时间（分钟）"
                type="number"
                min={0}
                value={scenario.elapsedMinutes ?? ""}
                placeholder="手动填写"
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
              type="checkbox"
              checked={scenario.assigned}
              onChange={(event) =>
                setScenario({ ...scenario, assigned: event.target.checked })
              }
            />
            模拟已有人员跟进
          </label>
          <div
            className={`rc-service-decision ${dirty ? "check-input" : decision.code}`}
            aria-live="polite"
            data-testid="service-decision"
          >
            <strong>{dirty ? "请先保存配置" : decision.title}</strong>
            <p>{dirty ? "保存后，再按新配置进行模拟。" : decision.detail}</p>
            {!dirty && !["disabled", "check-input"].includes(decision.code) && (
              <small>建议接手：{decision.owner}</small>
            )}
          </div>
        </div>
      </details>
      <p className="rc-page-note">
        实际触发次数与新增检查工时：暂无数据。CSV
        缺少完成时间和跟进记录；模拟不计入历史测算。
      </p>
    </div>
  );
}
