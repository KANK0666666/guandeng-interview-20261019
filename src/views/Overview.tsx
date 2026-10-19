import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  CheckCheck,
  Hash,
  Layers3,
  Sigma,
  TrendingUp,
} from "lucide-react";
import { number, percentage, useResource } from "../api";
import {
  DataTable,
  Empty,
  ErrorBox,
  Loading,
  Quality,
  Stat,
} from "../components";
import type { Dataset, Mapping, Row, RowsPage, Summary } from "../types";

export default function Overview({
  dataset,
  mapping,
  query,
  onOpen,
  onRecords,
  revision,
}: {
  dataset: Dataset;
  mapping: Mapping;
  query: string;
  onOpen: (r: Row) => void;
  onRecords: () => void;
  revision: number;
}) {
  const result = useResource<Summary>(
    `/api/datasets/${dataset.id}/summary?${query}`,
  );
  const preview = useResource<RowsPage>(
    `/api/datasets/${dataset.id}/rows?${query}`,
    revision,
  );
  const [mode, setMode] = useState<"value" | "count">("value");
  const chartKey = mapping.metric ? mode : "count";
  if (result.error) return <ErrorBox error={result.error} />;
  if (!result.data) return <Loading />;
  const s = result.data;
  const maxGroup = Math.max(1, ...s.groups.map((g) => Math.abs(g.value)));
  return (
    <div className="view-content">
      <div className="stats-grid">
        <Stat
          label="记录数量"
          value={number(s.count)}
          detail={`全量 ${number(dataset.rowCount)} 条 · 当前筛选范围`}
          icon={<Layers3 size={17} />}
        />
        <Stat
          label={mapping.metric ? `${mapping.metric}合计` : "数值合计"}
          value={number(s.total, 2)}
          detail={
            mapping.metric
              ? `${number(s.validValues)} 个有效数值参与统计`
              : "选择数值指标后显示"
          }
          icon={<Sigma size={18} />}
          accent
        />
        <Stat
          label={mapping.metric ? `${mapping.metric}均值` : "数值均值"}
          value={number(s.average, 2)}
          detail={
            mapping.metric
              ? `合计 ÷ 有效数值数 · 排除 ${s.excludedValues} 条`
              : "空值和无效值不参与均值计算"
          }
          icon={<Hash size={18} />}
        />
        <Stat
          label="数据完整度"
          value={percentage(s.completeness)}
          detail="当前筛选范围的非空单元格占比"
          icon={<CheckCheck size={18} />}
        />
      </div>
      <div className="chart-grid">
        <section className="panel trend-panel">
          <div className="panel-heading">
            <div>
              <h2>
                数据走势 <span className="live-dot" />
              </h2>
              <p>
                {mapping.date
                  ? `按「${mapping.date}」汇总 · ${chartKey === "count" ? "记录数量" : `${mapping.metric}合计`}`
                  : "选择日期字段，查看随时间变化的趋势"}
              </p>
            </div>
            <div className="segmented">
              <button
                className={chartKey === "value" ? "active" : ""}
                disabled={!mapping.metric}
                onClick={() => setMode("value")}
              >
                数值
              </button>
              <button
                className={chartKey === "count" ? "active" : ""}
                onClick={() => setMode("count")}
              >
                数量
              </button>
            </div>
          </div>
          {mapping.date && s.trend.length ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={s.trend}
                  margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="orange-fill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#e87542"
                        stopOpacity={0.19}
                      />
                      <stop
                        offset="95%"
                        stopColor="#e87542"
                        stopOpacity={0.01}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="#edf0f2"
                    strokeDasharray="4 4"
                  />
                  <XAxis
                    dataKey="name"
                    tickFormatter={(v) => String(v).slice(5).replace("-", "/")}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#9298a3", fontSize: 11 }}
                    minTickGap={32}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#9298a3", fontSize: 11 }}
                    tickFormatter={(v) =>
                      Math.abs(v) >= 1000
                        ? `${number(v / 1000, 1)}k`
                        : String(v)
                    }
                    width={48}
                  />
                  <Tooltip
                    labelFormatter={(label) => String(label)}
                    formatter={(v) => [
                      number(Number(v), 2),
                      chartKey === "count"
                        ? "记录数量"
                        : `${mapping.metric}合计`,
                    ]}
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid #e8e9ed",
                      fontSize: 12,
                    }}
                  />
                  <Area
                    dataKey={chartKey}
                    type="linear"
                    stroke="#e87542"
                    strokeWidth={2.5}
                    fill="url(#orange-fill)"
                    dot={s.trend.length === 1}
                    activeDot={{ r: 5, stroke: "white", strokeWidth: 3 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty
              title={mapping.date ? "当前范围没有日期数据" : "让变化变得可见"}
            >
              在上方选择日期字段，即可生成每日汇总。
            </Empty>
          )}
          <div className="chart-caption">
            <TrendingUp size={14} />
            <span>仅汇总源数据中出现的日期；缺失日期不补零。</span>
          </div>
        </section>
        <section className="panel ranking-panel">
          <div className="panel-heading">
            <div>
              <h2>分组对比</h2>
              <p>
                {mapping.group
                  ? `按「${mapping.group}」分组`
                  : "选择分组维度，比较不同类别"}
              </p>
            </div>
            <span className="small-tag">TOP 8</span>
          </div>
          {mapping.group && s.groups.length ? (
            <div className="rankings">
              {s.groups.map((g, i) => (
                <div className="ranking" key={g.name}>
                  <div className="ranking-label">
                    <span className="rank-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span title={g.name}>{g.name}</span>
                    <strong>{number(g.value, 2)}</strong>
                  </div>
                  <div className="bar-track">
                    <div
                      className={`bar bar-${i % 4}`}
                      style={{
                        width: `${Math.max(0, (Math.abs(g.value) / maxGroup) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="看见不同类别的差异">
              选择分组维度后显示前 8 个分组。
            </Empty>
          )}
          <div className="ranking-footer">
            共 {s.groupCount} 组 · 按
            {mapping.metric ? `${mapping.metric}合计` : "记录数量"}降序取前 8 组
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              数据明细 <span className="count-badge">{number(s.count)}</span>
            </h2>
            <p>从原始记录核对汇总结果</p>
          </div>
          <button className="text-button" onClick={onRecords}>
            打开工作台
            <ArrowRight size={15} />
          </button>
        </div>
        {preview.error ? (
          <ErrorBox error={preview.error} />
        ) : preview.data ? (
          <DataTable
            dataset={dataset}
            rows={preview.data.rows.slice(0, 5)}
            onOpen={onOpen}
            compact
          />
        ) : (
          <Loading />
        )}
        <div className="table-footnote">
          展示当前筛选的前 5 条记录、前 6 个字段。完整数据可在记录工作台查看。
        </div>
      </section>
      <Quality dataset={dataset} />
    </div>
  );
}
