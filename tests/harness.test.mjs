// 文件作用：Harness 插件层的单元测试（node --test 运行）。
//
// 设计说明：用“假 ctx / 假服务”模拟真实 harness 行为，无需真正启动 harness
// 即可验证两块关键集成逻辑：
//   1. 会话跟踪器（src/tracker.js）—— 在 agent/turn-stopping 检查点内
//      对“有编码活动的轮次”自动触发检查，支持“检查→报告→修复→再检查”闭环，
//      并遵守每用户提示的防循环上限；
//   2. GUI（src/gui.js）—— 路由挂载、面板页面与 API 的真实 HTTP 渲染。
// 真实 harness 内的端到端闭环由 try_it_out 与真实会话验证覆盖。

/** 引入 node 内置测试框架的 test 函数。 */
import { test } from 'node:test'
/** 引入严格断言。 */
import assert from 'node:assert/strict'
/** 引入 http 服务器（承载 GUI 路由做真实渲染验证）。 */
import { createServer } from 'node:http'
/** 引入被测试的会话跟踪器。 */
import { installTracker } from '../lib/src/tracker.js'
/** 引入被测试的 GUI 与报告仓库。 */
import { installGui, ReportStore } from '../lib/src/gui.js'

/** 构造假 ctx：记录所有注册的监听器，并携带假 agents 服务。 */
function makeFakeCtx(agent) {
  const listeners = {}                       // 监听器表：事件名 → 处理函数
  return {
    listeners,                               // 暴露给测试手动触发事件
    on(name, handler) {                      // 模拟 ctx.on 注册
      listeners[name] = handler
    },
    agents: {                                // 模拟 ctx.agents
      roots: () => [agent],                  // 该 agent 是“根”agent
      get: () => agent,                      // 按 id 查回同一个 agent
    },
  }
}

/** 构造一个最简 agent 形状（跟踪器只用 id 与 session.id）。 */
function makeAgent() {
  return { id: 's1', session: { id: 's1', events: [] } }
}

/** 构造一条“真实用户消息”会话事件。 */
function userEvent(seq, text) {
  return { seq, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } }
}

/** 构造一条“轮次开始”会话事件（tracker 用它重置本轮编码计数）。 */
function turnStartEvent(seq, turn) {
  return { seq, type: 'turn/start', data: { turn } }
}

/** 构造一条“工具调用”会话事件（name 决定是否算编码活动）。 */
function toolEvent(seq, name) {
  return { seq, type: 'tool/call', data: { name, turn: 1, step: 1, callId: 'c' + String(seq), arguments: '{}' } }
}

/** 构造 tracker 依赖：记录每次 runCheckForAgent 调用。 */
function makeTrackerDeps() {
  const calls = []                           // 调用记录
  return {
    calls,                                   // 暴露给测试断言
    config: {                                // 测试配置
      enabled: true,
      autoCheck: true,
      maxAutoChecksPerPrompt: 2,             // 每用户提示最多 2 次自动检查
      minCodingCalls: 1,                     // 至少 1 次编码工具调用才触发
      codingTools: ['write', 'edit', 'bash', 'pwsh', 'run_code'], // 编码工具名单
    },
    isRoot: () => true,                      // 都视为根 agent
    runCheckForAgent: async (agent, reason, extra, signal) => { // 假检查执行
      calls.push({ agent, reason, extra, signal })
    },
    log: () => {},                           // 日志吞掉
  }
}

/** 触发一次 turn-stopping 检查点（模拟 harness 在轮次关闭前的 await 调用）。 */
async function fireTurnStopping(ctx, turn) {
  const handler = ctx.listeners['agent/turn-stopping'] // 取出注册的监听器
  assert.ok(handler, '应注册 agent/turn-stopping 监听器') // 必须已注册
  await handler({ agent: ctx.agents.get(), turn, signal: undefined }) // 以 harness 的 payload 形状调用
}

test('跟踪器：有编码活动的轮次在 turn-stopping 检查点自动触发检查', async () => {
  const agent = makeAgent()                   // 假 agent
  const ctx = makeFakeCtx(agent)              // 假 ctx
  const deps = makeTrackerDeps()              // 假依赖
  installTracker(ctx, deps)                   // 安装跟踪器

  ctx.listeners['session/event'](agent.session, userEvent(1, '请写一个 hello 工具')) // 用户消息
  ctx.listeners['session/event'](agent.session, turnStartEvent(2, 1))                // 第 1 轮开始
  ctx.listeners['session/event'](agent.session, toolEvent(3, 'write'))               // 编码：write
  ctx.listeners['session/event'](agent.session, toolEvent(4, 'pwsh'))                // 编码：pwsh

  await fireTurnStopping(ctx, 1)              // 触发轮次关闭检查点
  assert.equal(deps.calls.length, 1, '应触发一次自动检查') // 应执行 1 次检查
  assert.equal(deps.calls[0].reason, 'auto')  // 触发方式应为 auto
})

test('跟踪器：无编码活动的轮次不触发检查', async () => {
  const agent = makeAgent()                   // 假 agent
  const ctx = makeFakeCtx(agent)              // 假 ctx
  const deps = makeTrackerDeps()              // 假依赖
  installTracker(ctx, deps)                   // 安装跟踪器

  ctx.listeners['session/event'](agent.session, userEvent(1, '你好')) // 纯聊天消息
  ctx.listeners['session/event'](agent.session, turnStartEvent(2, 1)) // 轮次开始（无工具调用）

  await fireTurnStopping(ctx, 1)              // 触发检查点
  assert.equal(deps.calls.length, 0, '纯聊天不应触发检查') // 不应执行检查
})

test('跟踪器：检查→修复→再检查闭环（有新的编码活动就再次检查；无新编码不重复检查；超过上限等待新用户输入）', async () => {
  const agent = makeAgent()                   // 假 agent
  const ctx = makeFakeCtx(agent)              // 假 ctx
  const deps = makeTrackerDeps()              // 假依赖
  installTracker(ctx, deps)                   // 安装跟踪器

  // 第 1 轮：编码 → 检查（第 1 次）
  ctx.listeners['session/event'](agent.session, userEvent(1, '需求'))   // 用户消息
  ctx.listeners['session/event'](agent.session, turnStartEvent(2, 1))   // 第 1 轮开始
  ctx.listeners['session/event'](agent.session, toolEvent(3, 'write'))  // 编码：write
  await fireTurnStopping(ctx, 1)              // 检查点 → 检查
  assert.equal(deps.calls.length, 1, '第 1 次编码后应检查') // 第 1 次检查

  // 同轮：AI 收到报告后修复（新的编码活动）→ 再次检查（第 2 次，闭环核心）
  ctx.listeners['session/event'](agent.session, toolEvent(4, 'edit'))   // 修复：edit
  await fireTurnStopping(ctx, 1)              // 检查点 → 再检查
  assert.equal(deps.calls.length, 2, '修复后应再次自动检查') // 第 2 次检查

  // 同轮：没有新的编码活动（AI 只是说话）→ 不再重复检查（避免空转）
  await fireTurnStopping(ctx, 1)              // 检查点 → 跳过
  assert.equal(deps.calls.length, 2, '无新编码活动不应重复检查') // 仍为 2 次

  // 同轮：再修复（第 3 次编码）→ 达到 maxAutoChecksPerPrompt 上限 → 不检查
  ctx.listeners['session/event'](agent.session, toolEvent(5, 'write'))  // 再次修复
  await fireTurnStopping(ctx, 1)              // 检查点 → 超上限跳过
  assert.equal(deps.calls.length, 2, '超过上限后不再自动检查') // 仍为 2 次

  // 新的用户消息 → 重置计数 → 第 2 轮编码后恢复检查
  ctx.listeners['session/event'](agent.session, userEvent(6, '继续修复')) // 新用户消息
  ctx.listeners['session/event'](agent.session, turnStartEvent(7, 2))     // 第 2 轮开始（重置本轮计数）
  ctx.listeners['session/event'](agent.session, toolEvent(8, 'write'))    // 编码
  await fireTurnStopping(ctx, 2)              // 检查点 → 恢复检查
  assert.equal(deps.calls.length, 3, '新用户消息后应恢复自动检查') // 第 3 次检查
})

test('跟踪器：新轮次无编码活动不触发（本轮计数按轮次重置）', async () => {
  const agent = makeAgent()                   // 假 agent
  const ctx = makeFakeCtx(agent)              // 假 ctx
  const deps = makeTrackerDeps()              // 假依赖
  installTracker(ctx, deps)                   // 安装跟踪器

  ctx.listeners['session/event'](agent.session, userEvent(1, '需求'))   // 用户消息
  ctx.listeners['session/event'](agent.session, turnStartEvent(2, 1))   // 第 1 轮开始
  ctx.listeners['session/event'](agent.session, toolEvent(3, 'write'))  // 编码
  await fireTurnStopping(ctx, 1)              // 检查点 → 检查
  assert.equal(deps.calls.length, 1, '第 1 轮应检查') // 第 1 次检查

  ctx.listeners['session/event'](agent.session, turnStartEvent(4, 2))   // 第 2 轮开始（无编码活动）
  await fireTurnStopping(ctx, 2)              // 检查点 → 本轮无编码 → 跳过
  assert.equal(deps.calls.length, 1, '无编码活动的轮次不应检查') // 仍为 1 次
})

test('跟踪器：配置关闭 autoCheck 时不触发', async () => {
  const agent = makeAgent()                   // 假 agent
  const ctx = makeFakeCtx(agent)              // 假 ctx
  const deps = makeTrackerDeps()              // 假依赖
  deps.config.autoCheck = false               // 关闭自动检查
  installTracker(ctx, deps)                   // 安装跟踪器

  ctx.listeners['session/event'](agent.session, userEvent(1, '需求'))  // 用户消息
  ctx.listeners['session/event'](agent.session, turnStartEvent(2, 1))  // 轮次开始
  ctx.listeners['session/event'](agent.session, toolEvent(3, 'write')) // 编码
  await fireTurnStopping(ctx, 1)              // 检查点
  assert.equal(deps.calls.length, 0, 'autoCheck 关闭时不应触发') // 不应检查
})

test('GUI：路由挂载 + 面板与 API 渲染', async () => {
  const routes = []                           // 收集注册的路由
  const fakeWebServer = {                     // 模拟 ctx.webServer
    register(route) {
      routes.push(route)                      // 记录路由
    },
  }
  const store = new ReportStore(10)           // 报告仓库（保留 10 份）
  store.add({                                 // 预置一份“干净”报告
    ok: true,
    projectDir: 'X:\\demo',
    projectKind: 'node',
    projectName: 'demo',
    startedAt: new Date().toISOString(),
    durationMs: 1,
    steps: [],
    issues: [],
    verdicts: [],
    missingFeatures: [],
    anomalies: [],
    summary: '没有问题',
    rendered: '报告',
  }, 's1')                                    // 会话 id s1
  installGui(fakeWebServer, store)            // 挂载 GUI 路由
  assert.equal(routes.length, 2, '应注册 2 条路由（重定向 + 前缀）') // 2 条路由

  // 用真实 node:http 承载注册的 handler，验证真实渲染
  const server = createServer((req, res) => { // 极简路由分发（模拟 webserver 的匹配）
    const url = new URL(req.url ?? '/', 'http://127.0.0.1') // 解析请求路径
    if (url.pathname === '/code-checker') {   // 重定向路由
      routes[0].handler(req, res)
      return
    }
    if (url.pathname.startsWith('/code-checker')) { // 前缀路由
      routes[1].handler(req, res)
      return
    }
    res.writeHead(404)                        // 其余 404
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)) // 随机端口监听
  try {
    const port = server.address().port        // 实际端口
    const pageRes = await fetch('http://127.0.0.1:' + port + '/code-checker/') // 请求面板
    const page = await pageRes.text()         // 页面文本
    assert.equal(pageRes.status, 200)         // 200
    assert.ok(page.includes('代码全面检查面板'), '面板页面应渲染标题') // 含面板标题

    const apiRes = await fetch('http://127.0.0.1:' + port + '/code-checker/api/reports') // 请求报告列表
    const list = await apiRes.json()          // JSON
    assert.equal(apiRes.status, 200)          // 200
    assert.equal(list.length, 1)              // 1 份报告
    assert.equal(list[0].ok, true)            // ok=true
    assert.equal(list[0].summary, '没有问题') // 摘要正确

    const detailRes = await fetch('http://127.0.0.1:' + port + '/code-checker/api/reports/' + list[0].id) // 请求详情
    const detail = await detailRes.json()     // JSON
    assert.equal(detailRes.status, 200)       // 200
    assert.equal(detail.report.rendered, '报告') // 详情内容正确
  } finally {
    await new Promise((resolve) => server.close(resolve)) // 关闭测试服务器
  }
})
