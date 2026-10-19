#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '请先安装 Node.js 24，然后重新运行。'
  read -k 1
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci || exit $?
fi
npm run dev
