#!/usr/bin/env node
// 文件作用：try_it_out 的“第 3 步模拟出错”示例 —— 编译、运行、功能都正常，
// 只有 --version 命令存在一个用户操作层面的 bug（打印错误并退出 1）。
// 预期：dsh-code-checker 第 1、2 步通过，第 3 步真实模拟发现“CLI 命令报错”并汇报，退出码 1。
const args = process.argv.slice(2)                          // 取命令行参数
if (args.includes('--help') || args.includes('-h')) {       // --help：正常
  console.log('Usage: broken-cli [--help] [--version] [--greet <name>]') // 打印用法
  process.exit(0)                                           // 正常退出
}
if (args.includes('--version') || args.includes('-V')) {    // --version：藏着一个 bug
  console.error('Error: version flag broken in broken-cli') // 打印错误（模拟 UI 层缺陷）
  process.exit(1)                                           // 异常退出（构建/运行探针都不会发现它）
}
if (args[0] === '--greet') {                                // greet：正常
  console.log('Hello, ' + (args[1] || 'world') + '!')       // 打印问候
  process.exit(0)                                           // 正常退出
}
console.log('broken-cli ready. Try --help.')                // 无参数默认提示（运行探针走这条，正常）
