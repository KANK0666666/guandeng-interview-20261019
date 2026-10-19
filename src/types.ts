export type View = "overview" | "records" | "diagnostics";
export type Column = {
  name: string;
  type: "number" | "date" | "text";
  format?: "number" | "percent";
  warning?: string;
  missing: number;
  invalid: number;
  unique: number;
  examples: string[];
};
export type Dataset = {
  id: string;
  name: string;
  demo: boolean;
  importedAt: string;
  encoding: string;
  rowCount: number;
  headers: string[];
  columns: Column[];
  emptyCells: number;
  duplicateRows: number;
  completeness: number;
};
export type Mapping = { metric: string; group: string; date: string };
export type Workspace = {
  task: {
    datasetId: string;
    revision: string;
    mapping: Mapping;
    filters: Filters;
    rule: Rule | null;
    view: View;
    sourceSha256: string;
  } | null;
};
export type Filters = {
  q: string;
  filter: string;
  value: string;
  from: string;
  to: string;
};
export type Note = { status: string; note: string; updatedAt: string };
export type Row = {
  id: string;
  data: Record<string, string>;
  note?: Note | null;
};
export type RowsPage = {
  rows: Row[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
};
export type Summary = {
  count: number;
  metric: string;
  metricFormat: "number" | "percent";
  aggregation: "sum" | "mean" | "count";
  total: number | null;
  average: number | null;
  validValues: number;
  excludedValues: number;
  completeness: number | null;
  groupCount: number;
  groups: {
    name: string;
    count: number;
    value: number | null;
    validValues: number;
    excludedValues: number;
  }[];
  trend: {
    name: string;
    count: number;
    value: number | null;
    validValues: number;
    excludedValues: number;
  }[];
};
export type Rule = { ruleField: string; op: string; threshold: string };
export type Diagnosis = {
  field: string;
  op: string;
  threshold: number;
  format: "number" | "percent";
  evaluated: number;
  excluded: number;
  matched: number;
  rate: number | null;
  rows: Row[];
};
