import { useState } from "react";
import {
  ArrowRight,
  CircleCheck,
  Filter,
  ScanLine,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { number, parameters, percentage, useResource } from "../api";
import {
  DataTable,
  Empty,
  ErrorBox,
  ExportLink,
  Loading,
  Select,
  Stat,
} from "../components";
import type { Dataset, Diagnosis, Mapping, Row, Rule } from "../types";

const operators = [
  { value: "gt", label: "大于 >" },
  { value: "gte", label: "大于等于 ≥" },
  { value: "lt", label: "小于 <" },
  { value: "lte", label: "小于等于 ≤" },
];
export default function Diagnostics({
  dataset,
  mapping,
  query,
  onOpen,
  revision,
}: {
  dataset: Dataset;
  mapping: Mapping;
  query: string;
  onOpen: (r: Row) => void;
  revision: number;
}) {
  const initial = {
    ruleField: dataset.demo ? "处理时长" : mapping.metric,
    op: "gt",
    threshold: dataset.demo ? "48" : "",
  };
  const [draft, setDraft] = useState<Rule>(initial);
  const [rule, setRule] = useState<Rule | null>(dataset.demo ? initial : null);
  const [error, setError] = useState("");
  const result = useResource<Diagnosis>(
    rule
      ? `/api/datasets/${dataset.id}/diagnostics?${query}&${parameters(rule)}`
      : null,
    revision,
  );
  const d = result.data;
  const run = () => {
    if (
      !draft.ruleField ||
      draft.threshold.trim() === "" ||
      !Number.isFinite(Number(draft.threshold))
    ) {
      setError("请选择数值字段，并填写有效的数字阈值。");
      return;
    }
    setError("");
    setRule({ ...draft });
  };
  const changed = rule && JSON.stringify(draft) !== JSON.stringify(rule);
  const percentField =
    dataset.columns.find((c) => c.name === draft.ruleField)?.format ===
    "percent";
  const ruleDescription = d
    ? `${d.field} ${operators.find((o) => o.value === d.op)?.label} ${number(d.threshold, 6)}${d.format === "percent" ? "%" : ""}`
    : "";
  return (
    <div className="view-content">
      <section className="panel rule-builder">
        <div className="panel-heading">
          <div>
            <h2>
              <SlidersHorizontal size={17} />
              设置关注规则
            </h2>
            <p>
              {dataset.demo
                ? "演示规则：处理时长大于 48。该阈值仅用于测试交互。"
                : "根据任务目标设置阈值，核查命中记录。"}
            </p>
          </div>
          <span className="small-tag">可解释规则</span>
        </div>
        <div className="rule-controls">
          <Select
            label="检查字段"
            value={draft.ruleField}
            onChange={(ruleField) => setDraft({ ...draft, ruleField })}
            options={dataset.columns
              .filter((c) => c.type === "number")
              .map((c) => ({ label: c.name, value: c.name }))}
            empty="选择数值字段"
          />
          <Select
            label="比较方式"
            value={draft.op}
            onChange={(op) => setDraft({ ...draft, op })}
            options={operators}
            empty={false}
          />
          <label className="field">
            <span>{percentField ? "阈值（%，12.5 表示 12.5%）" : "阈值"}</span>
            <input
              type="number"
              step="any"
              placeholder="填写业务阈值"
              value={draft.threshold}
              onChange={(e) =>
                setDraft({ ...draft, threshold: e.target.value })
              }
            />
          </label>
          <button className="button button-primary" onClick={run}>
            <ScanLine size={16} />
            运行诊断
            <ArrowRight size={15} />
          </button>
        </div>
        {(error || result.error) && <ErrorBox error={error || result.error} />}
        {changed && (
          <p className="pending-note">
            规则已修改，点击「运行诊断」更新下方结果。
          </p>
        )}
      </section>
      {result.loading ? (
        <Loading />
      ) : d ? (
        <>
          <div className="stats-grid diagnostic-stats">
            <Stat
              label="有效检查记录"
              value={number(d.evaluated)}
              detail={`排除 ${d.excluded} 条空值或非数值记录`}
              icon={<Filter size={18} />}
            />
            <Stat
              label="规则命中"
              value={number(d.matched)}
              detail={ruleDescription}
              icon={<Target size={18} />}
              accent
            />
            <Stat
              label="命中比例"
              value={percentage(d.rate)}
              detail={`${d.matched} ÷ ${d.evaluated} 条有效检查记录`}
              icon={<ScanLine size={18} />}
            />
          </div>
          <div className="diagnosis-explainer">
            <span className="explain-icon">
              <CircleCheck size={20} />
            </span>
            <div>
              <strong>
                {d.matched
                  ? `发现 ${number(d.matched)} 条需要核查的记录`
                  : "当前规则没有命中记录"}
              </strong>
              <p>
                命中表示符合当前阈值。是否异常、原因是什么，以及采取什么措施，需要结合业务背景核实。
              </p>
            </div>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  核查清单{" "}
                  <span className="count-badge">{number(d.matched)}</span>
                </h2>
                <p>
                  当前规则：{ruleDescription} ·
                  表内保留检查值，按偏离阈值程度排序
                </p>
              </div>
              <ExportLink
                href={`/api/datasets/${dataset.id}/export?${query}&${parameters(rule!)}`}
                label="导出核查清单"
              />
            </div>
            <DataTable
              dataset={dataset}
              rows={d.rows}
              onOpen={onOpen}
              compact
              priorityColumns={[d.field]}
            />
            <div className="table-footnote">
              页面最多展示 100 条、6
              个字段，优先保留首列标识和检查字段；导出包含全部命中记录和全部字段。
            </div>
          </section>
        </>
      ) : (
        <section className="panel">
          <Empty title="先定义你要关注的问题">
            例如处理时长超过目标、库存低于阈值。选择真实业务中有意义的指标和阈值，再运行规则。
          </Empty>
        </section>
      )}
    </div>
  );
}
