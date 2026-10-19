# CSV 探索工具与答题准备

用于快速检查 CSV、计算描述性统计、展示分组与时间切片，并导出可复核结果。业务指标、分析单位和干预方案仍需根据正式任务书确定。

本工具位于当前面试项目的 `exam-kit/` 子目录，沿用项目根目录的 Git 配置。它没有单独的 Git 仓库。正式答卷可以参考 [ANSWER_TEMPLATE.md](ANSWER_TEMPLATE.md)，计时安排见 [作战手册.md](作战手册.md)。

## 先跑示例

在 `exam-kit` 目录执行：

```bash
bash run.sh
bash run.sh --test
```

示例数据是虚构的。默认输出 `out/metrics.json` 和 `index.html`。页面可以离线打开；重新计算需要 Python 依赖。

如果没有可用环境，使用 Python 3.12 或更新版本：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
bash run.sh
```

`run.sh` 优先使用本目录的虚拟环境，再探测系统解释器。也可通过 `PYTHON=/path/to/python bash run.sh` 指定；指定的解释器不兼容时会报错，不会静默换成另一个。

依赖锁定为已在本机 Python 3.13.1 上验证的 pandas 3.0.0、NumPy 2.2.0、SciPy 1.18.0。每次结果同时记录实际环境版本、输入文件 SHA-256 和复现命令。

## 使用真实数据

保留原始 CSV，根据正式规则决定是否可以随公开仓库提交。把可使用的数据复制到 `data/`，明确指定文件：

```bash
bash run.sh --file data/orders.csv --title "渠道订单金额诊断" \
  --metric 订单金额 --group 渠道 --date 订单日期 --entity 用户ID
```

多个 CSV 同时存在时必须使用 `--file`，不再自动挑最大的文件。`--title` 只是展示标题，不会定义或计算复购率等业务指标。

关键参数：

| 参数 | 含义 |
|---|---|
| `--metric` | 已明确业务口径的数值列；建议正式答题时指定 |
| `--group` | 分组列；未指定时按字段类型和原始顺序选取，不挑差异最大者 |
| `--date` | 日期列；支持 `YYYYMMDD`、`YYYYMM`、标准日期文本 |
| `--entity` | 观察单位的 ID 列，如用户 ID；重复实体会禁用普通独立样本检验 |
| `--direction lower` | 业务上越低越好，如成本；默认 `neutral` 不判断高低优劣 |
| `--direction higher` | 业务上越高越好；只影响展示顺序与颜色，不构成行动建议 |
| `--metric-kind binary` | 0/1 事件列，均值显示为有效行事件占比 |
| `--metric-kind rate` | 0~1 的比例列；报告的是逐行等权均值，不能替代加权总体率 |
| `--metric-kind numeric` | 普通数值；增长幅度等可能超过 100% 的百分比也应按普通数值处理 |
| `--no-html` | 只写 JSON，并清除旧 HTML 和截图 |
| `--open` | 成功运行后打开页面 |
| `--screenshot` | 成功运行后额外截图，需要下方的可选依赖 |

自动识别保留 0/1 和常量指标。ID 保留为文本，避免丢失前导零。百分比按有效值转换，缺失值不会改变单位；混用百分号与无单位数字时会要求先统一单位。Unix 时间戳与 Excel 序列值需要先按明确单位转换，工具不猜测日期单位。

`--entity` 与 `--group` 指定的列始终按文本保留，包括 `0001`、`01` 等代码，并排除日期自动识别。CSV 会逐条校验列数，支持引号内的分隔符和换行；多列、少列、空表头和重复表头都会报错。文本 `NA`、`NULL` 保留原义，仅空字段及纯空格记为缺失；其他缺失标记应根据任务口径另行处理。

## 统计边界

默认只做描述性探索，不输出“高置信度”“最强组”“优先干预对象”。样本总体均值是参照，不能自动解释成不采取措施时的反事实；分组差异不是方案收益。

只有满足以下条件才计算 Welch 检验：指标和分组通过参数明确指定；比较在观察结果前确定；用户确认行间独立；没有检出的重复实体、缺失实体标识或完全重复行；SciPy 可用。

```bash
bash run.sh --file data/independent_samples.csv \
  --metric 测量值 --group 实验组 --entity 样本ID --independent-rows
```

`--independent-rows` 是对样本设计的声明，不能用来强行绕过重复用户检查。同一用户多次下单时，需按任务设计用户级指标或另外实现聚类/重复测量方法。没有实体列时，程序无法验证独立性，必须由使用者核查。

- p 值比较“本组与其余组”；描述性差值比较“本组与全样本”。页面明确区分两种参照。
- Bonferroni 范围为当前指定维度全部有效分组，不覆盖更换指标、反复运行或事后筛选。
- p 值保持计算精度，先校正和判断，再格式化显示。不把四舍五入后的 `0.0000` 当作计算值。
- 样本不足或无法计算时显示“未检验”，不显示“不显著”。缺少 SciPy 时不降级为未经说明的正态近似。
- 时间切片按有数据的日期顺序分段，同一天不跨段；样本不足时不判断稳定性；方向翻转会优先展示。它仍是样本内检查。
- 基线非正时不显示相对百分比，保留绝对差值；比例同时给出百分点差。含负数时不计算容易误解的贡献占比。
- 比例列不求“总率”或集中度。若每行分母不同，应另外按分子之和除以分母之和定义指标。

## 截图与产物一致性

`bash run.sh` **不生成截图**，每次成功计算都会移除旧 `preview.png`，防止把上一份数据的截图交出去。读取或计算失败会清除旧结果，并写入 `out/FAILED.txt`。

需要截图时，在同一个 Python 环境安装可选依赖及浏览器：

```bash
python3 -m pip install -r requirements-preview.txt
python3 -m playwright install chromium
bash run.sh --screenshot
```

如果使用 `.venv`，将上述 `python3` 替换成 `.venv/bin/python`。也可以先确认页面，再运行同一解释器的 `python screenshot.py`。截图是静态产物，数据改变后要重新生成；本 README 不默认嵌入可能过时的图片。

## 检查与提交

```bash
bash run.sh --test
bash run.sh --file data/sample_orders.csv --screenshot
```

检查覆盖百分比单位、日期、二元指标、成本方向、零与负参照、缺失分母、统计精度、重复实体、切片边界和旧产物失效处理。原始 CSV 不会被修改。

项目根目录可用 `npm run check:all` 一次检查前后端模板和本工具，用 `npm run analyze -- --file data/sample_orders.csv` 运行示例。`--file` 的相对路径以 `exam-kit/` 为基准；正式数据建议传绝对路径。生成结果默认不进 Git，按任务要求核对后再用 `git add -f` 明确加入交付文件。

Git 提交在上一级面试项目根目录进行，使用已经验证的身份、凭据助手和网络配置。不要在这里再次 `git init`，也不要从旧目录复制 `.git`。本次修订只准备本地代码和结果，正式仓库的创建、推送和提交链接在确认任务要求后进行。
