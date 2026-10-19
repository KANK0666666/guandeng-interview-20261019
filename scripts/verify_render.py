"""Independent stdlib-only check; does not import the JS analysis implementation."""
import csv
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

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

def verify(group, result):
    hit = [r for r in group if r["age"] >= config["selectedLagMinutes"]]
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
print("独立 Python 标准库复核通过：数据、时区、去重、分母、三段成本收益及 272 条清单一致。")
