import test from "node:test";
import assert from "node:assert/strict";
import { comparisonText, compactNet, netText } from "../src/presentation.mjs";

const plan = (checks, failures, netHours) => ({
  policy: { intercepted: checks, caughtFailures: failures },
  netHours,
});
test("negative savings are presented as added hours, not a negative saving", () => {
  assert.equal(netText(-640), "净增加工时 640");
  assert.equal(compactNet(-640), "增加 640");
  assert.equal(netText(1080), "净节约工时 1,080");
  assert.equal(netText(0), "净节约工时 0");
});
test("KA comparison distinguishes less saving from a loss and works both ways", () => {
  const ka9 = plan(150, 34, 1080);
  const reference = plan(62, 33, 2720);
  assert.equal(
    comparisonText(ka9, reference),
    "多检查 88 次，正确预警多 1 个，少节省 1,640 工时。",
  );
  assert.equal(
    comparisonText(reference, ka9),
    "少检查 88 次，正确预警少 1 个，多节省 1,640 工时。",
  );
  assert.equal(
    comparisonText(reference, reference),
    "检查次数相同，正确预警数量相同，工时相同。",
  );
});
test("comparison remains meaningful when either or both plans add hours", () => {
  const extraCost = plan(134, 17, -640);
  const reference = plan(69, 13, 180);
  assert.match(comparisonText(extraCost, reference), /多消耗 820 工时/);
  assert.match(comparisonText(reference, extraCost), /少消耗 820 工时/);
  assert.match(
    comparisonText(plan(200, 17, -1960), extraCost),
    /多消耗 1,320 工时/,
  );
});
