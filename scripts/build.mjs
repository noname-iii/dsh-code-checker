#!/usr/bin/env node
// 文件作用：dsh-code-checker 的构建 / 类型检查脚本（自包含，无需安装依赖即可运行）。
//
// 关键设计（发布可移植性）：
//   - 发布包内已附带构建好的 lib/；只有当 lib 缺失或比源码旧时才真正编译。
//     GitHub 安装（git clone + pnpm prepare）时 lib 是新的 → 直接跳过，
//     因此普通用户机器上【不需要】安装 TypeScript；
//   - 找不到 tsc 且 lib 可用时只告警不失败；lib 也不可用时才报错并给出指引；
//   - TypeScript 解析顺序：
//       1. $CODECHECKER_TSC —— 指向 tsc.js 的绝对路径
//       2. 本包内的 node_modules/typescript/lib/tsc.js
//       3. 从脚本位置按 Node 解析 'typescript'
//       4. 报错并给出指引（见下）
//
// 用法：
//   node scripts/build.mjs            # 增量构建（lib 新鲜则跳过）
//   node scripts/build.mjs --force    # 强制重建
//   node scripts/build.mjs --typecheck# 仅类型检查（tsconfig.json，noEmit）
import { spawnSync } from 'node:child_process'             // 同步执行 tsc
import { existsSync, readdirSync, statSync } from 'node:fs' // 文件存在性/目录读取/修改时间
import { createRequire } from 'node:module'                // 解析 typescript 包位置
import { fileURLToPath } from 'node:url'                   // import.meta.url → 路径
import { dirname, join } from 'node:path'                  // 路径拼接工具

const here = dirname(fileURLToPath(import.meta.url))       // 本脚本所在目录（scripts/）
const pkgRoot = join(here, '..')                           // 插件根目录
const typecheckOnly = process.argv.includes('--typecheck') // 是否仅类型检查
const force = process.argv.includes('--force')             // 是否强制重建

/** 定位 tsc.js（找不到返回 undefined）。 */
function findTsc() {
  const candidates = []                                    // 候选路径列表
  if (process.env.CODECHECKER_TSC) candidates.push(process.env.CODECHECKER_TSC) // 1. 环境变量
  candidates.push(join(pkgRoot, 'node_modules', 'typescript', 'lib', 'tsc.js')) // 2. 包内安装
  try {
    const require = createRequire(import.meta.url)         // 3. 从本脚本位置解析
    candidates.push(require.resolve('typescript/lib/tsc.js'))
  } catch {
    // 不可解析则忽略（落入后面的报错指引）
  }
  for (const candidate of candidates) {                    // 返回第一个存在的候选
    if (candidate && existsSync(candidate)) return candidate
  }
  return undefined
}

/** 收集 src/engine/cli 下所有源文件的最晚修改时间。 */
function newestSourceMtime() {
  let newest = 0                                           // 最晚修改时间初值
  for (const dir of ['src', 'engine', 'cli']) {            // 三个源码目录
    const walk = (current) => {                            // 递归遍历
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const abs = join(current, entry.name)              // 绝对路径
        if (entry.isDirectory()) walk(abs)                 // 子目录递归
        else if (/\.ts$/.test(entry.name)) {               // 只看 .ts 源文件
          newest = Math.max(newest, statSync(abs).mtimeMs) // 更新最晚时间
        }
      }
    }
    walk(join(pkgRoot, dir))                               // 从每个源码目录开始
  }
  return newest
}

/** lib 产物是否完整且比源码新（即“无需重建”）。 */
function libIsFresh() {
  const artifacts = [                                      // 关键产物（三入口）
    join(pkgRoot, 'lib', 'src', 'index.js'),
    join(pkgRoot, 'lib', 'engine', 'index.js'),
    join(pkgRoot, 'lib', 'cli', 'index.js'),
  ]
  if (!artifacts.every(p => existsSync(p))) return false   // 缺产物 → 需要重建
  return artifacts.every(p => statSync(p).mtimeMs >= newestSourceMtime()) // 全部比源码新
}

const tsc = findTsc()                                      // 定位 tsc.js

// 增量构建：lib 新鲜且未强制时直接跳过（发布包安装的关键路径）
if (!typecheckOnly && !force && tsc && libIsFresh()) {
  console.log('[build] lib/ 产物已是最新，跳过构建。')
  process.exit(0)
}

if (!tsc) {                                                // 找不到 tsc
  // 发布包可移植性关键：git clone/checkout 写文件的 mtime 顺序不保证 lib 比源码新，
  // 因此在“没有 TypeScript 的用户机器”上，只要 lib 产物存在就跳过构建——
  // 不依赖 mtime 新鲜度（那是开发机上的增量判断）。
  const artifactsExist = () => [                          // lib 产物存在性判断
    join(pkgRoot, 'lib', 'src', 'index.js'),
    join(pkgRoot, 'lib', 'engine', 'index.js'),
    join(pkgRoot, 'lib', 'cli', 'index.js'),
  ].every(p => existsSync(p))
  if (!typecheckOnly && artifactsExist()) {               // 产物存在 → 只告警并继续（正常安装无需 TypeScript）
    console.warn('[build] 未找到 TypeScript，但 lib/ 产物已存在，跳过构建（正常安装无需 TypeScript）。')
    process.exit(0)
  }
  console.error('[build] 找不到 TypeScript (tsc.js)。')     // lib 缺失 → 报错指引
  console.error('  选项 1: 设置 CODECHECKER_TSC 环境变量指向 tsc.js，例如：')
  console.error('    $env:CODECHECKER_TSC="C:/path/to/node_modules/typescript/lib/tsc.js"')
  console.error('  选项 2: 在本包目录执行 npm i -D typescript @types/node 后再构建。')
  console.error('  （发布包内已附带 lib/ 产物；只有当 lib 缺失或源码被修改时才需要重建。）')
  process.exit(1)
}

// 组装 tsc 参数：类型检查用 tsconfig.json（noEmit），构建用 tsconfig.build.json
const args = typecheckOnly
  ? [tsc, '-p', join(pkgRoot, 'tsconfig.json')]
  : [tsc, '-p', join(pkgRoot, 'tsconfig.build.json')]

const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: pkgRoot }) // 执行 tsc
if (result.error) {                                        // 启动失败
  console.error('[build] 执行 tsc 失败:', result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)                           // 传递 tsc 退出码
