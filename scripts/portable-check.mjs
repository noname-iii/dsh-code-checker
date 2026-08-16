#!/usr/bin/env node
// 文件作用：验证发布包“可移植性”的脚本 —— 模拟用户把插件下载到任意目录后开箱即用。
//
// 它做四件事：
//   1. 把项目（按发布白名单，排除 node_modules 等本机依赖）复制到一个全新临时目录；
//   2. 在副本里扫描：不包含本机绝对路径、API key 等敏感内容；
//   3. 在副本里运行 CLI 冒烟测试（无参数打印用法退出 0、detect 子命令、检查 healthy-cli 示例）；
//   4. 打印结论。
// 用法：
//   node scripts/portable-check.mjs                # 完整检查（需要能启动子进程的环境）
//   node scripts/portable-check.mjs --scan-only    # 只复制+扫描敏感内容（沙箱内也可跑）
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs' // 文件操作
import { join, dirname } from 'node:path'          // 路径工具
import { fileURLToPath } from 'node:url'           // import.meta.url → 路径
import { spawnSync } from 'node:child_process'     // 运行 CLI 冒烟命令
import { tmpdir } from 'node:os'                   // 系统临时目录

const here = dirname(fileURLToPath(import.meta.url)) // 本脚本目录（scripts/）
const root = join(here, '..')                        // 插件根目录
const scanOnly = process.argv.includes('--scan-only') // 是否只做敏感扫描（不需要子进程）
// 可选的目标目录参数：取“去 -- 选项后”的最后一个位置参数；没有则用系统临时目录
const positional = process.argv.slice(2).filter(a => !a.startsWith('--')) // 位置参数（跳过 node 与脚本自身）
const target = positional.length > 0 ? positional[positional.length - 1] : join(tmpdir(), 'dsh-code-checker-portable-' + Date.now()) // 副本目录

// 发布白名单（与 package.json 的 files 一致，另加配置文件）
const INCLUDE = ['lib', 'simulators', 'scripts', 'examples', 'try_it_out', 'tests',
  'cordis.patch.yml', 'README.md', 'README.zh.md', '需求.txt', 'package.json',
  'tsconfig.json', 'tsconfig.build.json', 'tsconfig.paths.json', '.gitignore']

// 安全闸：目标目录必须位于系统临时目录下（防止误删其他目录）
if (!target.includes(tmpdir())) {
  console.error('[portable-check] 拒绝：目标目录必须位于系统临时目录下（当前: ' + target + '）。')
  process.exit(1)
}
console.log('[portable-check] 复制项目到: ' + target)
rmSync(target, { recursive: true, force: true })     // 清掉旧副本（已在临时目录内，安全）
mkdirSync(target, { recursive: true })               // 新建副本目录
for (const name of INCLUDE) {                        // 逐个白名单条目复制
  const src = join(root, name)
  if (!existsSync(src)) continue                     // 不存在则跳过
  cpSync(src, join(target, name), { recursive: true, filter: (s) => !s.includes('node_modules') }) // 复制（排除 node_modules）
}
// tsconfig.paths.json 是开发者本机生成的文件（含本机路径，约定不提交）：
// 副本中用仓库应提交的空映射版本替换，模拟真实发布内容。
writeFileSync(join(target, 'tsconfig.paths.json'), '{\n  "compilerOptions": {}\n}\n', 'utf8')

// ── 检查 1：副本内不得出现本机绝对路径 / API key ──
console.log('[portable-check] 扫描敏感内容…')
const SENSITIVE = /(C:\Users\[A-Za-z0-9_\-]+\|D:\AI|D:\Users|sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{16,})/i // 本机盘符路径/密钥形状
let hits = 0                                         // 命中计数
const walk = (dir) => {                              // 递归扫描
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)                // 绝对路径
    if (entry.isDirectory()) { walk(abs); continue } // 目录递归
    if (statSync(abs).size > 2_000_000) continue     // 超大文件跳过（不可能是源码）
    let text
    try { text = readFileSync(abs, 'utf8') } catch { continue } // 二进制/不可读跳过
    for (const [index, line] of text.split('\n').entries()) { // 逐行检查
      if (SENSITIVE.test(line)) { hits++; console.log('  命中: ' + abs + ':' + (index + 1) + ' → ' + line.trim().slice(0, 100)) }
    }
  }
}
walk(target)
if (hits > 0) {                                      // 有敏感内容 = 不可移植
  console.error('[portable-check] 失败：副本内发现 ' + hits + ' 处本机路径/密钥痕迹。')
  process.exit(1)
}
console.log('[portable-check] 敏感内容检查通过（0 命中）。')

if (scanOnly) {                                      // 只扫描模式到此为止
  console.log('[portable-check] 仅扫描模式完成。副本位于: ' + target)
  process.exit(0)
}

// ── 检查 2：CLI 冒烟（无参数 → 用法 + 退出 0）──
const node = process.execPath                         // 当前 node
const cli = join(target, 'lib', 'cli', 'index.js')   // 副本 CLI 入口
let r = spawnSync(node, [cli], { stdio: 'inherit' }) // 无参数运行
if (r.status !== 0) {
  console.error('[portable-check] 失败：CLI 无参数运行退出码 ' + r.status + '（预期 0）。')
  process.exit(1)
}
console.log('[portable-check] CLI 无参数冒烟通过（退出 0）。')

// ── 检查 3：detect 子命令 ──
r = spawnSync(node, [cli, 'detect', target], { stdio: 'inherit' }) // 识别副本自身
if (r.status !== 0) {
  console.error('[portable-check] 失败：detect 子命令退出码 ' + r.status + '（预期 0）。')
  process.exit(1)
}
console.log('[portable-check] detect 子命令通过。')

// ── 检查 4：真实检查 healthy-cli 示例（不装依赖、不用 LLM）──
r = spawnSync(node, [cli, 'check', join(target, 'try_it_out', 'healthy-cli'), '--no-install', '--no-llm', '--json'], { stdio: 'inherit' }) // 三步检查
if (r.status !== 0) {
  console.error('[portable-check] 失败：healthy-cli 检查退出码 ' + r.status + '（预期 0 = 没有问题）。')
  process.exit(1)
}
console.log('[portable-check] healthy-cli 三步检查通过（没有问题）。')
console.log('')
console.log('[portable-check] 全部通过：项目下载到任意目录即可直接使用。副本位于: ' + target)
