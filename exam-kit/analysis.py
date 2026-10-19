#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CSV 探索工具：字段口径由任务决定，标题不定义指标，历史差异不代表干预收益。"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import math
import platform
import re
import shlex
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
try:
    import scipy
    from scipy import stats as _st
except ImportError:
    scipy = None
    _st = None

HAS_SCIPY = _st is not None
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
OUT_DIR = ROOT / "out"
TPL_PATH = ROOT / "templates" / "page.html"
ALPHA = 0.05
ENCODINGS = ("utf-8-sig", "gb18030", "gbk")
DATE_HINTS = ("date", "time", "日期", "时间", "月份", "统计期")
METRIC_HINTS = ("金额", "收入", "营收", "销售额", "利润", "毛利", "成本", "客单", "价格", "数量", "件数", "次数", "时长", "评分", "分数", "点击", "曝光", "转化", "复购", "退货", "率", "amount", "gmv", "sales", "revenue", "profit", "cost", "price", "qty", "quantity", "count", "score", "duration", "click", "rate", "converted", "retained")


def _name_hit(name, hints):
    return any(h in str(name).lower() for h in hints)


def is_identifier(name):
    original = str(name).strip()
    name = original.lower()
    return bool(re.search(r"(^id$|[_ -]id$|[^\x00-\x7f]id$|编号$|编码$|代码$|订单号$|流水号$|序号$)", name)
                or re.search(r"(?:[a-z]Id|[a-z]ID)$", original)
                or name in {"sku", "uid", "userid", "customerid", "orderid", "用户", "客户", "会员", "user", "customer"})


def is_text(s):
    return pd.api.types.is_string_dtype(s) or pd.api.types.is_object_dtype(s)


def safe(x, nd=None):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return v if nd is None else round(v, nd)


def pct(x, nd=2):
    v = safe(x, None)
    return None if v is None else round(v * 100, nd)


def fmt_p(p):
    if safe(p, None) is None:
        return "未检验"
    return "< 0.001" if p < 0.001 else f"{p:.4f}"


def p_phrase(p):
    return "未检验" if safe(p, None) is None else ("p<0.001" if p < 0.001 else f"p={p:.4f}")


def read_any_csv(path):
    """逐条核对 CSV 结构，保留原始文本、前导零和 NA/NULL 等字面值。"""
    raw = path.read_bytes()
    encodings = ("utf-16",) if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else ENCODINGS
    for enc in encodings:
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        try:
            sep = csv.Sniffer().sniff(text[:65536], delimiters=",;\t|").delimiter
        except csv.Error:
            first = text.splitlines()[0] if text else ""
            sep = max(",;\t|", key=first.count) if any(x in first for x in ",;\t|") else ","
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=sep, strict=True)
        try:
            header = next((row for row in reader if row), [])
            normalized = [re.sub(r"\s+", " ", c).strip() for c in header]
            if not normalized or not all(normalized):
                raise ValueError("CSV 表头为空或含空列名，请补全字段名称。")
            if len(normalized) != len(set(normalized)):
                raise ValueError("清理空格后存在重复列名，请先明确字段，不能静默丢列。")
            rows = []
            for row in reader:
                if not row:  # 空白物理行不算记录；带引号的空字段仍保留。
                    continue
                if len(row) != len(normalized):
                    raise ValueError(f"CSV 行结构不一致：第 {reader.line_num} 行结束的记录有 {len(row)} 列，表头要求 {len(normalized)} 列。")
                rows.append(row)
        except csv.Error as exc:
            raise ValueError(f"CSV 解析失败（第 {reader.line_num} 行）：{exc}") from exc
        # 不再让 pandas 猜测索引或缺失标记，避免静默移列和吞掉合法代码。
        return pd.DataFrame(rows, columns=normalized, dtype="string")
    raise ValueError("无法解码 CSV，请转换为 UTF-8、GB18030 或带 BOM 的 UTF-16。")


def to_numeric_safe(s):
    if pd.api.types.is_numeric_dtype(s):
        return s.astype(float).replace([np.inf, -np.inf], np.nan)
    if not is_text(s):
        return None
    raw = s.astype("string").str.strip().replace("", pd.NA)
    raw = raw.str.replace("％", "%", regex=False)
    raw = raw.str.replace(r"^\((.*)\)$", r"-\1", regex=True)
    percent = raw.str.endswith("%", na=False)
    cleaned = raw.str.replace(r"[,，\s￥¥$€£]", "", regex=True).str.replace(r"元$", "", regex=True)
    cleaned = cleaned.str.replace(r"%$", "", regex=True)
    conv = pd.to_numeric(cleaned, errors="coerce").astype(float)
    valid = conv.notna()
    if not raw.notna().any() or valid.sum() / raw.notna().sum() < 0.9:
        return None
    if percent[valid].any() and (~percent[valid]).any():
        raise ValueError(f"列「{s.name}」混用百分号与无单位数字，请先统一单位。")
    # 按非空值判断和逐项换算，缺失比例不会改变百分比的单位。
    conv.loc[percent] /= 100.0
    return conv.replace([np.inf, -np.inf], np.nan)


def clean_frame(df, *, text_columns=()):
    df = df.copy().reset_index(drop=True)
    df.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in df.columns]
    if df.columns.duplicated().any():
        raise ValueError("存在重复列名，请先明确字段。")
    messages, percent_columns = [], []
    for c in df.columns:
        original = df[c]
        if c in text_columns or is_text(original):
            df[c] = original = original.astype("string").str.strip().replace("", pd.NA)
        if c in text_columns or is_identifier(c) or pd.api.types.is_datetime64_any_dtype(original):
            continue
        conv = to_numeric_safe(original)
        if conv is not None:
            lost = int((original.notna() & conv.isna()).sum())
            if lost:
                messages.append(f"「{c}」有 {lost} 个非空值无法转成有限数字，已记为缺失，请核对原始值。")
            if is_text(original) and original.str.contains(r"[%％]$", na=False).any():
                percent_columns.append(c)
            df[c] = conv
    duplicated = int(df.duplicated().sum())
    if duplicated:
        messages.append(f"发现 {duplicated} 行完全重复；保留原行，需按业务主键判断是否去重。")
    df.attrs.update(cleaning_notes=messages, percent_columns=percent_columns, duplicate_rows=duplicated)
    return df


def parse_dates(s):
    """统一解析用于识别、时间切片和概览；整数日期绝不按纳秒时间戳处理。"""
    if pd.api.types.is_datetime64_any_dtype(s):
        return pd.to_datetime(s, errors="coerce", utc=True)
    raw = s.astype("string").str.strip().str.replace(r"\.0$", "", regex=True)
    result = pd.Series(pd.NaT, index=s.index, dtype="datetime64[us, UTC]")
    for width, fmt in ((8, "%Y%m%d"), (6, "%Y%m"), (4, "%Y")):
        mask = raw.str.fullmatch(rf"\d{{{width}}}", na=False)
        result.loc[mask] = pd.to_datetime(raw[mask], format=fmt, errors="coerce", utc=True)
    # 其余纯数字含 Unix/Excel 日期不猜测单位。标准日期文本按 mixed 解析。
    text_mask = raw.notna() & ~raw.str.fullmatch(r"[+-]?\d+(\.\d+)?", na=False)
    result.loc[text_mask] = pd.to_datetime(raw[text_mask], errors="coerce", format="mixed", utc=True)
    return result


def detect_date(df, exclude=()):
    candidates = []
    for c in df.columns:
        if c in exclude or is_identifier(c) or df[c].notna().sum() < 3:
            continue
        named = _name_hit(c, DATE_HINTS) or c.lower() in {"dt", "day", "month", "period"}
        if pd.api.types.is_numeric_dtype(df[c]) and not named:
            continue
        parsed = parse_dates(df[c])
        valid = parsed.dropna()
        if not valid.empty and parsed.notna().sum() / df[c].notna().sum() >= 0.9 and valid.nunique() >= 2:
            if 1990 <= valid.dt.year.min() <= valid.dt.year.max() <= 2100:
                candidates.append((int(named), c))
    return max(candidates, key=lambda x: x[0])[1] if candidates else None


def detect_metrics(df, exclude):
    out = []
    for c in df.columns:
        if c in exclude or is_identifier(c) or not pd.api.types.is_numeric_dtype(df[c]):
            continue
        s = df[c].dropna()
        if len(s) == 0:
            continue
        u = np.sort(s.unique())
        # 保留二元指标和常量指标；仅跳过无业务提示的自增序号。
        if not _name_hit(c, METRIC_HINTS) and len(u) == len(s) > 20 and u[0] in (0, 1) and np.all(np.diff(u) == 1):
            continue
        out.append(c)
    # 不按观察到的波动或效应挑指标；名称只是提示，必须人工确认口径。
    return sorted(out, key=lambda c: not _name_hit(c, METRIC_HINTS))


def detect_groups(df, exclude):
    return [c for c in df.columns if c not in exclude and not is_identifier(c)
            and 2 <= df[c].nunique(dropna=True) <= 20]


def detect_entity(df, exclude):
    candidates = [c for c in df.columns if c not in exclude and is_identifier(c) and df[c].notna().any()]
    priority = lambda c: not _name_hit(c, ("用户", "客户", "会员", "user", "customer", "member", "uid"))
    return sorted(candidates, key=priority)[0] if candidates else None


def welch_p(a, b):
    a, b = a.dropna().astype(float), b.dropna().astype(float)
    if not HAS_SCIPY or len(a) < 5 or len(b) < 5:
        return float("nan")
    if a.var(ddof=1) / len(a) + b.var(ddof=1) / len(b) <= 0:
        return float("nan")
    return float(_st.ttest_ind(a, b, equal_var=False).pvalue)


def profile(df):
    return [{"name": c, "dtype": str(s.dtype), "n": int(s.notna().sum()),
             "missing_pct": pct(s.isna().mean()), "nunique": int(s.nunique()),
             "sample": " / ".join(s.dropna().astype(str).head(3))} for c, s in df.items()]


def group_mask(s, level, missing=False):
    return s.isna() if missing else (s.astype("string") == str(level)).fillna(False)


def analyze_segments(df, metric, group, *, direction="neutral", metric_kind="numeric", inference=None):
    base = df[metric].dropna().astype(float)
    if base.empty:
        return None
    inference = inference or {"enabled": False, "reason": "未确认独立性与预先指定的比较。"}
    baseline = float(base.mean())
    total = float(base.sum())
    additive = metric_kind == "numeric"
    share_ok = additive and (base >= 0).all() and total > 0
    levels = []
    for level, g in df.groupby(group, dropna=False, sort=False):
        vals = g[metric].dropna().astype(float)
        if vals.empty:
            continue
        missing = bool(pd.isna(level))
        mask = group_mask(df[group], level, missing)
        rest = df.loc[~mask, metric].dropna().astype(float)
        mean, difference = float(vals.mean()), float(vals.mean() - baseline)
        p = welch_p(vals, rest) if inference["enabled"] else float("nan")
        levels.append({
            "level": "（缺失）" if missing else str(level), "level_is_missing": missing,
            "n": len(vals), "rest_n": len(rest), "mean": safe(mean), "median": safe(vals.median()),
            "total": safe(vals.sum()) if additive else None,
            "row_share_pct": pct(len(vals) / len(base)),
            "value_share_pct": pct(vals.sum() / total) if share_ok else None,
            "difference": safe(difference), "difference_pp": pct(difference) if metric_kind in {"binary", "rate"} else None,
            "lift_pct": pct(difference / baseline) if baseline > 0 else None,
            "p_value": safe(p, None), "p_text": fmt_p(p), "p_phrase": p_phrase(p),
        })
    if len(levels) < 2:
        return None
    # 比较范围是预先指定的这一维度的所有非空指标分组，不能只计显著项。
    family_size = len(levels)
    n_tests = sum(lv["p_value"] is not None for lv in levels)
    for lv in levels:
        p = lv["p_value"]
        adjusted = min(1.0, p * family_size) if p is not None else None
        lv.update(p_adjusted=adjusted, significant=None if p is None else p < ALPHA,
                  significant_bonferroni=None if p is None else adjusted < ALPHA)
    levels.sort(key=lambda x: x["mean"], reverse=direction != "lower")
    return {"metric": metric, "group": group, "baseline_mean": safe(baseline),
            "baseline_median": safe(base.median()), "n_total": len(base), "levels": levels,
            "n_tests": n_tests, "family_size": family_size, "alpha": ALPHA,
            "alpha_bonferroni": ALPHA / family_size if inference["enabled"] else None,
            "inference": inference, "direction": direction, "metric_kind": metric_kind}


def analyze_time(df, metric, date_col, focus_group, focus_level, focus_missing=False):
    dates = parse_dates(df[date_col])
    valid = dates.notna() & df[metric].notna()
    if valid.sum() < 20:
        return None
    days = dates[valid].dt.normalize()
    span = (days.max() - days.min()).days
    k = 3 if span > 730 else 2
    unique_days = pd.DatetimeIndex(days.unique()).sort_values()
    if len(unique_days) < k:
        return None
    # 整天分配到同一段，避免同日数据因原始行顺序被切到两边。
    day_period = {day: period for period, chunk in enumerate(np.array_split(np.arange(len(unique_days)), k)) for day in unique_days[chunk]}
    dfx = df.loc[valid].assign(__date=dates[valid], __period=days.map(day_period))
    slices = []
    for period, g in dfx.groupby("__period", sort=True):
        vals = g[metric].astype(float)
        rec = {"label": f"第{int(period) + 1}段", "start": g["__date"].min().strftime("%Y-%m-%d"),
               "end": g["__date"].max().strftime("%Y-%m-%d"), "n": len(vals), "mean": safe(vals.mean())}
        if focus_group and focus_level is not None:
            sub = g.loc[group_mask(g[focus_group], focus_level, focus_missing), metric]
            enough = len(sub) >= 5 and len(vals) - len(sub) >= 5
            diff = float(sub.mean() - vals.mean()) if enough else None
            rec.update(focus_n=len(sub), focus_difference=safe(diff),
                       focus_lift_pct=pct(diff / vals.mean()) if enough and vals.mean() > 0 else None)
        slices.append(rec)
    differences = [s["focus_difference"] for s in slices if s.get("focus_difference") is not None]
    lifts = [s["focus_lift_pct"] for s in slices if s.get("focus_lift_pct") is not None]
    assessed = len(differences) == len(slices) and len(slices) >= 2
    flip = min(differences) < 0 < max(differences) if len(differences) >= 2 else None
    return {"date_column": date_col, "span_days": span, "k": len(slices), "slices": slices,
            "focus_group": focus_group, "focus_level": focus_level, "focus_lifts": lifts,
            "sign_flip": flip, "assessed": assessed,
            "status": "方向翻转" if flip else ("各段未见翻转" if assessed else "样本不足，未判定")}


def analyze_concentration(df, metric, entity):
    known = df.dropna(subset=[metric, entity])
    if known.empty or (known[metric] < 0).any():
        return None
    g = known.groupby(entity)[metric].sum(min_count=1).dropna().sort_values(ascending=False)
    if len(g) < 2 or g.sum() <= 0:
        return None
    share = lambda fraction: pct(g.head(max(1, math.ceil(len(g) * fraction))).sum() / g.sum())
    return {"entity": entity, "n_entities": len(g), "top10_n": max(1, math.ceil(len(g) * .1)), "top10pct_share": share(0.1),
            "top20pct_share": share(0.2), "bottom50pct_share": pct(g.tail(len(g) // 2).sum() / g.sum()),
            "excluded_rows": int((df[metric].notna() & df[entity].isna()).sum())}


def analyze_correlation(df, cols):
    cols = [c for c in cols if not is_identifier(c) and pd.api.types.is_numeric_dtype(df[c])][:8]
    out = []
    for i, a in enumerate(cols):
        for b in cols[i + 1:]:
            pair = df[[a, b]].dropna()
            if len(pair) >= 30 and pair[a].nunique() > 1 and pair[b].nunique() > 1:
                r = safe(pair[a].corr(pair[b]), None)
                if r is not None:
                    out.append({"a": a, "b": b, "r": r, "n": len(pair)})
    return sorted(out, key=lambda p: -abs(p["r"]))[:5]


def analyze_distribution(df, metric, bins=12):
    s = df[metric].dropna().astype(float)
    if s.empty:
        return None
    if s.nunique() <= 3:
        counts = s.value_counts().sort_index()
        rows = [{"label": f"{value:g}", "count": int(count)} for value, count in counts.items()]
    else:
        counts, edges = np.histogram(s, bins=bins)
        rows = [{"label": f"{edges[i]:.4g}~{edges[i+1]:.4g}", "count": int(n)} for i, n in enumerate(counts)]
    return {"metric": metric, "bins": rows, "min": safe(s.min()), "max": safe(s.max()), "n": len(s)}


def build_findings(seg, tm, conc, corr, prof, df):
    out = []
    def add(kind, title, detail, status="描述"):
        out.append({"kind": kind, "title": title, "detail": detail, "status": status})
    if tm and tm["sign_flip"]:
        detail = "；".join(f"{s['label']} {s['start']}~{s['end']}：差值 {s['focus_difference']:+g}" for s in tm["slices"] if s.get("focus_difference") is not None)
        add("risk", "时间切片中差异方向翻转", f"「{tm['focus_level']}」相对同期样本均值：{detail}。全期差异不能直接外推；翻转本身也未作显著性检验。", "需核查")
    if seg:
        lv = seg["levels"][0]
        delta = f"相对差异 {lv['lift_pct']:+g}%" if lv["lift_pct"] is not None else "参照均值非正，不计算相对百分比"
        if lv["difference_pp"] is not None:
            delta += f"，相差 {lv['difference_pp']:+g} 个百分点"
        if lv["p_value"] is None:
            test = seg["inference"]["reason"] if not seg["inference"]["enabled"] else "本组或其他组样本不足，或合并标准误为零，未计算 p 值。"
        else:
            test = f"与其他组比较：{lv['p_phrase']}；本维度 {seg['family_size']} 个比较的 Bonferroni 调整后 p={lv['p_adjusted']:.4g}。"
        add("segment", f"观察分组：{seg['group']} = 「{lv['level']}」",
            f"n={lv['n']}，均值 {lv['mean']:.6g}，全样本参照均值 {seg['baseline_mean']:.6g}，差值 {lv['difference']:+g}；{delta}。{test} 这是历史关联，不代表采取措施后的收益。", "探索")
    bad = [p for p in prof if p["missing_pct"] > 5]
    if bad:
        top = max(bad, key=lambda p: p["missing_pct"])
        add("quality", f"{len(bad)} 列缺失率超过 5%", f"「{top['name']}」缺失率 {top['missing_pct']}%。需核查缺失机制；全空列也保留在画像中。", "需核查")
    if conc:
        add("concentration", f"前 {conc['top10_n']} 个{conc['entity']}占可计算总量的 {conc['top10pct_share']}%",
            f"按 {conc['n_entities']} 个已知实体数量的 10% 向上取整；排除 {conc['excluded_rows']} 行实体标识缺失的有效指标记录。分布集中程度不能直接决定服务优先级。")
    if corr and abs(corr[0]["r"]) >= 0.5:
        c = corr[0]
        add("corr", f"{c['a']} 与 {c['b']} 的样本相关系数为 {c['r']:.3f}", f"有效配对 n={c['n']}。这是探索性相关，未控制混杂或多次搜索，不作因果解释。", "探索")
    return out


def build_limitations(df, seg, tm, corr, *, selection=None, metric_kind="numeric", direction="neutral"):
    out = ["历史样本的总体均值只是描述性参照，不是‘什么都不做’的反事实；分组差异不是干预收益。",
           "标题仅用于展示；指标定义、分析单位、分母和观察窗口需要根据任务书确认。"]
    if selection:
        if selection["metric_auto"]:
            out.append("指标由字段名提示自动选取；尚未确认它是否对应业务目标。")
        if selection["group_auto"]:
            out.append("分组按字段类型和原始列顺序选择，未按结果挑选差异最大的维度；自动结果仅作探索。")
    if seg:
        out.append(seg["inference"]["reason"])
        if seg["inference"]["enabled"]:
            out.append(f"p 值比较本组与其余组；展示的差值比较本组与全样本。校正范围为本维度 {seg['family_size']} 个比较，不覆盖多次运行、换指标或事后挑选。")
    out.append("时间切片为同一历史样本内的描述性检查，不构成样本外验证或有效性证明。" if tm else "未形成可比较的时间切片，可能是缺少日期、日期数量不足或有效样本过少。")
    if metric_kind in {"binary", "rate"}:
        out.append("二元列均值是有效行中事件占比；比例列均值是逐行等权均值。若每行分母不同，必须另外用分子之和 / 分母之和计算总体率。")
    if direction == "neutral":
        out.append("未指定指标的业务方向；页面不判定高低的业务优劣。")
    out += df.attrs.get("cleaning_notes", [])
    out.append("本工具未估算干预效果或统一扣减业务成本；具体收益和净值只能按任务口径另行验证。")
    return list(dict.fromkeys(out))


def render_html(template, payload):
    data = json.dumps(payload, ensure_ascii=False, allow_nan=False).replace("</", "<\\/")
    # 单次替换，避免用户标题或数据里的占位符触发第二次替换。
    values = {"__TITLE__": html.escape(payload["title"]), "__DATA__": data, "__GENERATED__": html.escape(payload["generated_at"])}
    return re.sub(r"__TITLE__|__DATA__|__GENERATED__", lambda m: values[m.group()], template)


def pick_file(arg):
    if arg:
        p = Path(arg).expanduser()
        if not p.is_absolute() and not p.exists():
            p = ROOT / p
        if not p.is_file():
            raise ValueError(f"找不到 CSV：{p}")
        return p.resolve()
    csvs = sorted(p for p in DATA_DIR.iterdir() if p.is_file() and p.suffix.lower() == ".csv") if DATA_DIR.exists() else []
    real = [p for p in csvs if not p.name.lower().startswith(("sample", "示例", "demo"))]
    csvs = real or csvs
    if len(csvs) != 1:
        raise ValueError("请用 --file 明确指定 CSV；data/ 中当前没有文件或有多份候选。")
    return csvs[0].resolve()


def inference_policy(df, args, metric_auto, group_auto, entity):
    reasons = []
    if not args.independent_rows:
        reasons.append("未通过 --independent-rows 确认行间独立性")
    if metric_auto or group_auto:
        reasons.append("指标或分组为自动选择，未预先明确比较")
    if entity:
        ids = df[entity].dropna()
        if ids.duplicated().any():
            reasons.append(f"实体列「{entity}」重复出现（{len(ids)} 行 / {ids.nunique()} 个实体），未实现聚类或重复测量推断")
        if df[entity].isna().any():
            reasons.append(f"实体列「{entity}」含缺失，无法完整核对分析单位")
    if df.attrs.get("duplicate_rows", 0):
        reasons.append("存在完全重复的行，尚未确认独立观察单位")
    if not HAS_SCIPY:
        reasons.append("缺少 scipy，不使用正态近似冒充 Welch 检验")
    return {"enabled": not reasons, "reason": "未计算 p 值：" + "；".join(reasons) + "。" if reasons else "已按用户声明的独立行及指定指标/分组计算 Welch 检验；这些声明仍需业务验证。"}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", help="CSV 路径；多份候选时必须指定")
    ap.add_argument("--title", default="", help="展示标题，不影响指标或计算")
    ap.add_argument("--metric", help="明确指定已定义好口径的数值指标")
    ap.add_argument("--group", help="分组列")
    ap.add_argument("--date", help="日期列，支持 YYYYMMDD / YYYYMM / 标准日期文本")
    ap.add_argument("--entity", help="独立观察单位的 ID 列，用于发现重复实体")
    ap.add_argument("--direction", choices=["neutral", "higher", "lower"], default="neutral", help="指标业务方向；默认不判断优劣")
    ap.add_argument("--metric-kind", choices=["auto", "numeric", "binary", "rate"], default="auto")
    ap.add_argument("--independent-rows", action="store_true", help="仅当行间独立、比较在看结果前已确定时启用；重复实体仍会禁用检验")
    ap.add_argument("--no-html", action="store_true", help="只写 JSON，并移除旧 HTML/截图防止误交")
    args = ap.parse_args(argv)
    try:
        path = pick_file(args.file)
        df = read_any_csv(path)
        if df.empty:
            raise ValueError("数据为空。")
        for role in ("metric", "group", "date", "entity"):
            field = getattr(args, role)
            if field and field not in df.columns:
                raise ValueError(f"{role} 指定的列不存在：{field}")
        df = clean_frame(df, text_columns={args.entity, args.group})
        date_col = args.date or detect_date(df, {args.entity, args.group, args.metric})
        candidates = detect_metrics(df, {date_col, args.entity})
        metric = args.metric or (candidates[0] if candidates else None)
        if metric is None:
            raise ValueError("未找到数值指标，请清理数值或通过 --metric 指定。")
        if not pd.api.types.is_numeric_dtype(df[metric]) or not df[metric].notna().any():
            raise ValueError(f"「{metric}」不是可用的数值列；请检查单位、缺失和非数值内容。")
        if metric == date_col or metric == args.entity:
            raise ValueError("指标不能同时充当日期或实体 ID。")
        groups = detect_groups(df, {metric, date_col, args.entity})
        text_groups = [c for c in groups if is_text(df[c])]
        group = args.group or ((text_groups or groups)[0] if groups else None)
        if group and group in {metric, date_col}:
            raise ValueError("分组列不能与指标或日期列相同。")
        entity = args.entity or detect_entity(df, {metric, date_col, group})
        vals = df[metric].dropna()
        kind = args.metric_kind
        if kind == "auto":
            kind = "binary" if vals.isin([0, 1]).all() else ("rate" if metric in df.attrs.get("percent_columns", []) else "numeric")
        if kind == "binary" and not vals.isin([0, 1]).all():
            raise ValueError("binary 指标只能包含 0、1 和缺失。")
        if kind == "rate" and not vals.between(0, 1).all():
            raise ValueError("rate 指标必须已统一为 0~1 的比例。")
        selection = {"metric_auto": args.metric is None, "group_auto": args.group is None,
                     "metric_candidates": candidates, "group_candidates": text_groups or groups}
        dates = parse_dates(df[date_col]) if date_col else None
        if dates is not None:
            if not dates.notna().any():
                raise ValueError("日期列无法解析；Unix 时间戳或 Excel 序列需先按明确单位转换。")
            invalid = int((df[date_col].notna() & dates.isna()).sum())
            if invalid:
                df.attrs["cleaning_notes"].append(f"日期列有 {invalid} 个非空值无法解析，已从时间切片排除。")
        inference = inference_policy(df, args, selection["metric_auto"], selection["group_auto"], entity)
        if inference["enabled"] and (not group or df.loc[df[metric].notna(), group].nunique(dropna=False) < 2):
            inference = {"enabled": False, "reason": "未计算 p 值：没有至少两个指标有效的分组。"}
        seg = analyze_segments(df, metric, group, direction=args.direction, metric_kind=kind, inference=inference) if group else None
        focus = seg["levels"][0] if seg else None
        tm = analyze_time(df, metric, date_col, group, focus["level"] if focus else None, focus["level_is_missing"] if focus else False) if date_col else None
        conc = analyze_concentration(df, metric, entity) if entity and kind == "numeric" else None
        corr = analyze_correlation(df, [metric] + [c for c in df.columns if c not in {metric, date_col, entity}])
        prof = profile(df)
        findings = build_findings(seg, tm, conc, corr, prof, df)
        limits = build_limitations(df, seg, tm, corr, selection=selection, metric_kind=kind, direction=args.direction)
        display_path = str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name
        # 原始参数保留自动/显式选择状态，保证复现时不会改变统计检验开关。
        actual_args = list(argv) if argv is not None else sys.argv[1:]
        replay_args = []
        skip = False
        for arg in actual_args:
            if skip:
                skip = False
                continue
            if arg == "--file":
                skip = True
            elif not arg.startswith("--file="):
                replay_args.append(arg)
        portable_path = str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else "data/" + path.name
        original_command = ["bash", "run.sh", "--file", portable_path] + replay_args
        if not path.is_relative_to(ROOT):
            limits.append(f"原 CSV 位于工具目录外；若允许公开该数据，复现前将它复制为 {portable_path}，并核对文件 SHA-256。")
        payload = {"schema_version": 2, "title": args.title or f"{metric} · 描述性探索",
                   "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"), "file": display_path,
                   "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                   "overview": {"rows": len(df), "cols": len(df.columns), "date_column": date_col,
                                "date_range": [dates.min().strftime("%Y-%m-%d"), dates.max().strftime("%Y-%m-%d")] if dates is not None else None,
                                "metric": metric, "group": group, "entity": entity, "metric_kind": kind, "direction": args.direction},
                   "selection": selection, "inference": inference,
                   "baseline": {"mean": safe(vals.mean()), "median": safe(vals.median()),
                                "sum": safe(vals.sum()) if kind == "numeric" else None, "std": safe(vals.std()), "n": len(vals)},
                   "findings": findings, "segments": seg, "time": tm, "concentration": conc,
                   "correlations": corr, "distribution": analyze_distribution(df, metric), "profile": prof,
                   "limitations": limits, "scipy": HAS_SCIPY,
                   "environment": {"python": platform.python_version(), "pandas": pd.__version__, "numpy": np.__version__, "scipy": scipy.__version__ if scipy else None},
                   "reproduce_command": shlex.join(original_command)}
        rendered = None if args.no_html else render_html(TPL_PATH.read_text("utf-8"), payload)
        serialized = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "metrics.json").write_text(serialized + "\n", encoding="utf-8")
        if rendered is not None:
            (ROOT / "index.html").write_text(rendered, encoding="utf-8")
        else:
            (ROOT / "index.html").unlink(missing_ok=True)
        (ROOT / "preview.png").unlink(missing_ok=True)
        (OUT_DIR / "FAILED.txt").unlink(missing_ok=True)
    except (ValueError, OSError, pd.errors.EmptyDataError) as exc:
        # 失败后清除本工具上一次产物，避免把旧结果当作本次成功交付。
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        for artifact in (OUT_DIR / "metrics.json", ROOT / "index.html", ROOT / "preview.png"):
            artifact.unlink(missing_ok=True)
        (OUT_DIR / "FAILED.txt").write_text(str(exc) + "\n", encoding="utf-8")
        ap.exit(1, f"[错误] {exc}\n")
    print(f"数据：{display_path} · {len(df)} 行 × {len(df.columns)} 列")
    print(f"指标：{metric}（{kind}） · 分组：{group or '无'} · 方向：{args.direction}")
    print(f"样本参照均值：{payload['baseline']['mean']} · 有效 n={len(vals)}")
    if selection["metric_auto"] or selection["group_auto"]:
        print("提示：自动选择仅供探索，请按任务确认指标、分母和观察单位。")
    print(inference["reason"])
    if not findings:
        print("未生成自动发现；不代表不存在信号，请检查字段和分析方法。")
    for f in findings:
        print(f"\n[{f['status']}] {f['title']}\n  {f['detail']}")
    print("\n复现命令：" + payload["reproduce_command"])
    print("输出：out/metrics.json" + ("" if args.no_html else "、index.html") + "；旧截图已移除，截图需单独生成。")


if __name__ == "__main__":
    main()
