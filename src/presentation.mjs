const number = (value) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export function netLabel(value) {
  return value < 0 ? "净增加工时" : "净节约工时";
}

export function netText(value) {
  return `${netLabel(value)} ${number(Math.abs(value))}`;
}

export function compactNet(value) {
  return `${value < 0 ? "增加" : "节约"} ${number(Math.abs(value))}`;
}

// A difference from the comparison plan is not the current plan's total loss.
export function comparisonText(current, reference) {
  const checks = current.policy.intercepted - reference.policy.intercepted;
  const failures =
    current.policy.caughtFailures - reference.policy.caughtFailures;
  const net = current.netHours - reference.netHours;
  const checkText =
    checks === 0
      ? "检查次数相同"
      : `${checks > 0 ? "多" : "少"}检查 ${number(Math.abs(checks))} 次`;
  const failureText =
    failures === 0
      ? "正确预警数量相同"
      : `正确预警${failures > 0 ? "多" : "少"} ${number(Math.abs(failures))} 个`;
  const difference =
    net === 0
      ? "工时相同"
      : current.netHours >= 0 && reference.netHours >= 0
        ? `${net > 0 ? "多" : "少"}节省 ${number(Math.abs(net))} 工时`
        : `${net > 0 ? "少" : "多"}消耗 ${number(Math.abs(net))} 工时`;
  return `${checkText}，${failureText}，${difference}。`;
}

export function syncReason(intercept, lagMinutes, threshold) {
  return `同步间隔 ${number(lagMinutes)} 分钟，${intercept ? "达到" : "未达到"} ${threshold} 分钟门槛，${intercept ? "触发预警，建议检查资产同步状态。" : "未触发预警。"}`;
}
