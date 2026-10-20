// Business assumptions, separate from the CSV and the 120/20-hour accounting.
export const KA_TEAM = "KA大客户组";
export const CUSTOM_TEAM = "海外定制组";
export const TEAMS = [KA_TEAM, CUSTOM_TEAM, "国内电商组", "生态服务商组"];
export const DEFAULT_SERVICE_POLICY = Object.freeze({
  noResultMinutes: null,
  teams: Object.freeze([]),
  enabled: false,
});

export function normalizeServicePolicy(value) {
  const source = value && typeof value === "object" ? value : {};
  const noResultMinutes =
    Number.isSafeInteger(source.noResultMinutes) && source.noResultMinutes > 0
      ? source.noResultMinutes
      : null;
  const teams = Array.isArray(source.teams)
    ? TEAMS.filter((team) => source.teams.includes(team))
    : [];
  return {
    noResultMinutes,
    teams,
    enabled:
      source.enabled === true && noResultMinutes !== null && teams.length > 0,
  };
}

// Stable chronological viewing order, independent of team and outcome.
export function sortHistoricalQueue(rows) {
  return [...rows].sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      String(a.job_id).localeCompare(String(b.job_id), "en", { numeric: true }),
  );
}

export function selectHistoricalTasks(rows, filters = {}) {
  return sortHistoricalQueue(
    rows.filter(
      (row) =>
        (filters.scope !== "hits" || row.intercept) &&
        (filters.scope !== "misses" || !row.intercept) &&
        (!filters.team || row.team_id === filters.team) &&
        (!filters.outcome || row.outcome === filters.outcome) &&
        (!filters.query ||
          `${row.job_id} ${row.scene_type}`.includes(filters.query)),
    ),
  );
}

// Historical outcomes never change. The counterfactual below assumes the same
// effectiveness for each group and cannot establish a causal repair rate.
export function serviceImpact(groups, effectiveness, costs) {
  if (
    !Number.isFinite(effectiveness) ||
    effectiveness < 0 ||
    effectiveness > 100
  )
    throw new RangeError("避免失败比例必须在 0—100% 之间");
  if (
    ![costs.crash, costs.intercept].every((v) => Number.isFinite(v) && v >= 0)
  )
    throw new RangeError("工时口径必须是非负有限值");
  const teams = groups.map((group) => {
    const expectedAvoidedFailures =
      (group.policy.caughtFailures * effectiveness) / 100;
    const checkHours = group.policy.intercepted * costs.intercept;
    const avoidedHours = expectedAvoidedFailures * costs.crash;
    return {
      ...group,
      expectedAvoidedFailures,
      expectedRemainingFailures: group.failed - expectedAvoidedFailures,
      checkHours,
      avoidedHours,
      netHours: avoidedHours - checkHours,
    };
  });
  const totals = {
    jobs: 0,
    succeeded: 0,
    failed: 0,
    unknown: 0,
    intercepted: 0,
    caughtFailures: 0,
    falseInterceptions: 0,
    interceptedUnknown: 0,
    expectedAvoidedFailures: 0,
    expectedRemainingFailures: 0,
    checkHours: 0,
    avoidedHours: 0,
    netHours: 0,
  };
  for (const group of teams) {
    for (const key of Object.keys(totals)) {
      totals[key] += key in group ? group[key] : group.policy[key];
    }
  }
  return { teams, totals };
}

export function ruleOutcomeBreakdown(groups) {
  return groups.reduce(
    (total, group) => ({
      successUnflagged:
        total.successUnflagged +
        group.succeeded -
        group.policy.falseInterceptions,
      failureUnflagged:
        total.failureUnflagged + group.failed - group.policy.caughtFailures,
      failureFlagged: total.failureFlagged + group.policy.caughtFailures,
      successFlagged: total.successFlagged + group.policy.falseInterceptions,
      unknownFlagged: total.unknownFlagged + group.policy.interceptedUnknown,
      unknownUnflagged:
        total.unknownUnflagged +
        group.unknown -
        group.policy.interceptedUnknown,
    }),
    {
      successUnflagged: 0,
      failureUnflagged: 0,
      failureFlagged: 0,
      successFlagged: 0,
      unknownFlagged: 0,
      unknownUnflagged: 0,
    },
  );
}

// Cost ledger uses the same 120/20 accounting for every actual check.
export function reviewCostAccounting(groups, effectiveness, costs) {
  const base = serviceImpact(groups, effectiveness, costs);
  const account = (row, policy) => {
    const baselineFailureHours = row.failed * costs.crash;
    const remainingFailureHours = row.expectedRemainingFailures * costs.crash;
    const eligibleLoss = policy.caughtFailures * costs.crash;
    return {
      ...row,
      successfulCheckHours: policy.falseInterceptions * costs.intercept,
      failedCheckHours: policy.caughtFailures * costs.intercept,
      unknownCheckHours: policy.interceptedUnknown * costs.intercept,
      baselineFailureHours,
      remainingFailureHours,
      totalScenarioHours: remainingFailureHours + row.checkHours,
      breakEvenEffectiveness:
        eligibleLoss > 0 ? row.checkHours / eligibleLoss : null,
      assessment:
        Math.abs(row.netHours) < 1e-8
          ? "equal"
          : row.netHours > 0
            ? "lower"
            : "higher",
    };
  };
  return {
    teams: base.teams.map((group) => account(group, group.policy)),
    totals: account(base.totals, base.totals),
  };
}

// One-round replay: a correct pre-render interception prevents this round's
// crash. Its net saving is crash cost minus interception cost, not zero.
// This is an accounting convention, not evidence of later repair or delivery.
export function interceptionCostAccounting(groups, costs) {
  const ledger = reviewCostAccounting(groups, 100, costs);
  const account = (row, policy) => ({
    ...row,
    correctInterceptionUnitNet: costs.crash - costs.intercept,
    correctInterceptionNetHours:
      policy.caughtFailures * (costs.crash - costs.intercept),
    otherInterceptionHours: row.successfulCheckHours + row.unknownCheckHours,
    missedFailures: row.failed - policy.caughtFailures,
    missedFailureHours: (row.failed - policy.caughtFailures) * costs.crash,
  });
  return {
    teams: ledger.teams.map((row) => account(row, row.policy)),
    totals: account(ledger.totals, ledger.totals),
  };
}

// Additional checks are distinct interventions, not distinct jobs. A second
// actual check on one job is charged again; one check triggered by two rules
// is entered once. Null means unknown, never zero cost or zero benefit.
export function completeStrategyAccounting(base, additions, costs) {
  const fields = [
    ["additionalChecks", "额外提前检查次数", true],
    ["otherHours", "未包含在检查定额中的其他人工工时", false],
    ["additionalAvoidedFailures", "新增避免失败次数", false],
  ];
  const missing = [];
  const errors = [];
  for (const [key, label, integer] of fields) {
    const value = additions[key];
    if (value === null || value === undefined) missing.push(label);
    else if (
      !Number.isFinite(value) ||
      value < 0 ||
      (integer && !Number.isSafeInteger(value))
    )
      errors.push(`${label}须为非负${integer ? "整数" : "数值"}`);
  }
  if (
    additions.additionalAvoidedFailures != null &&
    additions.additionalAvoidedFailures > base.expectedRemainingFailures + 1e-8
  )
    errors.push(
      "新增避免失败数不能超过对照方案尚未避免的已知失败，不能重复计收益",
    );
  if (
    ![costs.crash, costs.intercept].every((v) => Number.isFinite(v) && v >= 0)
  )
    throw new RangeError("工时口径必须是非负有限值");
  if (errors.length)
    return {
      status: "invalid",
      missing,
      errors,
      additionalCheckHours: null,
      totalCostHours: null,
      totalAvoidedHours: null,
      remainingFailureHours: null,
      totalBurdenHours: null,
      netHours: null,
    };
  const additionalCheckHours =
    additions.additionalChecks == null
      ? null
      : additions.additionalChecks * costs.intercept;
  const totalCostHours =
    additionalCheckHours === null || additions.otherHours == null
      ? null
      : base.checkHours + additionalCheckHours + additions.otherHours;
  const totalAvoidedHours =
    additions.additionalAvoidedFailures == null
      ? null
      : base.avoidedHours + additions.additionalAvoidedFailures * costs.crash;
  const remainingFailureHours =
    totalAvoidedHours === null
      ? null
      : base.baselineFailureHours - totalAvoidedHours;
  return {
    status: missing.length ? "incomplete" : "scenario",
    missing,
    errors,
    additionalCheckHours,
    totalCostHours,
    totalAvoidedHours,
    remainingFailureHours,
    totalBurdenHours:
      totalCostHours === null || remainingFailureHours === null
        ? null
        : totalCostHours + remainingFailureHours,
    netHours:
      totalCostHours === null || totalAvoidedHours === null
        ? null
        : totalAvoidedHours - totalCostHours,
  };
}

// Manual scenario only. elapsedMinutes must come from an observed task age in a
// live integration, never from the historical CSV's sync age or blank outcome.
export function serviceDecision(scenario, policy) {
  const settings = normalizeServicePolicy(policy);
  const base = {
    threshold: settings.noResultMinutes,
  };
  if (!settings.enabled)
    return {
      ...base,
      code: "disabled",
      title: "人工跟进规则未启用",
      owner: "由负责人配置",
      detail: "选择适用团队并填写跟进时限，保存后可进行人工模拟。",
    };
  const invalid = {
    ...base,
    code: "check-input",
    title: "请填写模拟任务",
    owner: "平台支持",
    detail: "选择团队和当前状态；尚无结果的任务还需要填写已等待时间。",
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
      title: "渲染成功，无需等待跟进",
      owner: "按项目安排验收",
      detail: "模拟任务已有成功结果，不触发这次人工跟进。",
    };

  const follow = (code, title, detail) =>
    scenario.assigned
      ? {
          ...base,
          code: "in-progress",
          title: "已有人员跟进，继续处理",
          owner: "当前负责人",
          detail: "由当前负责人继续处理，避免重复安排检查。",
        }
      : {
          ...base,
          code,
          title,
          detail,
          owner: "平台支持先检查，必要时转研发",
        };

  if (scenario.status === "failure")
    return follow(
      "fault",
      "立即进入故障处理",
      "渲染已经失败，建议直接处理故障；所有团队适用，无需等待跟进时限。",
    );
  if (
    typeof scenario.elapsedMinutes !== "number" ||
    !Number.isFinite(scenario.elapsedMinutes) ||
    scenario.elapsedMinutes < 0
  )
    return invalid;
  if (settings.teams.includes(scenario.team)) {
    if (scenario.elapsedMinutes >= settings.noResultMinutes)
      return follow(
        "follow-up",
        "建议安排人工检查",
        `已等待 ${scenario.elapsedMinutes} 分钟，达到配置的 ${settings.noResultMinutes} 分钟跟进时限。建议检查排队、执行进度和错误日志。`,
      );
    return {
      ...base,
      code: "watch",
      title: "尚未达到跟进时限",
      owner: "平台支持监测",
      detail: `已等待 ${scenario.elapsedMinutes} 分钟，配置的跟进时限为 ${settings.noResultMinutes} 分钟。`,
    };
  }
  return {
    ...base,
    code: "existing-process",
    title: "此团队不在配置范围内",
    owner: "原服务负责人",
    detail: "本条等待规则不适用，继续按该团队已有流程处理。",
  };
}
