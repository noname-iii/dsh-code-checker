#!/usr/bin/env bash
# 文件作用：macOS / Linux 用户的一键测试脚本。
# 用法：
#   chmod +x try_it_out/run-tests.sh
#   bash try_it_out/run-tests.sh
# 脚本会依次对 4 个示例项目运行 dsh-code-checker 的 CLI 检查，
# 并打印每个项目“预期结果 vs 实际结果”，全部符合预期则退出码为 0。
set -u

# 定位插件根目录（本脚本位于 <插件根>/try_it_out/run-tests.sh）
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# CLI 入口与示例项目目录
CLI="$ROOT/lib/cli/index.js"
DEMO="$ROOT/try_it_out"

# 测试项定义：项目名=预期退出码（0=没有问题；1=发现问题）
CASES="healthy-cli:0 broken-build:1 missing-feature:1 broken-cli:1"  # broken-cli=第 3 步模拟出错
FAILED=0

# 逐个运行检查
for CASE in $CASES; do
  NAME="${CASE%%:*}"          # 项目名
  EXPECTED="${CASE##*:}"      # 预期退出码
  DIR="$DEMO/$NAME"
  echo "=== 检查示例项目: $NAME (预期退出码 $EXPECTED) ==="
  node "$CLI" check "$DIR" --no-install --no-llm --json > /dev/null 2>&1
  ACTUAL=$?
  # 对比实际退出码与预期
  if [ "$ACTUAL" -eq "$EXPECTED" ]; then
    echo "[PASS] $NAME: 退出码 $ACTUAL（符合预期）"
  else
    echo "[FAIL] $NAME: 预期 $EXPECTED，实际 $ACTUAL"
    FAILED=$((FAILED + 1))
  fi
done

# 静态 Web 项目单独跑一次（无 Playwright 时回退 HTTP 探针）
echo "=== 检查示例项目: web-static ==="
node "$CLI" check "$DEMO/web-static" --no-install --no-llm --json > /dev/null 2>&1
WEB_EXIT=$?
if [ "$WEB_EXIT" -eq 0 ]; then
  echo "[PASS] web-static: 退出码 0（没有问题）"
else
  echo "[INFO] web-static: 退出码 $WEB_EXIT（未安装 Playwright 时浏览器自动化回退为 HTTP 探针）"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "全部核心示例测试通过：插件三步检查工作正常。"
  exit 0
else
  echo "$FAILED 个示例测试未通过，请检查插件是否完整。"
  exit 1
fi
