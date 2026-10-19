import { parseCsv, csvExport } from "./data.mjs";

// 完全人工生成，仅用于检验模板交互，不代表面试数据或真实经营情况。
export function makeDemo() {
  const channels = ["自然搜索", "内容社区", "直接访问", "付费推广"];
  const regions = ["华东", "华南", "华北", "西南"];
  const headers = [
    "订单编号",
    "日期",
    "客户",
    "渠道",
    "区域",
    "金额",
    "处理时长",
    "订单状态",
  ];
  const rows = Array.from({ length: 168 }, (_, i) => {
    const date = 1 + Math.floor(i / 6);
    return {
      订单编号: `DEMO-${String(i + 1).padStart(4, "0")}`,
      日期: `2026-09-${String(date).padStart(2, "0")}`,
      客户: `演示客户 ${String((i % 37) + 1).padStart(2, "0")}`,
      渠道: channels[(i * 7 + Math.floor(i / 9)) % 4],
      区域: regions[(i + Math.floor(i / 5)) % 4],
      金额: String(180 + ((i * 137) % 1350) + date * 14),
      处理时长: i % 29 === 0 ? "" : String(1 + ((i * 11) % 65)),
      订单状态: ["已完成", "已完成", "已完成", "处理中", "待确认"][i % 5],
    };
  });
  const dataset = parseCsv(
    Buffer.from(csvExport(headers, rows)),
    "演示订单.csv",
  );
  dataset.id = "demo-orders-v1";
  dataset.demo = true;
  dataset.importedAt = "2026-09-29T00:00:00.000Z";
  return dataset;
}
