#!/usr/bin/env node
// 文件作用：为“从源码开发/重建本插件”的开发者生成本机的 tsconfig.paths.json。
//
// 发布包内已附带构建好的 lib/，普通用户无需 TypeScript 与 paths 映射；
// 只有想修改 src/engine/cli 源码并重新构建的开发者需要让 TypeScript 解析
// @deepseek-ai/* 类型包 —— 而这些类型包位于本机的一份 deepseek-harness
// 源码检出一（checkout）中。
//
// 本脚本自动定位 harness 检出一（按以下顺序）：
//   1. 环境变量 DSH_HARNESS_DIR（指向 checkout 根目录）
//   2. 从当前目录向上查找含 packages/core/agent/lib/types 与 vendor/cordis 的目录
// 然后扫描其中的 packages/*/* 与 vendor/*，生成：
//   tsconfig.paths.json —— { compilerOptions: { paths: { 包名: [d.ts 路径] }, typeRoots: [...] } }
// tsconfig.json 通过 "extends" 引用它；仓库内提交了空的 tsconfig.paths.json，
// 因此克隆下来的项目不带任何本机路径，下载到哪里都能直接使用（跑 lib 即可）。
//
// 用法：
//   node scripts/gen-tsconfig.mjs [DSH_HARNESS_DIR]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本脚本所在目录（<插件根>/scripts）
const here = dirname(fileURLToPath(import.meta.url))
// 插件根目录
const root = join(here, '..')

/** 判断一个目录是否像 deepseek-harness 检出一。 */
function looksLikeHarness(dir) {
  return existsSync(join(dir, 'packages', 'core', 'agent', 'lib', 'types', 'index.d.ts'))
    && existsSync(join(dir, 'vendor', 'cordis'))
    && existsSync(join(dir, 'node_modules', '@types', 'node'))
}

/** 自动定位 harness 检出一：从给定目录逐级向上查找。 */
function findHarness(startDir) {
  let current = resolve(startDir)
  for (let i = 0; i < 6; i++) {
    if (looksLikeHarness(current)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

// 1) 优先用环境变量/参数指定的目录
let harnessDir = process.argv[2] ?? process.env.DSH_HARNESS_DIR
if (harnessDir && !looksLikeHarness(harnessDir)) {
  console.error('[gen-tsconfig] 指定目录不像 deepseek-harness 检出一: ' + harnessDir)
  process.exit(1)
}
// 2) 自动向上查找
if (!harnessDir) {
  harnessDir = findHarness(process.cwd())
}
// 3) 找不到时输出空映射（tsc 只在引用 @deepseek-ai 包时才会报错）
if (!harnessDir) {
  console.log('[gen-tsconfig] 未找到 deepseek-harness 检出一，写入空 paths（发布包无需它，直接使用 lib/ 即可）。')
  writeFileSync(join(root, 'tsconfig.paths.json'), JSON.stringify({ compilerOptions: {} }, null, 2) + '\n', 'utf8')
  process.exit(0)
}

// 扫描 harness 的 packages/*/* 与 vendor/* 包，收集 包名 → d.ts 路径
const paths = {}
const dirs = [join(harnessDir, 'packages'), join(harnessDir, 'vendor')]
for (const base of dirs) {
  if (!existsSync(base)) continue
  for (const group of readdirSync(base, { withFileTypes: true })) {
    if (!group.isDirectory() && !group.isSymbolicLink()) continue
    // vendor 下的包直接位于 base/名字；packages 下还有一层分组
    const packageDirs = base.endsWith('vendor')
      ? [join(base, group.name)]
      : readdirSync(join(base, group.name), { withFileTypes: true })
        .filter(e => e.isDirectory() || e.isSymbolicLink())
        .map(e => join(base, group.name, e.name))
    for (const packageDir of packageDirs) {
      const manifestPath = join(packageDir, 'package.json')
      if (!existsSync(manifestPath)) continue
      let name
      try {
        name = JSON.parse(readFileSync(manifestPath, 'utf8')).name
      } catch {
        continue // 无法解析的 manifest 跳过
      }
      if (typeof name !== 'string' || paths[name]) continue // 无名或已收录
      const typesEntry = join(packageDir, 'lib', 'types', 'index.d.ts')
      if (existsSync(typesEntry)) {
        paths[name] = [typesEntry.replace(/\\/g, '/')] // 用正斜杠
      }
    }
  }
}

// 生成 tsconfig.paths.json（注意：带本机路径，仅供本机开发，请勿提交到仓库）
const generated = {
  compilerOptions: {
    paths,
    typeRoots: [join(harnessDir, 'node_modules', '@types').replace(/\\/g, '/')],
  },
}
const header = '// 本文件由 scripts/gen-tsconfig.mjs 生成，包含本机路径，仅供本机开发使用。\n// 请勿提交到仓库；仓库内提交的是空映射版本。\n'
writeFileSync(join(root, 'tsconfig.paths.json'), header + JSON.stringify(generated, null, 2) + '\n', 'utf8')
console.log('[gen-tsconfig] 已生成 tsconfig.paths.json（harness: ' + harnessDir + '，映射 ' + Object.keys(paths).length + ' 个包）。')
