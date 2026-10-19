"""Independent stdlib-only check; does not import the JS analysis implementation."""
import csv
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fractions import Fraction

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / "render.config.json").read_text())
raw_bytes = (ROOT / config["source"]).read_bytes()
assert hashlib.sha256(raw_bytes).hexdigest() == config["sha256"]
with (ROOT / config["source"]).open(encoding="utf-8-sig", newline="") as f:
    original = list(csv.DictReader(f))
unique = {}
for row in original:
    if row["job_id"] in unique:
        assert unique[row["job_id"]] == row, "conflicting duplicate"
    unique[row["job_id"]] = row
rows = list(unique.values())
for row in rows:
    submitted = datetime.fromisoformat(row["created_at"])
    synced = datetime.fromisoformat(row["asset_synced_at"].replace("Z", "+00:00"))
    assert submitted.tzinfo and synced.tzinfo
    row["age"] = (submitted - synced).total_seconds() / 60
    row["day"] = submitted.astimezone(timezone(timedelta(hours=8))).date().isoformat()
    assert row["age"] >= 0

expected = json.loads((ROOT / "results/render-metrics.json").read_text())
assert len(original) == expected["source"]["rawRows"] == 1005
assert len(rows) == expected["source"]["uniqueJobs"] == 957
assert len(original) - len(rows) == expected["source"]["duplicatesRemoved"] == 48

def verify(group, result, predicate=None):
    predicate = predicate or (lambda r: r["age"] >= config["selectedLagMinutes"])
    hit = [r for r in group if predicate(r)]
    failed = sum(r["is_success"] == "0" for r in group)
    success = sum(r["is_success"] == "1" for r in group)
    caught = sum(r["is_success"] == "0" for r in hit)
    false = sum(r["is_success"] == "1" for r in hit)
    assert result["jobs"] == len(group)
    assert result["failed"] == failed
    assert result["succeeded"] == success
    assert result["unknown"] == len(group) - failed - success
    assert result["intercepted"] == len(hit)
    assert result["caughtFailures"] == caught
    assert result["falseInterceptions"] == false
    assert result["interceptedUnknown"] == len(hit) - caught - false
    assert result["netHoursAtFullEffect"] == caught * 120 - len(hit) * 20
    assert result["netHoursAtHalfEffect"] == caught * 60 - len(hit) * 20
    assert result["missedFailures"] == failed - caught
    if failed:
        assert abs(result["recall"] - caught / failed) < 1e-12
    if caught + false:
        assert abs(result["knownPrecision"] - caught / (caught + false)) < 1e-12
    if caught:
        assert abs(result["breakEvenEffectiveness"] - len(hit) * 20 / (caught * 120)) < 1e-12
    return hit

hits = verify(rows, expected["all"])
verify([r for r in rows if r["day"] <= config["trainThrough"]], expected["train"])
verify([r for r in rows if r["day"] >= config["validationFrom"]], expected["validation"])
with (ROOT / "results/interception-queue.csv").open(encoding="utf-8-sig", newline="") as f:
    exported = list(csv.DictReader(f))
assert {r["job_id"] for r in exported} == {r["job_id"] for r in hits}
assert len(exported) == len(hits) == 272
assert expected["all"]["netHoursAtFullEffect"] == 8000
assert expected["all"]["netHoursAtHalfEffect"] == 1280
assert expected["validation"]["netHoursAtHalfEffect"] == 340

# Independently rebuild all 35 rules from raw fields, including validation counts.
rules = {"none": lambda r: False, "all": lambda r: True}
for lag in [10, 15, 20, 25, 30, 40, 60]:
    rules[f"lag-{lag}"] = lambda r, lag=lag: r["age"] >= lag
for mem in [0, 1, 2, 3, 5, 8]:
    rules[f"mem-{mem}"] = lambda r, mem=mem: float(r["gpu_mem_free_mb"]) <= mem
for lag in [15, 20, 25, 30]:
    for mem in [0, 1, 2, 3, 5]:
        rules[f"lag-{lag}-or-mem-{mem}"] = lambda r, lag=lag, mem=mem: (
            r["age"] >= lag or float(r["gpu_mem_free_mb"]) <= mem
        )
train = [r for r in rows if r["day"] <= config["trainThrough"]]
validation = [r for r in rows if r["day"] >= config["validationFrom"]]
saved = {c["id"]: c for c in expected["candidates"]}
assert saved.keys() == rules.keys()
lines = {}
for name, predicate in rules.items():
    hit = verify(train, saved[name]["train"], predicate)
    verify(validation, saved[name]["validation"], predicate)
    lines[name] = (120 * sum(r["is_success"] == "0" for r in hit), 20 * len(hit))

def as_fraction(value):
    result = Fraction(value["numerator"], value["denominator"])
    assert abs(float(result) - value["value"]) < 1e-12
    return result

def best_at(alpha):
    nets = {name: slope * alpha - cost for name, (slope, cost) in lines.items()}
    maximum = max(nets.values())
    return sorted(name for name, net in nets.items() if net == maximum)

envelope = expected["ruleSensitivity"]
assert envelope["candidateCount"] == 35
assert [s["preferredRuleId"] for s in envelope["segments"]] == ["none", "lag-30", "lag-25", "lag-20"]
last = Fraction(0)
for segment in envelope["segments"]:
    lo, hi = as_fraction(segment["from"]), as_fraction(segment["to"])
    assert lo == last and lo < hi
    winner = segment["preferredRuleId"]
    slope, cost = lines[winner]
    # A linear difference nonnegative at both endpoints is nonnegative throughout.
    for other_slope, other_cost in lines.values():
        for endpoint in (lo, hi):
            assert (slope - other_slope) * endpoint - (cost - other_cost) >= 0
    assert best_at((lo + hi) / 2) == segment["ruleIds"]
    last = hi
assert last == 1
assert [as_fraction(b["effectiveness"]) for b in envelope["boundaries"]] == [
    Fraction(0), Fraction(2, 5), Fraction(5, 12), Fraction(4, 9), Fraction(1)
]
for boundary in envelope["boundaries"]:
    tied = best_at(as_fraction(boundary["effectiveness"]))
    assert tied == boundary["ruleIds"]
    assert boundary["preferredRuleId"] == min(tied, key=lambda name: (lines[name][1], name))
assert best_at(Fraction(403, 1000)) == ["lag-30"]
assert best_at(Fraction(43, 100)) == ["lag-25"]
assert best_at(Fraction(1, 2)) == ["lag-20"]

def verify_counts(group, result):
    failed = sum(r["is_success"] == "0" for r in group)
    succeeded = sum(r["is_success"] == "1" for r in group)
    assert (result["jobs"], result["failed"], result["succeeded"], result["unknown"], result["known"]) == (
        len(group), failed, succeeded, len(group) - failed - succeeded, failed + succeeded
    )
    rate = failed / (failed + succeeded) if failed + succeeded else None
    if rate is None:
        assert result["failureRate"] is None
    else:
        assert abs(result["failureRate"] - rate) < 1e-12

for field, report_key, summary in zip(
    ["team_id", "scene_type", "day"], ["byTeam", "byScene", "byDay"], expected["stratification"]["groups"]
):
    groups = expected[report_key]
    assert {g["name"] for g in groups} == {r[field] for r in rows}
    positive = comparable = 0
    for group in groups:
        source = [r for r in rows if r[field] == group["name"]]
        verify_counts(source, group)
        verify(source, group["policy"])
        verify_counts([r for r in source if r["age"] < config["selectedLagMinutes"]], group["below"])
        verify_counts([r for r in source if r["age"] >= config["selectedLagMinutes"]], group["above"])
        below, above = group["below"]["failureRate"], group["above"]["failureRate"]
        if below is not None and above is not None:
            comparable += 1
            positive += above > below
            assert abs(group["failureRateDifference"] - (above - below)) < 1e-12
        else:
            assert group["failureRateDifference"] is None
    assert (summary["total"], summary["comparable"], summary["positive"]) == (len(groups), comparable, positive)
overseas = next(g for g in expected["byTeam"] if g["name"] == "海外定制组")["policy"]
assert (overseas["intercepted"], overseas["caughtFailures"], overseas["interceptedUnknown"], overseas["netHoursAtHalfEffect"]) == (69, 13, 1, -600)
validation_best = max(saved, key=lambda name: (saved[name]["validation"]["netHoursAtFullEffect"], -saved[name]["validation"]["intercepted"]))
assert expected["validationComparison"]["bestCandidateId"] == validation_best == "lag-20-or-mem-1"
assert expected["validationComparison"]["bestNetHoursAtFullEffect"] == 2340
assert expected["validationComparison"]["selectedNetHoursAtFullEffect"] == 2200
assert expected["thresholdSupport"]["nearestBelow"] == max(r["age"] for r in rows if r["age"] < 20) == 18
assert expected["thresholdSupport"]["nearestAtOrAbove"] == min(r["age"] for r in rows if r["age"] >= 20) == 22
print("独立 Python 标准库复核通过：原数据、三段收益、272 条清单、35 项候选、完整有效比例区间及团队/场景/日期分层一致。")
