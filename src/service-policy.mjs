// Business assumptions, separate from the CSV and the 120/20-hour accounting.
export const KA_TEAM = "KA大客户组";
export const CUSTOM_TEAM = "海外定制组";
export const TEAMS = [KA_TEAM, CUSTOM_TEAM, "国内电商组", "生态服务商组"];
export const DEFAULT_SERVICE_POLICY = Object.freeze({
  kaWeight: 100,
  customWeight: 30,
  noResultMinutes: 10,
});

const bounded = (value, fallback, maximum) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(1, Math.round(value)))
    : fallback;

export function normalizeServicePolicy(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    kaWeight: bounded(source.kaWeight, DEFAULT_SERVICE_POLICY.kaWeight, 500),
    customWeight: bounded(
      source.customWeight,
      DEFAULT_SERVICE_POLICY.customWeight,
      500,
    ),
    noResultMinutes: bounded(
      source.noResultMinutes,
      DEFAULT_SERVICE_POLICY.noResultMinutes,
      30,
    ),
  };
}

export function teamWeight(team, policy) {
  const valid = normalizeServicePolicy(policy);
  return team === KA_TEAM
    ? valid.kaWeight
    : team === CUSTOM_TEAM
      ? valid.customWeight
      : 1;
}

export function isProtectedTeam(team) {
  return team === KA_TEAM || team === CUSTOM_TEAM;
}

// Only viewing order changes. Neither outcomes nor the synthetic SLA simulator
// enter the historical sync rule, candidate search, or physical-hour results.
export function sortHistoricalQueue(rows, policy) {
  return [...rows].sort(
    (a, b) =>
      teamWeight(b.team_id, policy) - teamWeight(a.team_id, policy) ||
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      String(a.job_id).localeCompare(String(b.job_id), "en", { numeric: true }),
  );
}

export function weightedFailureCoverage(groups, policy) {
  const weightedFailures = groups.reduce(
    (sum, g) => sum + g.failed * teamWeight(g.name, policy),
    0,
  );
  const weightedCaught = groups.reduce(
    (sum, g) => sum + g.policy.caughtFailures * teamWeight(g.name, policy),
    0,
  );
  return {
    weightedFailures,
    weightedCaught,
    coverage: weightedFailures ? weightedCaught / weightedFailures : null,
    protectedMissed: groups
      .filter((g) => isProtectedTeam(g.name))
      .reduce((sum, g) => sum + g.failed - g.policy.caughtFailures, 0),
  };
}

// Manual scenario only. elapsedMinutes must come from an observed task age in a
// live integration, never from the historical CSV's sync age or blank outcome.
export function serviceDecision(scenario, policy) {
  const settings = normalizeServicePolicy(policy);
  const base = {
    weight: teamWeight(scenario.team, settings),
    threshold: settings.noResultMinutes,
  };
  const invalid = {
    ...base,
    code: "check-input",
    title: "先确认任务信息",
    owner: "平台支持",
    detail:
      "需要明确的业务组、当前状态及有效的等待时长，暂不判断是否到达核查时限。",
  };
  if (
    !TEAMS.includes(scenario.team) ||
    !["pending", "success", "failure"].includes(scenario.status)
  )
    return invalid;

  if (scenario.status === "success")
    return {
      ...base,
      code: "completed",
      title: "结果已返回，结束无结果跟进",
      owner: "按项目安排验收",
      detail: "不再触发等待核查；渲染成功仍需按项目要求检查质量。",
    };

  const follow = (code, title, detail) =>
    scenario.assigned
      ? {
          ...base,
          code: "in-progress",
          title: "已有人员跟进，继续处理",
          owner: "当前负责人",
          detail:
            "本次演示不重复生成核查建议；继续记录处理进度，直到任务有明确结果。",
        }
      : {
          ...base,
          code,
          title,
          detail,
          owner: "平台支持先核查，必要时转平台研发",
        };

  if (scenario.status === "failure")
    return follow(
      "fault",
      "立即进入故障处理",
      "已明确失败的任务直接交给支持人员定位，无需等待服务时限；普通任务同样处理。",
    );
  if (
    typeof scenario.elapsedMinutes !== "number" ||
    !Number.isFinite(scenario.elapsedMinutes) ||
    scenario.elapsedMinutes < 0
  )
    return invalid;
  if (isProtectedTeam(scenario.team)) {
    if (scenario.elapsedMinutes >= settings.noResultMinutes)
      return follow(
        "follow-up",
        "建议立即安排人工核查",
        `已提交 ${scenario.elapsedMinutes} 分钟仍无结果，达到 ${settings.noResultMinutes} 分钟保障时限。先核对排队、执行进度和错误日志，确认是否需要干预；不自动停止渲染，也不直接要求客户重传。`,
      );
    return {
      ...base,
      code: "watch",
      title: "继续监测，到时主动核查",
      owner: "平台支持监测",
      detail: `尚未达到 ${settings.noResultMinutes} 分钟。若提前报错，立即转故障处理；已有项目检查继续执行。`,
    };
  }
  return {
    ...base,
    code: "existing-process",
    title: "按普通任务既有流程跟进",
    owner: "原服务负责人",
    detail:
      "本次未新增普通任务的无结果时限，不代表取消检查、忽略超时或降低原服务要求。",
  };
}
