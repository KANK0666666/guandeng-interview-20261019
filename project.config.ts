import type { View } from "./src/types";
// 正式任务开始后，先改这个文件，再改选中的模板。
export const project = {
  name: "Fieldwork",
  subtitle: "数据工作台",
  templateMode: true, // 正式交付可改为 false，隐藏模板编号与使用指引。
  // 正式交付时只保留符合业务目标的页面。
  views: ["overview", "records", "diagnostics"] as readonly View[],
  defaultView: "overview" as View,
  titles: {
    overview: "数据概览",
    records: "记录工作台",
    diagnostics: "规则诊断",
  },
  descriptions: {
    overview: "从整体到细节，读懂每一条数据。",
    records: "找到关键记录，记录判断，推进下一步。",
    diagnostics: "设定可解释的规则，把需要关注的记录找出来。",
  },
  demoMapping: { metric: "金额", group: "渠道", date: "日期" },
};
