# Fieldwork · 全栈实战模板

为 30 分钟实战提前准备的三套可运行模板。包含 React 页面、Node.js API、CSV 处理、SQLite 持久化与测试。当前没有真实题目，所有内置数据、阈值和截图都是人工演示，不代表关灯科技的业务或面试结论。

## 正式交付要求

已于 2026-10-19 创建并关联正式公开仓库：[KANK0666666/guandeng-interview-20261019](https://github.com/KANK0666666/guandeng-interview-20261019)，本项目远端名为 `origin`。考前仅建立空仓库，已验证公开访问与推送权限；正式作答后推送交付版本，再在任务页提交地址。

本 README 当前是考前模板说明。收到正式任务书与发放的 CSV 后，需在**仓库根目录**写明：**我的判断（看到了什么、根问题是什么）、做了什么、怎么证明有用**。引用的业务数字必须能由发放的数据算出，并附脚本或复现步骤；人工演示和测试数据不能作为业务结论依据。

根目录另有 [`AI_LOG.md`](AI_LOG.md)，目前记录可核实的考前 AI 交互；正式作答时继续记录关键提示词、AI 的错误以及实际修正。AI_LOG 不能只用 README 中的一段“AI 使用说明”替代。

提交顺序是：**完成代码与文档 → 推送 GitHub → 在任务页面提交仓库地址 → 确认回执**。之后再推送的改动，必须重新提交地址才计入。主评分以开始后 30 分钟加 5 分钟宽限内、且开始追问前的最后一次提交为准；48 小时窗口内的后续优化按规则作为持续优化评估。开始追问前先完成希望计入的修改和提交。具体安排见 [`docs/实战套用说明.md`](docs/实战套用说明.md)。

## 启动

推荐 **Node.js 24**（`.nvmrc`），最低 22.13。工作台和 JSON 复算只需要 Node.js；独立的 `exam-kit` 才需要 Python。

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

## 固定任务数据与一键复算

拿到正式 CSV、确认字段后，在项目根目录执行一次（字段名替换成真实表头，没有的字段省略）：

```bash
npm run task:prepare -- --file "/绝对路径/任务.csv" --metric "指标列" --group "分类列" --date "日期列"
npm run dev
```

命令生成根目录 `task.config.json` 和 `results/task-metrics.json`。来自项目外的文件会按原始字节复制到 `private-inputs/`，项目内的文件直接记录相对路径。配置保存文件 SHA-256、数据性质、默认页面、字段映射、筛选和规则。服务启动会校验文件并自动导入，页面优先使用这份配置，不依赖旧 SQLite 或浏览器缓存。已有同一份数据的处理备注仍保留。

可在准备命令追加 `--view diagnostics --rule-field "检查列" --op lte --threshold 2`；比较方式支持 `gt/gte/lt/lte`。筛选参数是 `--q`、`--filter "分类列" --value "分类值"`、`--from YYYY-MM-DD --to YYYY-MM-DD`。百分比列的阈值 `12.5` 表示 `12.5%`。纯类别任务可省略 `--metric`。这些只是配置方式，具体字段和阈值必须来自正式业务判断。

```bash
npm run reproduce              # 按已保存配置重算 JSON
npm run reproduce -- --check   # 核对已保存结果；不一致时失败，不覆盖报告
```

页面的临时探索不会改写交付配置；确定最终口径后修改 `task.config.json` 或重新执行准备命令，再复算并重启服务。直接编辑配置时保留已有键，使用相同的字符串值格式。输出包含来源校验值、有效/排除数量、汇总、前 8 组、完整日期趋势和全部规则命中记录序号，与网页共用计算函数。

提交时包含 `task.config.json`、`results/task-metrics.json` 和 README 中的准确数据放置位置。原始数据按任务要求处理：允许公开时放到例如 `data/任务.csv` 后重新准备；不公开时，评审者将原发放文件放到配置指定的相对路径。**不能只交 `.data/` 数据库或浏览器操作截图。** 文件缺失、校验值变化、字段错误都会明确报错，不会自动换成演示数据。

评审者拿到交付仓库及原始文件后，完整复现步骤：

```bash
npm ci
npm run reproduce -- --check
npm run build
npm start
```

目前尚无正式任务，根目录不放正式配置。先用已提交的人工库存示例演练：

```bash
npm run reproduce:example
TASK_CONFIG=examples/task.config.json npm run dev
```

此示例首次打开即载入“库存 / 仓库”和 `库存 ≤ 2`，命中 **3 / 8 = 37.5%**；合计 **52**、均值 **6.5**。所有示例数字仅验证功能。`TASK_CONFIG` 可指定其他配置，路径相对项目根目录；环境变量直接在终端设置，`.env.example` 不会被自动读取。

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

临时探索可通过页面导入；正式交付使用上面的命令固化输入与口径。

1. 点击「导入 CSV」，选择文件或拖拽上传。
2. 检查行数、表头、空值与重复行。
3. 手动选择数值指标、分组维度和日期字段；上传数据不会继承演示订单的字段映射。
4. 调整筛选，核对一条原始记录和一个汇总数字。
5. 若使用诊断页，填写有业务依据的阈值后点击「运行诊断」。

输入支持 UTF-8（含 BOM）或 GB18030；逗号、分号和制表符分隔；引号、逗号字段和多行内容。每份文件上限 **5 MB、20,000 行、80 列**，最多 20 份上传数据加 1 份内置演示。重复/空表头、列数不齐、空文件等会给出错误。

内置订单演示共 168 条。[`examples/库存-人工演示.csv`](examples/库存-人工演示.csv) 使用另一套字段且没有日期，可验证换数据后的行为：库存合计 **52**，均值 **6.5**；规则 `库存 ≤ 2` 命中 **3 / 8 = 37.5%**。

## 统计口径

- 所有 KPI、趋势、规则和导出由后端基于同一份数据计算。关键词搜索、分类和日期条件在服务端执行。
- 非空值至少 90% 可解析时，推断为数值列；编号、前导零、超出安全整数范围的值保留为文本。末尾 `%` / `％` 明确表示百分比，`12.5%` 以 `0.125` 参与计算、仍按百分比显示；原始文本和导出值保留。混用百分号和无单位数字的列会提示统一单位，不能作为数值指标。货币符号和其他单位仍需按题目另行处理。
- 数值合计与均值仅使用可解析的值。均值分母为有效数值数量。空值/无效值被排除，并显示数量。某组、某日或整个筛选范围没有有效数值时显示“无有效数据”，趋势保留断点；真实的 `0` 正常显示。
- 百分比不累加。概览、分组与趋势均显示有效记录的等权平均，并明确其不是按分母加权的整体转化率；需要整体比例时应依据题目提供的分子、分母另行计算。
- 完整度 = 当前筛选范围非空单元格数 / 单元格总数；没有记录时显示 `—`。
- 日期识别支持 `YYYY-MM-DD`、`YYYY/MM/DD`、空格分隔的时间及 ISO 时间戳；日期类字段名还支持 `YYYYMMDD`、`YYYYMM`、`YYYY` 和 `YYYY-MM`。年份、月份分别归到年初、月初。紧凑日期不会据此把普通金额或 ID 当作日期；Unix 时间戳和 Excel 序列不猜测单位。与 exam-kit 一致，按 UTC 日期汇总，无时区时间按 UTC 解释；有偏移量的时间先换算 UTC，可能跨日。只展示出现过的日期。
- 分组图按数值合计（百分比按等权均值，未选数值时按记录数）取前 8 组；没有有效数值的组排末尾。趋势图可独立切换记录数量。
- 规则命中比例 = 命中记录 / 该字段可解析的记录。百分比字段的阈值输入 `12.5` 表示 `12.5%`，页面会标明单位。诊断清单优先显示首列标识和检查字段，旁边列出当前阈值。命中代表符合阈值，不能据此认定原因、风险或建议行动。
- 数据源记录只读。处理状态与备注独立保存，不覆盖原文件里的状态字段。服务升级后会刷新已导入文件的字段识别，保留原始记录和已有备注。
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
server/task.mjs         # 任务配置校验、数据校验值与可复算报告
scripts/task.mjs        # task:prepare / reproduce 命令
examples/task.config.json # 可直接演练的人工库存配置
tests/                  # 数据正确性与完整 API 流程
docs/实战套用说明.md      # 30 分钟执行顺序与交付说明骨架
```

### API

| 方法       | 路径                                 | 用途                                                        |
| ---------- | ------------------------------------ | ----------------------------------------------------------- |
| GET        | `/api/health`                        | 服务状态                                                    |
| GET        | `/api/workspace`                     | 当前任务的默认数据集、字段、筛选与规则                      |
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

2026-10-19 已在 macOS arm64 的独立 Git 克隆目录中完成从零安装验证：Node **24.21.0**，独立 Python **3.13.1** 虚拟环境，按锁文件/requirements 安装依赖。**25 项 Node/API/任务配置测试 + 45 项 Python 测试通过**，TypeScript 与生产构建通过。随后以空 SQLite 工作区启动生产服务，核对页面、静态资源、API 与示例复算结果，并在浏览器确认首次载入、刷新恢复默认值和独立分类筛选。此验证没有复制本机数据库或已安装的项目依赖。

`npm run check` 验证 CSV 编码与语法、数值和日期、空值分母、筛选/排序、规则边界、导出转义、API 错误、状态更新及重开 SQLite 后的持久化。也验证任务配置首次导入、复算一致性、源文件校验、外部文件复制与错误配置拒绝。浏览器检查覆盖三套页面、不同字段 CSV 上传、字段映射、备注保存、状态筛选与清单下载。

如需运行 `exam-kit` 的全部 Python 检查，先安装独立环境（Python 3.12+）：

```bash
python3 -m venv exam-kit/.venv
exam-kit/.venv/bin/python -m pip install -r exam-kit/requirements.txt
npm run check:all
```

这是本地单用户模板，默认只监听 `127.0.0.1`。它没有账号/权限管理；CSV 和统计在内存中处理，适合限定大小的面试数据。数值使用 JavaScript Number，若正式题目要求精确货币记账，应改用整数分或十进制定点运算。字体有系统字体回退，不需要任何付费 API 或密钥。

`.data/`、`private-inputs/`、`.env`、依赖和构建目录已加入 Git 忽略。正式公开仓库已创建并关联；题目数据是否可提交和最终业务结论，待拿到真实要求后确定。当前仓库内容仍是考前准备。

底层 API 参考：[Node SQLite](https://nodejs.org/api/sqlite.html)、[Vite](https://vite.dev/guide/)、[Express](https://expressjs.com/en/5x/api/)。
