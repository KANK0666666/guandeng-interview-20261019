# Fieldwork · 全栈实战模板

为 30 分钟实战提前准备的三套可运行模板。包含 React 页面、Node.js API、CSV 处理、SQLite 持久化与测试。当前没有真实题目，所有内置数据、阈值和截图都是人工演示，不代表关灯科技的业务或面试结论。

## 启动

推荐 **Node.js 24**，最低 22.13。当前本机已经安装依赖。

```bash
npm ci          # 首次克隆时执行；本机已有依赖可跳过
npm run dev
```

打开 <http://127.0.0.1:4317>。macOS 也可以双击 `启动模板.command`。前后端共用一个端口，页面改动即时刷新；修改 `server/` 后重启进程。

```bash
npm run check  # 数据/API 测试 + TypeScript 检查 + 生产构建
npm run check:all  # 再检查 exam-kit 的 CSV 分析和报告生成
npm start      # 先构建，再以生产模式启动同一个本地服务
```

端口冲突时：`PORT=4318 npm run dev`。本地数据默认写入 `.data/workspace.sqlite`；可用 `DATA_DIR=/absolute/path npm run dev` 创建独立工作区。

## 三套模板

| 模板           | 入口                 | 适合的任务                       | 已完成的闭环                                      |
| -------------- | -------------------- | -------------------------------- | ------------------------------------------------- |
| A · 数据概览   | `/?view=overview`    | 指标分析、趋势、分类比较         | 选字段 → 筛选 → 指标/图表 → 原始记录核对          |
| B · 记录工作台 | `/?view=records`     | 订单、线索、客户、工单等内部工具 | 搜索/排序/分页 → 详情 → 状态/备注持久化 → 导出    |
| C · 规则诊断   | `/?view=diagnostics` | 超时、低库存等明确阈值场景       | 设置规则 → 核对分母与命中数 → 核查记录 → 导出清单 |

三套模板共用上传、筛选和后端。正式任务应选择最能帮助目标用户作决定的一套，再补题目需要的业务逻辑。

另备有 [`exam-kit`](exam-kit/README.md)：用于快速检查 CSV、描述性统计及生成离线报告。根目录执行 `npm run analyze -- --file data/sample_orders.csv` 可跑人工示例；真实文件建议使用绝对路径，再按任务指定指标和分组。两个工具各自记录统计口径，正式答题选定后再统一单位和日期规则。

页面预览：[A · 数据概览](docs/previews/overview.jpg) · [B · 记录工作台](docs/previews/records.jpg) · [C · 规则诊断](docs/previews/diagnostics.jpg)

一条命令只保留指定模板的导航入口；源代码仍保留，随时可切换：

```bash
npm run template -- overview    # 或 records / diagnostics
npm run template -- all         # 恢复三套
```

然后刷新页面。品牌、标题、默认入口、模板提示由 [`project.config.ts`](project.config.ts) 集中配置。正式交付可把 `templateMode` 改为 `false`。

## 用自己的 CSV

1. 点击「导入 CSV」，选择文件或拖拽上传。
2. 检查行数、表头、空值与重复行。
3. 手动选择数值指标、分组维度和日期字段；上传数据不会继承演示订单的字段映射。
4. 调整筛选，核对一条原始记录和一个汇总数字。
5. 若使用诊断页，填写有业务依据的阈值后点击「运行诊断」。

输入支持 UTF-8（含 BOM）或 GB18030；逗号、分号和制表符分隔；引号、逗号字段和多行内容。每份文件上限 **5 MB、20,000 行、80 列**，最多 20 份上传数据加 1 份内置演示。重复/空表头、列数不齐、空文件等会给出错误。

内置订单演示共 168 条。[`examples/库存-人工演示.csv`](examples/库存-人工演示.csv) 使用另一套字段且没有日期，可验证换数据后的行为：库存合计 **52**，均值 **6.5**；规则 `库存 ≤ 2` 命中 **3 / 8 = 37.5%**。

## 统计口径

- 所有 KPI、趋势、规则和导出由后端基于同一份数据计算。关键词搜索、分类和日期条件在服务端执行。
- 非空值至少 90% 可解析为普通数值时，推断为数值列；编号、前导零、超出安全整数范围的值保留为文本。百分号、货币符号和单位不会被擅自转换。
- 数值合计与均值仅使用可解析的值。均值分母为有效数值数量。空值/无效值被排除，并显示数量；不是按零计入。
- 完整度 = 当前筛选范围非空单元格数 / 单元格总数；没有记录时显示 `—`。
- 日期识别支持 `YYYY-MM-DD`、`YYYY/MM/DD` 和 ISO 时间戳。按源字符串的日历日期汇总，不换时区；只展示出现过的日期，不把缺失日期补成零。
- 分组图按数值合计（未选数值时按记录数）取前 8 组。趋势图可独立切换记录数量。
- 规则命中比例 = 命中记录 / 该字段可解析的记录。命中代表符合阈值，不能据此认定原因、风险或建议行动。
- 数据源记录只读。处理状态与备注独立保存，不覆盖原文件里的状态字段。
- 导出包含筛选后的全部记录与全部原始字段，另加 `__处理状态`、`__备注`；同名字段会自动避让。可执行的电子表格公式文本会加单引号，普通负数保留。

## 代码导航

```text
project.config.ts       # 品牌、页面标题、模板选择、演示字段
src/App.tsx             # 页面路由、上传入口、共享筛选状态
src/components.tsx      # 表格、数据源弹窗、记录详情、筛选控件
src/views/Overview.tsx  # 模板 A：指标与图表
src/views/Records.tsx   # 模板 B：列表、排序与处理状态
src/views/Diagnostics.tsx # 模板 C：阈值规则与证据清单
src/styles.css          # 统一视觉样式和响应式布局
server/app.mjs          # HTTP API、校验与导出
server/data.mjs         # CSV、类型推断、筛选、统计、规则
server/store.mjs        # SQLite 存储
server/demo.mjs         # 明确标注的人工演示数据
tests/                  # 数据正确性与完整 API 流程
docs/实战套用说明.md      # 30 分钟执行顺序与交付说明骨架
```

### API

| 方法       | 路径                                 | 用途                                                        |
| ---------- | ------------------------------------ | ----------------------------------------------------------- |
| GET        | `/api/health`                        | 服务状态                                                    |
| GET / POST | `/api/datasets`                      | 列表 / 导入 CSV 原始字节；文件名用 URL 编码的 `X-File-Name` |
| GET        | `/api/datasets/:id/summary`          | 指标、分组和趋势                                            |
| GET        | `/api/datasets/:id/rows`             | 搜索、筛选、排序、分页                                      |
| GET        | `/api/datasets/:id/values?field=...` | 字段值选项，最多 200 项                                     |
| PATCH      | `/api/datasets/:id/rows/:rowId`      | `{ "status": "跟进中", "note": "核查记录" }`                |
| GET        | `/api/datasets/:id/diagnostics`      | `ruleField`、`op`（gt/gte/lt/lte）、`threshold`             |
| GET        | `/api/datasets/:id/export`           | 当前筛选或规则结果，含处理信息                              |
| GET        | `/api/datasets/:id/source`           | 不附加处理信息的数据导出                                    |

共同查询参数：`metric`、`group`、`date`、`q`、`filter`、`value`、`from`、`to`。记录接口另支持 `page`、`sort`、`direction`、`status`。行 ID 为该数据集内从 1 开始的记录序号；内容哈希用于区分上传数据集，因此备注不会串到另一份文件。

## 验证与适用范围

`npm run check` 验证 CSV 编码与语法、数值和日期、空值分母、筛选/排序、规则边界、导出转义、API 错误、状态更新及重开 SQLite 后的持久化。浏览器检查覆盖三套页面、不同字段 CSV 上传、字段映射、备注保存、状态筛选与清单下载。

这是本地单用户模板，默认只监听 `127.0.0.1`。它没有账号/权限管理；CSV 和统计在内存中处理，适合限定大小的面试数据。数值使用 JavaScript Number，若正式题目要求精确货币记账，应改用整数分或十进制定点运算。字体有系统字体回退，不需要任何付费 API 或密钥。

`.data/`、`private-inputs/`、`.env`、依赖和构建目录已加入 Git 忽略。正式任务的公开仓库、题目数据是否可提交、最终业务结论，在拿到真实要求后再确定；当前只准备本地模板。

底层 API 参考：[Node SQLite](https://nodejs.org/api/sqlite.html)、[Vite](https://vite.dev/guide/)、[Express](https://expressjs.com/en/5x/api/)。
