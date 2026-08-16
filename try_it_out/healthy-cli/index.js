#!/usr/bin/env node
// 文件作用：try_it_out 的“健康项目”示例 —— 一个功能完整的 Node CLI。
// 预期：dsh-code-checker 三步全部通过，返回“没有问题”。
const args = process.argv.slice(2)                        // 取命令行参数（去掉 node 与脚本路径）
if (args.includes('--help') || args.includes('-h')) {     // 用户请求帮助（--help 或 -h）
  console.log('Usage: healthy-cli [--help] [--version] [--greet <name>]') // 打印用法
  process.exit(0)                                         // 正常退出 0
}
if (args.includes('--version') || args.includes('-V')) {  // 用户请求版本（--version 或 -V）
  console.log('healthy-cli v1.0.0')                       // 打印版本号
  process.exit(0)                                         // 正常退出 0
}
if (args[0] === '--greet') {                              // 打招呼命令（--greet）
  const name = args[1] || 'world'                         // 名字参数，缺省 world
  console.log('Hello, ' + name + '!')                     // 打印问候语
  process.exit(0)                                         // 正常退出 0
}
console.log('healthy-cli ready. Try --help.')             // 无参数时的默认提示
