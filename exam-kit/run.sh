#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
compatible() {
  command -v "$1" >/dev/null 2>&1 || return 1
  "$1" -c 'import sys, pandas, numpy; assert sys.version_info >= (3, 12); assert 2 <= int(pandas.__version__.split(".")[0]) < 4' >/dev/null 2>&1
}
pick_python() {
  local candidate
  if [ -n "${PYTHON:-}" ]; then
    compatible "$PYTHON" && { echo "$PYTHON"; return 0; }
    return 1
  fi
  for candidate in .venv/bin/python python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 python3.13 python3.12; do
    if compatible "$candidate"; then echo "$candidate"; return 0; fi
  done
  return 1
}
if ! PY="$(pick_python)"; then
  cat >&2 <<'EOF'
[错误] 找不到兼容的 Python 3.12+ / pandas 2 或 3 / NumPy 环境。
请在 exam-kit 目录执行：
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
如果设置了 PYTHON，请确认它指向正确解释器；不会静默忽略指定值。
EOF
  exit 1
fi
OPEN=0
SCREENSHOT=0
TEST=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --open) OPEN=1 ;;
    --screenshot) SCREENSHOT=1 ;;
    --test) TEST=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done
printf '解释器：%s\n' "$PY"
if [ "$TEST" = 1 ]; then
  "$PY" -m unittest discover -s tests -v
  exit $?
fi
if [ "$SCREENSHOT" = 1 ]; then
  for arg in ${ARGS[@]+"${ARGS[@]}"}; do
    if [ "$arg" = --no-html ]; then
      echo '[错误] --screenshot 与 --no-html 不能同时使用。' >&2
      exit 1
    fi
  done
fi
"$PY" analysis.py ${ARGS[@]+"${ARGS[@]}"}
if [ "$SCREENSHOT" = 1 ]; then
  "$PY" screenshot.py
fi
if [ "$OPEN" = 1 ] && [ -f index.html ]; then
  "$PY" -c 'from pathlib import Path; import webbrowser; webbrowser.open(Path("index.html").resolve().as_uri())'
fi
