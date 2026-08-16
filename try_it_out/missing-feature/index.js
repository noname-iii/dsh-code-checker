#!/usr/bin/env node
// 文件作用：try_it_out 的“功能缺失”示例 —— 只实现了 greet，缺少登录与导出。
// 预期：dsh-code-checker 第 2 步一次性汇报“登录、导出”两项未实现，第 3 步跳过，退出码 1。
const args = process.argv.slice(2)          // 取命令行参数
if (args[0] === 'greet') {                  // 只实现了 greet 命令
  console.log('hi ' + (args[1] || 'there')) // 打印问候
  process.exit(0)                           // 正常退出
}
console.log('missing-feature v1.0.0')       // 无参数时的默认输出
