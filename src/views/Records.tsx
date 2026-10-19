import { useEffect, useState } from "react";
import { CheckCheck, ClipboardList, MessageSquareText } from "lucide-react";
import { number, parameters, useResource } from "../api";
import {
  DataTable,
  ErrorBox,
  ExportLink,
  Loading,
  Pagination,
} from "../components";
import type { Dataset, Row, RowsPage } from "../types";

export default function Records({
  dataset,
  query,
  onOpen,
  revision,
}: {
  dataset: Dataset;
  query: string;
  onOpen: (r: Row) => void;
  revision: number;
}) {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState("");
  const [sort, setSort] = useState(""),
    [direction, setDirection] = useState("asc");
  useEffect(() => setPage(1), [query, status]);
  const url = `/api/datasets/${dataset.id}/rows?${query}&${parameters({ page, status, sort, direction })}`;
  const result = useResource<RowsPage>(url, revision);
  return (
    <div className="view-content">
      <div className="workflow-strip">
        <div>
          <span className="workflow-icon">
            <ClipboardList size={19} />
          </span>
          <span>
            <strong>01 · 找到记录</strong>
            <small>关键词、分类和日期筛选</small>
          </span>
        </div>
        <span className="workflow-line" />
        <div>
          <span className="workflow-icon">
            <MessageSquareText size={19} />
          </span>
          <span>
            <strong>02 · 记录判断</strong>
            <small>点击记录，添加状态与备注</small>
          </span>
        </div>
        <span className="workflow-line" />
        <div>
          <span className="workflow-icon">
            <CheckCheck size={19} />
          </span>
          <span>
            <strong>03 · 跟进处理</strong>
            <small>保存到本地，随结果一起导出</small>
          </span>
        </div>
      </div>
      <section className="panel records-panel">
        <div className="panel-heading">
          <div>
            <h2>
              全部记录{" "}
              {result.data && (
                <span className="count-badge">{number(result.data.total)}</span>
              )}
            </h2>
            <p>点击列名排序，点击记录查看全部字段</p>
          </div>
          <ExportLink
            href={`/api/datasets/${dataset.id}/export?${query}&${parameters({ status })}`}
            label="导出筛选记录"
          />
        </div>
        <div className="status-tabs" role="group" aria-label="处理状态筛选">
          {["", "待处理", "跟进中", "已完成"].map((s) => (
            <button
              key={s}
              className={status === s ? "active" : ""}
              onClick={() => setStatus(s)}
            >
              {s || "全部状态"}
            </button>
          ))}
          <span>处理状态与源文件字段独立保存</span>
        </div>
        {result.error ? (
          <ErrorBox error={result.error} />
        ) : result.loading ? (
          <Loading />
        ) : (
          result.data && (
            <>
              <DataTable
                dataset={dataset}
                rows={result.data.rows}
                annotations
                onOpen={onOpen}
                sort={sort}
                onSort={(field) => {
                  setPage(1);
                  setDirection(
                    sort === field && direction === "asc" ? "desc" : "asc",
                  );
                  setSort(field);
                }}
              />
              <Pagination page={result.data} onChange={setPage} />
            </>
          )
        )}
      </section>
      <div className="note-callout">
        <MessageSquareText size={18} />
        <p>
          <strong>让每条判断都有出处。</strong>{" "}
          备注和处理状态按数据集、记录编号保存，重新打开页面后仍然保留。
        </p>
      </div>
    </div>
  );
}
