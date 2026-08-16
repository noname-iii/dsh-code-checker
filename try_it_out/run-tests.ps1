# 文件作用：Windows 用户的一键测试脚本。
# 用法（在 PowerShell 中，从本文件所在目录或任意目录运行）：
#   powershell -ExecutionPolicy Bypass -File try_it_out/run-tests.ps1
# 脚本会依次对 4 个示例项目运行 dsh-code-checker 的 CLI 检查，
# 并打印每个项目“预期结果 vs 实际结果”，全部符合预期则退出码为 0。
$ErrorActionPreference = 'Continue'  # 不要用 Stop：CLI 会把进度日志写到 stderr，PowerShell 5.1 会将其当作错误记录导致脚本中断

# 定位插件根目录（本脚本位于 <插件根>/try_it_out/run-tests.ps1）
$root = Split-Path -Parent $PSScriptRoot
# CLI 入口（插件根/lib/cli/index.js）
$cli = Join-Path $root 'lib/cli/index.js'
# 示例项目目录（插件根/try_it_out）
$demo = Join-Path $root 'try_it_out'
# node 可执行文件（直接用 node 运行 CLI）
$node = (Get-Command node -ErrorAction Stop).Source

# 测试项定义：项目名 = 预期退出码（0=没有问题；1=发现问题）
$cases = @(
  @{ name = 'healthy-cli';    expected = 0 }
  @{ name = 'broken-build';   expected = 1 }
  @{ name = 'missing-feature'; expected = 1 }
  @{ name = 'broken-cli';     expected = 1 }  # 第 1、2 步都过、只有第 3 步模拟出错
)

$failed = 0
foreach ($case in $cases) {
  # 逐个运行检查：--no-install 避免真实安装依赖；--no-llm 使用启发式（无需联网/API key）
  $dir = Join-Path $demo $case.name
  Write-Host "=== 检查示例项目: $($case.name) (预期退出码 $($case.expected)) ===" -ForegroundColor Cyan
  & $node $cli check $dir --no-install --no-llm --json 2>&1 | Out-Null  # 2>&1 兼容 PS 5.1 捕获原生 stderr（*> 对原生命令无效）
  $actual = $LASTEXITCODE
  # 对比实际退出码与预期
  if ($actual -eq $case.expected) {
    Write-Host "[PASS] $($case.name): 退出码 $actual（符合预期）" -ForegroundColor Green
  } else {
    Write-Host "[FAIL] $($case.name): 预期 $($case.expected)，实际 $actual" -ForegroundColor Red
    $failed++
  }
}

# 静态 Web 项目：单独跑一次完整三步（会尝试 127.0.0.1 端口探测 + 浏览器模拟回退）
$webDir = Join-Path $demo 'web-static'
Write-Host "=== 检查示例项目: web-static（静态网页，预期“没有问题”或提示 Playwright 未安装）===" -ForegroundColor Cyan
& $node $cli check $webDir --no-install --no-llm --json 2>&1 | Out-Null  # 同上，捕获 stderr 避免中断
$webExit = $LASTEXITCODE
if ($webExit -eq 0) {
  Write-Host "[PASS] web-static: 退出码 0（没有问题）" -ForegroundColor Green
} else {
  # 静态站检查结果取决于机器是否安装了 Playwright；这里只提示不判失败
  Write-Host "[INFO] web-static: 退出码 $webExit（若未安装 Playwright，浏览器自动化为 HTTP 探针回退）" -ForegroundColor Yellow
}

Write-Host ''
if ($failed -eq 0) {
  Write-Host "全部核心示例测试通过：插件三步检查工作正常。" -ForegroundColor Green
  exit 0
} else {
  Write-Host "$failed 个示例测试未通过，请检查插件是否完整。" -ForegroundColor Red
  exit 1
}
