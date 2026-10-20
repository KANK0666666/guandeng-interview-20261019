export function netLabel(value: number): string;
export function netText(value: number): string;
export function compactNet(value: number): string;
export function comparisonText(
  current: {
    policy: { intercepted: number; caughtFailures: number };
    netHours: number;
  },
  reference: {
    policy: { intercepted: number; caughtFailures: number };
    netHours: number;
  },
): string;
export function syncReason(
  intercept: boolean,
  lagMinutes: number,
  threshold: number,
): string;
