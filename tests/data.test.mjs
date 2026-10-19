import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import {
  parseCsv,
  numeric,
  day,
  summarize,
  pageRows,
  diagnose,
  metadata,
  csvExport,
} from "../server/data.mjs";

const fixture = () =>
  parseCsv(
    Buffer.from(
      "编号,日期,渠道,金额,时长\n001,2026-09-01,搜索,10,2\n002,2026-09-01,内容,20,5\n003,2026-09-02,搜索,,8\n004,2026-09-02,内容,30,\n",
    ),
    "测试.csv",
  );
test("quoted CSV, UTF-8 BOM, multiline text and identifiers are preserved", () => {
  const d = parseCsv(
    Buffer.from(
      '\uFEFF编号,说明,金额\r\n001,"第一行\n第二行,带逗号",0\r\n002,"双""引号",-2.5',
    ),
  );
  assert.equal(d.rows[0].编号, "001");
  assert.equal(d.rows[0].说明, "第一行\n第二行,带逗号");
  assert.equal(d.rows[1].说明, '双"引号');
  assert.equal(d.columns[0].type, "text");
  assert.equal(d.columns[2].type, "number");
  const single = parseCsv(Buffer.from('"姓名,名称"\n"甲,乙"'));
  assert.equal(single.headers.length, 1);
  assert.equal(single.rows[0]["姓名,名称"], "甲,乙");
});
test("bad schemas, empty datasets, oversized files and inconsistent rows fail explicitly", () => {
  for (const csv of [
    "",
    "a,b",
    "a,a\n1,2",
    "a,\n1,2",
    "a,b\n1,2,3",
    'a,b\n"broken,2',
  ])
    assert.throws(() => parseCsv(Buffer.from(csv)));
  assert.throws(() => parseCsv(Buffer.alloc(5 * 1024 * 1024 + 1)));
  assert.throws(() => parseCsv(Buffer.from("a\n" + "1\n".repeat(20001))));
});
test("tab/semicolon delimiters and GB18030 are supported", () => {
  assert.deepEqual(parseCsv(Buffer.from("a;b\n1;2")).headers, ["a", "b"]);
  assert.deepEqual(parseCsv(Buffer.from("a\tb\n1\t2")).headers, ["a", "b"]);
  const d = parseCsv(Buffer.from("bdf0b6ee2cb1e0bac50a31302c303031", "hex"));
  assert.deepEqual(d.headers, ["金额", "编号"]);
  assert.equal(d.encoding, "GB18030");
});
test("numeric/date inference does not reinterpret identifiers, blanks, percentages or invalid dates", () => {
  for (const text of [
    "",
    "001",
    "12%",
    "￥20",
    "1,2",
    "Infinity",
    "1e400",
    "9007199254740992",
  ])
    assert.equal(numeric(text), null, text);
  assert.equal(numeric("1,200.5"), 1200.5);
  assert.equal(numeric("-2.5"), -2.5);
  assert.equal(day("2026-02-30"), null);
  assert.equal(day("2026-09-01T99:99:00Z"), null);
  assert.equal(day("2026/09/01"), "2026-09-01");
  assert.equal(day("09/01/26"), null);
});
test("summaries use valid denominators and retain zero-result semantics", () => {
  const d = fixture();
  const s = summarize(
    d,
    new URLSearchParams({ metric: "金额", group: "渠道", date: "日期" }),
  );
  assert.equal(s.count, 4);
  assert.equal(s.total, 60);
  assert.equal(s.average, 20);
  assert.equal(s.validValues, 3);
  assert.equal(s.excludedValues, 1);
  assert.equal(s.completeness, 0.9);
  assert.deepEqual(
    s.groups.map((g) => [g.name, g.value, g.count]),
    [
      ["内容", 50, 2],
      ["搜索", 10, 2],
    ],
  );
  assert.deepEqual(
    s.trend.map((g) => g.value),
    [30, 30],
  );
  const none = summarize(
    d,
    new URLSearchParams({ metric: "金额", q: "不存在" }),
  );
  assert.equal(none.count, 0);
  assert.equal(none.average, null);
  assert.equal(none.completeness, null);
  assert.equal(none.total, null);
});
test("missing group/day values stay unknown while true zero and negative values remain numeric", () => {
  const d = parseCsv(
    Buffer.from(
      "日期,渠道,金额\n2026-10-01,A,10\n2026-10-02,B,\n2026-10-03,C,0\n2026-10-04,D,-5",
    ),
  );
  const s = summarize(
    d,
    new URLSearchParams({ metric: "金额", group: "渠道", date: "日期" }),
  );
  assert.deepEqual(
    s.groups.map((g) => [g.name, g.value]),
    [
      ["A", 10],
      ["C", 0],
      ["D", -5],
      ["B", null],
    ],
  );
  assert.deepEqual(
    s.trend.map((g) => g.value),
    [10, null, 0, -5],
  );
  assert.equal(s.groups[3].validValues, 0);
  assert.equal(s.groups[3].excludedValues, 1);
  const blank = summarize(
    d,
    new URLSearchParams({ metric: "金额", filter: "渠道", value: "B" }),
  );
  assert.equal(blank.total, null);
  assert.equal(blank.average, null);
  const counts = summarize(
    d,
    new URLSearchParams({ group: "渠道", date: "日期" }),
  );
  assert.deepEqual(
    counts.trend.map((g) => g.value),
    [1, 1, 1, 1],
  );
});
test("invalid numeric values do not manufacture a zero-only group", () => {
  const d = parseCsv(
    Buffer.from("渠道,金额\n" + "A,10\n".repeat(9) + "B,未知"),
  );
  const s = summarize(
    d,
    new URLSearchParams({ metric: "金额", group: "渠道" }),
  );
  assert.equal(d.columns[1].invalid, 1);
  assert.equal(s.groups[1].value, null);
});
test("percent columns retain source text and produce means without summed rates", () => {
  const d = parseCsv(
    Buffer.from(
      "日期,渠道,转化率\n20261001,A,12.5%\n20261001,A,7.5％\n20261002,B,0%\n20261003,C,",
    ),
  );
  assert.equal(d.rows[0].转化率, "12.5%");
  assert.equal(d.columns[0].type, "date");
  assert.equal(d.columns[2].format, "percent");
  assert.equal(numeric("12.5%", "percent"), 0.125);
  assert.equal(numeric("12.5", "percent"), null);
  const s = summarize(
    d,
    new URLSearchParams({ metric: "转化率", group: "渠道", date: "日期" }),
  );
  assert.equal(s.total, null);
  assert.equal(s.aggregation, "mean");
  assert.equal(s.average, 0.2 / 3);
  assert.deepEqual(
    s.groups.map((g) => [g.name, g.value]),
    [
      ["A", 0.1],
      ["B", 0],
      ["C", null],
    ],
  );
  assert.deepEqual(
    s.trend.map((g) => g.value),
    [0.1, 0, null],
  );
  assert.equal(s.validValues, 3);
  assert.equal(s.excludedValues, 1);
});
test("mixed percentage units remain text with an actionable warning", () => {
  const d = parseCsv(Buffer.from("渠道,转化率\nA,12.5%\nB,0.125"));
  assert.equal(d.columns[1].type, "text");
  assert.match(d.columns[1].warning, /混用/);
  assert.equal(d.rows[1].转化率, "0.125");
  assert.throws(() => summarize(d, new URLSearchParams({ metric: "转化率" })));
});
test("percentage diagnostics, sorting and exports use consistent units", () => {
  const d = parseCsv(Buffer.from("渠道,转化率\nA,2%\nB,12.5%\nC,9%\nD,"));
  const result = diagnose(
    d,
    new URLSearchParams({ ruleField: "转化率", op: "gte", threshold: "12.5" }),
  );
  assert.equal(result.format, "percent");
  assert.equal(result.threshold, 12.5);
  assert.equal(result.evaluated, 3);
  assert.equal(result.excluded, 1);
  assert.deepEqual(
    result.rows.map((r) => r.id),
    ["2"],
  );
  assert.deepEqual(
    pageRows(
      d,
      new URLSearchParams({ sort: "转化率", direction: "desc" }),
    ).rows.map((r) => r.id),
    ["2", "3", "1", "4"],
  );
  const exported = parse(csvExport(["百分比"], [{ 百分比: "-12.5%" }]), {
    bom: true,
    columns: true,
  });
  assert.equal(exported[0].百分比, "-12.5%");
});
test("calendar dates and explicit timezones normalize consistently without guessing timestamp units", () => {
  assert.equal(day("20261001"), "2026-10-01");
  assert.equal(day("202610"), "2026-10-01");
  assert.equal(day("2026"), "2026-01-01");
  assert.equal(day("2026/10"), "2026-10-01");
  assert.equal(day("2026-10-01 10:30:00"), "2026-10-01");
  assert.equal(day("2026-10-01T00:30:00+08:00"), "2026-09-30");
  assert.equal(day("20260230"), null);
  assert.equal(day("2026-02-30 10:30:00"), null);
  assert.equal(day("2026-10-01 24:00:00"), null);
  assert.equal(day("1790812800"), null);
  assert.equal(day("46000"), null);
  const d = parseCsv(
    Buffer.from(
      "日期,金额\n20261002,10\n2026-10-01 10:30:00,20\n2026-10-01T00:30:00+08:00,30",
    ),
  );
  assert.equal(d.columns[0].type, "date");
  assert.deepEqual(
    pageRows(d, new URLSearchParams({ sort: "日期" })).rows.map((r) => r.id),
    ["3", "2", "1"],
  );
  const s = summarize(
    d,
    new URLSearchParams({
      metric: "金额",
      date: "日期",
      from: "20261001",
      to: "20261002",
    }),
  );
  assert.equal(s.total, 30);
  assert.equal(s.count, 2);
});
test("date detection protects IDs and ordinary numeric columns, and reports invalid dates", () => {
  const d = parseCsv(
    Buffer.from(
      "用户ID,orderId,金额,processing_time,日期\n20261001,20261001,20261001,12,20261001\n20261002,20261002,20261002,24,20261002",
    ),
  );
  assert.deepEqual(
    d.columns.map((c) => c.type),
    ["text", "text", "number", "number", "date"],
  );
  const invalid = parseCsv(
    Buffer.from("日期,金额\n" + "20261001,10\n".repeat(9) + "20260230,10"),
  );
  assert.equal(invalid.columns[0].type, "date");
  assert.equal(invalid.columns[0].invalid, 1);
  const s = summarize(
    invalid,
    new URLSearchParams({ date: "日期", metric: "金额" }),
  );
  assert.equal(s.count, 10);
  assert.equal(s.trend[0].count, 9);
});
test("search, exact groups, inclusive dates, empty filters and input validation", () => {
  const d = fixture();
  const s = summarize(
    d,
    new URLSearchParams({
      metric: "金额",
      filter: "渠道",
      value: "内容",
      date: "日期",
      from: "2026-09-02",
      to: "2026-09-02",
    }),
  );
  assert.equal(s.count, 1);
  assert.equal(s.total, 30);
  assert.equal(
    summarize(d, new URLSearchParams({ filter: "时长", value: "" })).count,
    1,
  );
  assert.equal(summarize(d, new URLSearchParams({ q: "001" })).count, 1);
  assert.throws(() => summarize(d, new URLSearchParams({ metric: "不存在" })));
  assert.throws(() =>
    summarize(d, new URLSearchParams({ from: "2026-10-01", to: "2026-09-01" })),
  );
});
test("rules exclude missing values, keep equality semantics and sort evidence", () => {
  const d = fixture();
  const result = diagnose(
    d,
    new URLSearchParams({ ruleField: "时长", op: "gte", threshold: "5" }),
  );
  assert.equal(result.evaluated, 3);
  assert.equal(result.excluded, 1);
  assert.equal(result.matched, 2);
  assert.equal(result.rate, 2 / 3);
  assert.deepEqual(
    result.rows.map((r) => r.id),
    ["3", "2"],
  );
  assert.equal(
    diagnose(
      d,
      new URLSearchParams({ ruleField: "时长", op: "gt", threshold: "5" }),
    ).matched,
    1,
  );
  assert.throws(() =>
    diagnose(d, new URLSearchParams({ ruleField: "时长", threshold: "" })),
  );
  assert.throws(() =>
    diagnose(
      d,
      new URLSearchParams({ ruleField: "时长", threshold: "5", op: "bogus" }),
    ),
  );
});
test("notes are independent from original rows, numeric sort and status pagination agree", () => {
  const d = fixture(),
    notes = { 2: { status: "已完成", note: "核查完成" } };
  const sorted = pageRows(
    d,
    new URLSearchParams({ sort: "金额", direction: "desc", page: "100" }),
    notes,
  );
  assert.deepEqual(
    sorted.rows.map((r) => r.id),
    ["4", "2", "1", "3"],
  );
  assert.equal(sorted.page, 1);
  const done = pageRows(d, new URLSearchParams({ status: "已完成" }), notes);
  assert.equal(done.total, 1);
  assert.equal(done.rows[0].id, "2");
  assert.equal(d.rows[1].状态, undefined);
});
test("CSV export round trips quotes/newlines and neutralizes spreadsheet formulas", () => {
  const rows = [
    { a: '=HYPERLINK("x")', b: 'line\n"quote"', c: "-12.5" },
    { a: "  @SUM(1)", b: "中文", c: "+cmd" },
  ];
  const csv = csvExport(["a", "b", "c"], rows);
  const parsed = parse(csv, { bom: true, columns: true });
  assert.equal(parsed[0].a, '\'=HYPERLINK("x")');
  assert.equal(parsed[0].b, rows[0].b);
  assert.equal(parsed[0].c, "-12.5");
  assert.equal(parsed[1].a, "'  @SUM(1)");
  assert.equal(parsed[1].c, "'+cmd");
});
test("unusual header names and full-row duplicate checks remain safe", () => {
  const d = parseCsv(Buffer.from("__proto__,constructor,金额\nx,y,10\nx,y,10"));
  assert.equal(d.rows[0].__proto__, "x");
  assert.equal(metadata(d).duplicateRows, 1);
  assert.equal(summarize(d, new URLSearchParams({ metric: "金额" })).total, 20);
});
