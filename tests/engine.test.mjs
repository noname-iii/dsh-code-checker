// 文件作用：引擎的单元/集成测试（node --test 运行）。
//
// 设计说明：测试使用“进程内 fake exec 适配器”代替真实子进程 —— 这样测试
// 不依赖本机命令环境（不装 node_modules、没有网络也能跑），专注验证引擎的
// 判断逻辑；真实子进程路径由 try_it_out 的一键脚本与真实 CLI 运行覆盖。
// 覆盖场景：需求提取、关键词提取、健康项目三步全过、构建失败即返、
// 功能缺失一次性汇报、静态 Web 模拟、异常上报。

/** 引入 node 内置测试框架的 test 函数。 */
import { test } from 'node:test'
/** 引入严格断言（===、deepEqual 等）。 */
import assert from 'node:assert/strict'
/** 引入 http 服务器（静态 Web 测试里在进程内起服务）。 */
import { createServer } from 'node:http'
/** 引入异步读文件（静态 Web 测试读取 index.html）。 */
import { readFile } from 'node:fs/promises'
/** 引入临时目录与写文件（GUI 项目测试里构造临时项目）。 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
/** 引入系统临时目录（GUI 项目测试的临时项目位置）。 */
import { tmpdir } from 'node:os'
/** 路径工具：join 拼接、dirname 取目录。 */
import { join, dirname } from 'node:path'
/** 把 import.meta.url 转成本地路径。 */
import { fileURLToPath } from 'node:url'
/** 引入引擎主入口（三步流水线）。 */
import { runCheck } from '../lib/engine/index.js'
/** 引入需求提取工具（单独测试）。 */
import { extractRequirements, extractTerms } from '../lib/engine/requirements.js'

const here = dirname(fileURLToPath(import.meta.url)) // 本测试文件所在目录（tests/）
const fixtures = join(here, '..', 'try_it_out')      // 示例项目目录（发布给用户的测试区）
const platform = process.platform === 'win32' ? 'win32' : 'posix' // 当前平台（引擎需要）

/** 构造 fake exec：按规则列表依次匹配命令并返回预置结果。 */
function makeFakeExec(rules) {
  return async (opts) => {
    for (const rule of rules) {                    // 逐条规则匹配
      if (rule.match(opts)) return await rule.result(opts) // 命中即返回该规则的结果
    }
    return { exitCode: 0, signal: null, timedOut: false, aborted: false, stdout: '', stderr: '', durationMs: 5 } // 默认：成功
  }
}

/** 构造引擎 IO（fake exec + 平台 + 空日志 + 可附加字段）。 */
function makeIo(rules, extra = {}) {
  return {
    exec: makeFakeExec(rules),                     // 前台执行
    platform,                                      // 平台
    log: () => {},                                 // 日志吞掉
    ...extra,                                      // 附加（如 start/analyzer）
  }
}

/** 构造检查配置（给定示例目录 + 需求，其余用测试友好默认值）。 */
function baseOptions(dir, requirements, extra = {}) {
  return {
    projectDir: join(fixtures, dir),               // 示例项目绝对路径
    requirements,                                  // 需求条目
    requirementText: requirements.join('\n'),      // 需求原始文本
    installDeps: false,                            // 测试不装依赖
    buildTimeoutMs: 60000,                         // 构建超时
    runProbeMs: 2000,                              // 运行探针时长
    simulate: true,                                // 执行第 3 步
    runAllSteps: false,                            // 严格按三步流程
    useLlm: false,                                 // 测试用启发式（无需 LLM）
    maxSampleFiles: 400,                           // 采样文件数上限
    maxSampleBytes: 250000,                        // 采样字节上限
    language: 'zh',                                // 中文报告
    cleanMessage: '没有问题',                       // 干净时的回传文案
    ...extra,                                      // 覆盖项
  }
}

test('需求提取：从中文文本解析出需求条目', () => {
  const reqs = extractRequirements('请实现一个登录功能。\n并且支持导出 CSV。你好。\n实现 greet 命令') // 混合文本
  assert.ok(reqs.some(r => r.includes('登录')), '应提取登录需求')   // 登录句应被提取
  assert.ok(reqs.some(r => r.includes('导出')), '应提取导出需求')   // 导出句应被提取
  assert.ok(reqs.some(r => r.includes('greet')), '应提取 greet 需求') // 英文命令应被提取
})

test('关键词提取：中文产生 2-gram，英文产生单词', () => {
  const zh = extractTerms('支持用户登录与数据导出')  // 中文需求
  assert.ok(zh.some(t => t.includes('登录') || t === '登录' || t.includes('用户')), '中文词命中') // 应含登录/用户
  const en = extractTerms('support user login and export data') // 英文需求
  assert.ok(en.includes('login') && en.includes('export'), '英文词命中') // 应含 login/export
})

test('健康 CLI 项目：三步全过，返回没有问题', async () => {
  const io = makeIo([
    {
      match: (opts) => opts.command.includes('node "index.js" --help') || opts.command.includes('--version') || opts.command.includes('--greet'), // 探针命令
      result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, stdout: 'ok', stderr: '', durationMs: 5 }), // 探针成功
    },
    {
      match: (opts) => opts.command.includes('node "index.js"'), // 运行探针
      result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, stdout: 'healthy-cli ready', stderr: '', durationMs: 5 }), // 正常退出
    },
  ])
  const report = await runCheck(baseOptions('healthy-cli', [ // 健康项目 + 三条已实现需求
    '实现 greet 命令，可以按名字打招呼',
    '实现 --help 帮助信息展示',
    '实现 --version 版本号展示',
  ]), io)
  assert.equal(report.ok, true, 'healthy 项目应通过')        // 整体应通过
  assert.ok(report.summary.includes('没有问题'), '应返回没有问题') // 总结应含“没有问题”
  assert.equal(report.steps[0].status, 'passed')             // 第 1 步通过
  assert.equal(report.steps[2].status, 'passed')             // 第 3 步通过
})

test('构建失败项目：第 1 步报错并直接返回，且一次性汇报所有报错（跳过第 2/3 步）', async () => {
  const io = makeIo([
    {
      match: (opts) => opts.command.includes('npm run build'), // 构建命令 1
      result: async () => ({ exitCode: 1, signal: null, timedOut: false, aborted: false, stdout: '', stderr: 'Error: 编译失败：找不到模块 foo-bar 的声明文件\n    at build (src/build.js:3:5)', durationMs: 100 }), // 构建失败（含文件:行号定位）
    },
    {
      match: (opts) => opts.command.includes('npm run lint'), // 构建命令 2（第二处错误）
      result: async () => ({ exitCode: 1, signal: null, timedOut: false, aborted: false, stdout: '', stderr: 'Error: Lint failed: line 42 - 缺少分号 semicolon expected', durationMs: 80 }), // lint 也失败
    },
  ])
  const report = await runCheck(baseOptions('broken-build', ['实现 greet 命令']), io) // 跑检查
  assert.equal(report.ok, false, '构建失败应不通过')          // 整体不通过
  assert.equal(report.steps[0].status, 'failed')              // 第 1 步失败
  assert.equal(report.steps[1].status, 'skipped', '第 2 步应跳过') // 第 2 步跳过（按流程）
  assert.equal(report.steps[2].status, 'skipped', '第 3 步应跳过') // 第 3 步跳过（按流程）
  assert.ok(report.rendered.includes('foo-bar'), '报告应包含第一处报错') // 第 1 处错误
  assert.ok(report.rendered.includes('semicolon'), '报告应包含第二处报错（全部错误一次性汇报）') // 第 2 处错误也必须在
  assert.ok(report.rendered.includes('build.js'), '报告应包含出错位置（文件:行号）') // 具体定位
  const errorCount = report.issues.filter(i => i.level === 'error').length // error 级发现数
  assert.ok(errorCount >= 2, '两个失败命令的错误应全部收集（实际 ' + errorCount + '）') // 全部收集
})

test('功能缺失项目：第 2 步一次性汇报所有缺失功能，第 3 步跳过', async () => {
  const io = makeIo([
    {
      match: (opts) => opts.command.includes('node "index.js"'), // 运行探针
      result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, stdout: 'missing-feature v1.0.0', stderr: '', durationMs: 5 }), // 正常
    },
  ])
  const report = await runCheck(baseOptions('missing-feature', [ // 三条需求（两条缺失）
    '实现用户登录功能',
    '实现 greet 命令',
    '支持数据导出为 CSV',
  ]), io)
  assert.equal(report.ok, false)                               // 整体不通过
  const missing = report.missingFeatures.map(v => v.text)      // 缺失需求文本
  assert.ok(missing.some(t => t.includes('登录')), '登录应被判缺失') // 登录缺失
  assert.ok(missing.some(t => t.includes('导出')), '导出应被判缺失') // 导出缺失
  assert.ok(report.verdicts.some(v => v.text.includes('greet') && v.status === 'implemented'), 'greet 应已实现') // greet 已实现
  assert.equal(report.steps[2].status, 'skipped', '存在缺失功能时第 3 步应跳过') // 第 3 步跳过
  assert.ok(report.rendered.includes('登录') && report.rendered.includes('导出'), '报告应列出全部缺失功能') // 报告列出全部缺失
})

test('静态 Web 项目：HTTP 探针 + 浏览器模拟结果解析', async () => {  // 在测试进程内启动一个静态服务器（绕过子进程限制）
  const server = createServer(async (req, res) => {
    const html = await readFile(join(fixtures, 'web-static', 'index.html')) // 读示例页面
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })      // 200 响应
    res.end(html)                                                           // 返回页面
  })
  await new Promise((resolve) => server.listen(4173, '127.0.0.1', resolve)) // 监听 4173 端口
  try {
    const io = makeIo([
      {
        match: (opts) => opts.command.includes('web-playwright.mjs'), // 浏览器模拟命令
        result: async () => ({
          exitCode: 0, signal: null, timedOut: false, aborted: false,
          stdout: 'RESULT:' + JSON.stringify({                    // 模拟 Playwright 结果
            ok: true, playwright: true,
            actions: [{ action: 'goto', target: '/', ok: true, durationMs: 120 }], // 操作成功
            consoleErrors: [], pageErrors: [], requestFailed: [], screenshots: ['/tmp/shot.png'], // 无异常
          }),
          stderr: '', durationMs: 200,
        }),
      },
    ])
    const report = await runCheck(baseOptions('web-static', [    // 静态站 + 三条已实现需求
      '页面包含一个问候按钮',
      '页面包含名字输入框',
      '点击按钮后显示问候语',
    ]), io)
    assert.equal(report.ok, true, '静态站应通过')                // 整体通过
    assert.equal(report.steps[2].status, 'passed')               // 第 3 步通过
  } finally {
    await new Promise((resolve) => server.close(resolve))        // 关闭测试服务器
  }
})

test('第 1、2 步都过、只有第 3 步模拟出错：记录异常并汇报（broken-cli）', async () => {
  const io = makeIo([
    {
      match: (opts) => opts.command.includes('node "index.js" --help'), // 模拟 --help（正常）
      result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, stdout: 'Usage: ...', stderr: '', durationMs: 5 }), // 正常
    },
    {
      match: (opts) => opts.command.includes('node "index.js" --version'), // 模拟 --version（藏着的 bug）
      result: async () => ({ exitCode: 1, signal: null, timedOut: false, aborted: false, stdout: '', stderr: 'Error: version flag broken in broken-cli', durationMs: 5 }), // 用户操作报错
    },
    {
      match: (opts) => opts.command.includes('node "index.js"'), // 运行探针（无参数，正常）
      result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, stdout: 'broken-cli ready. Try --help.', stderr: '', durationMs: 5 }), // 正常
    },
  ])
  const report = await runCheck(baseOptions('broken-cli', [ // 三条需求全部已实现（第 2 步应通过）
    '实现 greet 命令，可以按名字打招呼',
    '实现 --help 帮助信息展示',
    '实现 --version 版本号展示',
  ]), io)
  assert.equal(report.steps[0].status, 'passed', '第 1 步应通过') // 第 1 步通过
  assert.equal(report.steps[1].status, 'passed', '第 2 步应通过') // 第 2 步通过
  assert.equal(report.steps[2].status, 'failed', '第 3 步应失败') // 第 3 步失败
  assert.equal(report.ok, false, '整体不通过')                    // 整体不通过
  assert.ok(report.anomalies.some(a => a.kind === 'error' && a.where.includes('--version')), '应记录 --version 报错异常') // 具体异常位置
  assert.ok(report.rendered.includes('version flag broken'), '报告应包含具体错误信息') // 具体错误内容
})

test('模拟异常上报：卡顿/报错进入 anomalies 与 issues', async () => {
  // 用 healthy-cli 项目 + 探针命令超时，验证“无响应”被记录并导致不通过
  const report = await runCheck({
    ...baseOptions('healthy-cli', [                              // 健康项目需求
      '实现 greet 命令，可以按名字打招呼',
      '实现 --help 帮助信息展示',
      '实现 --version 版本号展示',
    ]),
  }, {
    ...makeIo([]),                                               // 占位（下面整体覆盖）
    exec: makeFakeExec([
      {
        match: (opts) => opts.command.includes('node "index.js" --help'), // --help 探针
        result: async () => ({ exitCode: 0, signal: null, timedOut: true, aborted: false, stdout: '', stderr: '', durationMs: 6000 }), // 模拟超时=无响应
      },
      {
        match: (opts) => opts.command.includes('node "index.js"'), // 运行探针
        result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, stdout: 'ready', stderr: '', durationMs: 5 }), // 正常
      },
    ]),
    platform,                                                    // 平台
    log: () => {},                                               // 日志吞掉
  })
  assert.equal(report.ok, false, '--help 超时（无响应）应导致不通过') // 整体不通过
  assert.ok(report.anomalies.some(a => a.kind === 'unresponsive'), '应记录 unresponsive 异常') // 记录无响应异常
})

/** 构造一个“带 GUI 的 DSH 插件风格”临时项目（源码挂载 webServer 面板路由）。 */
async function makeGuiProject() { // 创建带 GUI 的临时项目目录
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cc-gui-')) // 临时目录
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'gui-plugin', version: '1.0.0' }), 'utf8') // package.json（无 build 脚本，避免真实构建命令）
  await writeFile(join(dir, 'index.js'), 'console.log("install ok") // install 函数入口\n', 'utf8') // 入口（含 install 痕迹，供第 2 步启发式核对）
  await writeFile(join(dir, 'gui.js'), 'export function installGui() { webServer.register({ kind: "prefix", path: "/panel" }) }\n', 'utf8') // 面板挂载源码（GUI 证据 + 面板路径）
  return dir // 返回临时目录
}

test('带 GUI 的插件项目：第 1、2 步通过后，第 3 步必须执行 GUI(web) 模拟而不是 CLI 模拟', async () => {
  const dir = await makeGuiProject() // 建临时 GUI 项目
  // 进程内起一个 web 服务占住候选端口（4173），供 HTTP 探针命中
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><button>ok</button></html>') }) // 任意路径返回 200 页面
  await new Promise((resolve) => server.listen(4173, '127.0.0.1', resolve)) // 监听 4173
  try {
    const io = makeIo([
      {
        match: (opts) => opts.command.includes('web-playwright.mjs'), // 浏览器模拟脚本
        result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false,
          stdout: 'RESULT:' + JSON.stringify({ ok: true, playwright: true, actions: [{ action: 'goto', target: '/panel', ok: true, durationMs: 80 }], consoleErrors: [], pageErrors: [], requestFailed: [], screenshots: [] }), stderr: '', durationMs: 200 }), // 模拟成功
      },
      {
        match: (opts) => opts.command.includes('node "index.js"'), // 运行探针
        result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, stdout: 'install ok', stderr: '', durationMs: 5 }), // 正常退出
      },
    ])
    const report = await runCheck({ // 跑检查（需求全部已实现）
      projectDir: dir, // 临时项目目录
      requirements: ['实现 install 函数'], // 需求：与 index.js 内容匹配
      requirementText: '实现 install 函数', // 需求原文
      installDeps: false, buildTimeoutMs: 60000, runProbeMs: 2000, simulate: true, runAllSteps: false, // 检查配置
      useLlm: false, maxSampleFiles: 400, maxSampleBytes: 250000, language: 'zh', cleanMessage: '没有问题', // 检查配置
    }, io)
    assert.equal(report.steps[0].status, 'passed', '第 1 步应通过') // 第 1 步通过
    assert.equal(report.steps[1].status, 'passed', '第 2 步应通过') // 第 2 步通过
    assert.notEqual(report.steps[2].status, 'skipped', 'GUI 项目第 3 步不得跳过') // 第 3 步必须执行
    const step3Detail = (report.steps[2].detail ?? []).join('\n') // 第 3 步明细
    assert.ok(step3Detail.includes('模拟类型: web'), 'GUI 项目第 3 步必须走 web 模拟（实际: ' + step3Detail.slice(0, 80) + '）') // 必须 web 模拟
    assert.ok(report.ok, '整体应通过（实际: ' + report.summary + '）') // 整体通过
  } finally {
    await new Promise((resolve) => server.close(resolve)) // 关闭测试服务器
    await rm(dir, { recursive: true, force: true }) // 清理临时项目
  }
})

test('带 GUI 的插件项目：第 2 步有缺失功能时，第 3 步仍按流程跳过（不强行执行）', async () => {
  const dir = await makeGuiProject() // 建临时 GUI 项目
  try {
    const io = makeIo([
      {
        match: (opts) => opts.command.includes('node "index.js"'), // 运行探针
        result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, stdout: 'install ok', stderr: '', durationMs: 5 }), // 正常退出
      },
    ])
    const report = await runCheck({ // 跑检查（需求缺失：与项目内容不匹配）
      projectDir: dir, // 临时项目目录
      requirements: ['支持数据导出为 CSV'], // 缺失需求
      requirementText: '支持数据导出为 CSV', // 需求原文
      installDeps: false, buildTimeoutMs: 60000, runProbeMs: 2000, simulate: true, runAllSteps: false, // 检查配置
      useLlm: false, maxSampleFiles: 400, maxSampleBytes: 250000, language: 'zh', cleanMessage: '没有问题', // 检查配置
    }, io)
    assert.equal(report.steps[0].status, 'passed', '第 1 步应通过') // 第 1 步通过
    assert.equal(report.steps[1].status, 'failed', '第 2 步应失败（功能缺失）') // 第 2 步失败
    assert.equal(report.steps[2].status, 'skipped', '第 2 步有缺失时第 3 步按流程跳过') // 第 3 步跳过
  } finally {
    await rm(dir, { recursive: true, force: true }) // 清理临时项目
  }
})
