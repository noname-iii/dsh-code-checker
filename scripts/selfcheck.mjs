#!/usr/bin/env node
// 文件作用：dsh-code-checker 的自检脚本 —— 用插件自己的 CLI 检查插件自己的源码目录（吃自己的狗粮）。
//
// 自检流程（对应插件的三步流水线）：
//   第 1 步：类型检查 + 构建（等价于“编译检查”）；
//   第 2 步：单元测试 + 用插件 CLI 对照 需求.txt 核对本插件功能是否全部实现；
//   第 3 步：对 try_it_out 的示例项目跑真实 CLI 模拟，验证预期退出码。
// 全部通过 → 输出“没有问题”并退出 0；任何一步失败 → 退出 1。
//
// 用法：node scripts/selfcheck.mjs   （或 npm run selfcheck）
import { spawnSync } from 'node:child_process' // 同步执行子命令
import { dirname, join } from 'node:path'      // 路径工具
import { fileURLToPath } from 'node:url'       // import.meta.url → 路径

const here = dirname(fileURLToPath(import.meta.url)) // 本脚本所在目录（scripts/）
const root = join(here, '..')                         // 插件根目录

/** 运行一条命令（stdio 透传），返回其退出码。 */
function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...opts }) // 同步执行
  return result.status ?? 1                               // 返回退出码
}

console.log('== dsh-code-checker 自检开始 ==')
console.log('')
console.log('[第1步] 类型检查')
let code = run(process.execPath, [join(here, 'build.mjs'), '--typecheck']) // 运行 tsc 类型检查
if (code !== 0) {                                         // 失败即止
  console.error('[第1步] 类型检查失败，请修复后重试。')
  process.exit(1)
}
console.log('')
console.log('[第1步] 构建')
code = run(process.execPath, [join(here, 'build.mjs')])   // 构建 lib/
if (code !== 0) {                                         // 失败即止
  console.error('[第1步] 构建失败，请修复后重试。')
  process.exit(1)
}
console.log('')
console.log('[第2步] 单元测试（引擎 + Harness 层）')
code = run(process.execPath, ['--test', '--experimental-test-isolation=none', join(root, 'tests', 'engine.test.mjs'), join(root, 'tests', 'harness.test.mjs')]) // 全部测试
if (code !== 0) {                                         // 失败即止
  console.error('[第2步] 测试失败，请修复后重试。')
  process.exit(1)
}
console.log('')
console.log('[第2步] 用插件检查插件本身（对照 需求.txt）')
code = run(process.execPath, [                            // 自检 CLI：检查插件自己的源码目录
  join(root, 'lib', 'cli', 'index.js'), 'check', root,
  '--no-install', '--no-llm', '--build-timeout', '120000',
])
if (code !== 0) {                                         // 有“问题”即止
  console.error('[第2步] 自检发现问题（详见上方报告），请修复后重试。')
  process.exit(1)
}
console.log('')
console.log('[第3步] try_it_out 示例项目模拟检查（健康 / 构建失败 / 功能缺失）')
for (const fixture of ['healthy-cli', 'broken-build', 'missing-feature']) { // 三个核心示例
  const fixtureCode = run(process.execPath, [             // 对每个示例跑 CLI 检查
    join(root, 'lib', 'cli', 'index.js'), 'check', join(root, 'try_it_out', fixture),
    '--no-install', '--no-llm', '--json',
  ], { stdio: 'inherit' })
  // healthy 应退出 0；broken-build / missing-feature 应退出 1（检查出问题）
  if (fixture === 'healthy-cli' ? fixtureCode !== 0 : fixtureCode !== 1) {
    console.error('[第3步] 示例项目 ' + fixture + ' 检查结果不符合预期（退出码 ' + fixtureCode + '）。')
    process.exit(1)
  }
  console.log('[第3步] ' + fixture + ' 检查结果符合预期（退出码 ' + fixtureCode + '）')
}
console.log('')
console.log('== 自检完成：没有问题 ==')
