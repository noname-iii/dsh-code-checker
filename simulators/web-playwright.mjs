#!/usr/bin/env node
/**
 * Web 用户模拟器（Playwright 驱动）。
 * 文件作用：用 Playwright 驱动无头 Chromium，按计划文件中的 interactions 依次执行网页交互
 *          （goto/click/type/press/wait/drag/screenshot），并采集控制台错误、页面异常、
 *           失败请求与截图，最后输出一行 RESULT:{...}（JSON）供引擎解析。
 * 新增能力：① 逐页审计——对访问到的每个页面检查是否一直卡在某个页面、或卡在“加载中”
 *           （加载指示持续出现即判定卡在加载中）；② 遍历点击页面上所有按钮——逐个点击
 *           每个可点击按钮并记录点击后的状态/异样（报错、卡在加载中等）。
 * 用法: node web-playwright.mjs <planFile>
 * planFile: { baseUrl, interactions: [{action,target,value,expect}], artifacts, audit }
 * 输出: 日志若干行 + 一行 RESULT:{...}（JSON，含 pageChecks 逐页审计结果、buttonClicks 按钮点击结果）。
 */
import { readFile } from 'node:fs/promises'

const planFile = process.argv[2]                              // 从命令行参数取计划文件路径（第 3 个参数）
const plan = JSON.parse(await readFile(planFile, 'utf8'))     // 读取计划文件并解析为 JSON 对象
const { baseUrl, interactions = [], artifacts, audit = false } = plan // 解构出 baseUrl、interactions（默认空数组）、artifacts、audit（是否逐页审计，默认关）

const consoleErrors = []        // 收集浏览器控制台 error 级日志
const pageErrors = []           // 收集页面未捕获异常
const requestFailed = []        // 收集失败的网络请求
const screenshots = []          // 收集已保存的截图路径
const actions = []              // 收集每个交互动作的执行结果记录

// ---- 逐页审计：检查“卡在加载中”等页面异样，并模拟点击页面上所有按钮 ----
const pageChecks = []           // 收集每个页面的审计结果
const buttonClicks = []         // 收集每个按钮的点击结果
const MAX_AUDIT_PAGES = 6       // 最多审计的页面数（防止无限爬取）
const MAX_AUDIT_BUTTONS = 40    // 最多点击的按钮总数
const auditQueue = []           // 待审计页面队列（BFS）
const audited = new Set()       // 已审计页面集合（按 URL 去重）

let chromium                                              // 存放 playwright 的 chromium 浏览器类型
try {
  const playwright = await import('playwright')           // 动态导入 playwright 库
  chromium = playwright.chromium                          // 取出 chromium 浏览器类型
} catch (error) {
  // 未安装 playwright 时输出失败结果并退出（退出码 0，表示已正常上报结果）
  console.log('RESULT:' + JSON.stringify({
    ok: false,
    playwright: false,
    note: '未安装 playwright（npm i -D playwright 或 npx playwright install chromium 后可用浏览器自动化）',
    detail: String(error && error.message ? error.message : error),
    actions: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailed: [],
    screenshots: [],
  }))
  process.exit(0)
}

// 判断 target 是否为 CSS 选择器：以 #、.、[ 开头，或形如“标签+组合符”的选择器
const isSelector = (target = '') =>
  /^[#.\[]/.test(target) || /^[a-z][a-z0-9_-]*(\s|>|\[|\.|#|:)/.test(target.trim())

const timeout = (action) => 8000                            // 每个动作的统一超时时间（毫秒）

let browser                                                  // 浏览器实例（launch 失败时为 undefined）
try {
  browser = await chromium.launch({ headless: true })        // 以无头模式启动 Chromium 浏览器
} catch (error) {
  // Chromium 未安装（只有 playwright 包）时：优雅上报“未安装”，不崩溃（退出码 0）
  console.log('RESULT:' + JSON.stringify({
    ok: false,
    playwright: false,
    note: 'Chromium 未安装（npx playwright install chromium 后可用浏览器自动化）',
    detail: String(error && error.message ? error.message : error),
    actions: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailed: [],
    screenshots: [],
  }))
  process.exit(0)
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })   // 新建页面并设置视口尺寸
page.on('console', (msg) => {                               // 监听浏览器控制台输出
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500))      // 仅记录 error 级日志（截取前 500 字符）
})
page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err).slice(0, 500)))   // 监听页面未捕获异常并记录（截取前 500 字符）
page.on('requestfailed', (req) => {                         // 监听网络请求失败事件
  requestFailed.push(req.url().slice(0, 300) + ' :: ' + (req.failure()?.errorText ?? 'failed'))   // 记录失败请求的 URL（截取 300 字符）与失败原因
})

let shotIndex = 0                                           // 截图序号计数器
async function shot(name) {                                 // 定义截图函数，参数为文件名
  const path = artifacts + '/' + name                       // 拼接完整截图保存路径
  try {
    await page.screenshot({ path, fullPage: false })        // 截取当前视口截图
    screenshots.push(path)                                  // 记录截图路径
  } catch {
    // 截图失败不致命
  }
}

async function runAction(action) {                          // 定义执行单个交互动作的函数
  const started = Date.now()                                // 记录动作开始时间戳
  const record = { action: action.action, target: action.target ?? '', value: action.value ?? '', ok: true, durationMs: 0, error: undefined }   // 初始化动作结果记录
  try {
    switch (action.action) {                                // 根据动作类型分发处理
      case 'goto': {                                        // 页面跳转动作
        const url = action.target ? (action.target.startsWith('http') ? action.target : baseUrl + (action.target.startsWith('/') ? action.target : '/' + action.target)) : baseUrl + '/'   // 根据 target 计算目标 URL
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })   // 跳转到目标 URL，等待 DOM 加载完成
        break
      }
      case 'click': {                                       // 点击动作
        const target = action.target || 'button'            // 默认点击目标为 button
        if (isSelector(target)) {                           // 若目标是 CSS 选择器
          await page.click(target, { timeout: timeout(action) })   // 直接按选择器点击
        } else {                                            // 否则按可见文字查找
          const loc = page.getByText(target, { exact: false }).first()   // 取第一个匹配文字的控件
          const count = await loc.count()                   // 统计匹配数量
          if (count === 0) throw new Error('页面上找不到文字 "' + target + '" 的控件')   // 无匹配则抛错
          await loc.click({ timeout: timeout(action) })     // 点击该控件
        }
        break
      }
      case 'type': {                                        // 输入文本动作
        const target = action.target || 'input'             // 默认输入目标为 input
        const value = action.value ?? ''                    // 要输入的文本（默认空字符串）
        if (isSelector(target)) {                           // 若目标是 CSS 选择器
          await page.locator(target).first().fill(value, { timeout: timeout(action) })   // 取第一个匹配控件并填入文本
        } else {                                            // 否则使用通用输入框定位
          const loc = page.locator('input, textarea, [contenteditable="true"]').first()   // 取第一个输入类控件
          const count = await loc.count()                   // 统计匹配数量
          if (count === 0) throw new Error('页面上找不到输入框')   // 无匹配则抛错
          await loc.fill(value, { timeout: timeout(action) })    // 填入文本
        }
        break
      }
      case 'press': {                                       // 键盘按键动作
        await page.keyboard.press(action.value || action.target || 'Enter')   // 按下指定键（默认 Enter）
        break
      }
      case 'wait': {                                        // 等待动作
        await page.waitForTimeout(Number(action.value || 500))   // 等待指定毫秒（默认 500）
        break
      }
      case 'drag': {                                        // 鼠标拖拽动作
        await page.mouse.move(120, 120)                     // 移动鼠标到起点
        await page.mouse.down()                             // 按下鼠标左键
        await page.mouse.move(360, 260, { steps: 12 })      // 分 12 步移动到终点
        await page.mouse.up()                               // 松开鼠标左键
        break
      }
      case 'screenshot': {                                  // 截图动作
        shotIndex += 1                                      // 截图序号自增
        await shot('web-' + String(shotIndex) + '.png')     // 调用截图函数保存截图
        break
      }
      default:                                              // 未知动作类型
        record.ok = false                                   // 标记失败
        record.error = '未知操作类型: ' + action.action     // 记录错误信息
    }
    if (action.expect) {                                    // 若动作带期望内容校验
      await page.waitForTimeout(400)                        // 先等待 400ms
      const body = await page.content().catch(() => '')      // 获取当前页面 HTML（失败则返回空字符串）
      if (body && !body.includes(action.expect)) {          // 若页面不含期望内容
        record.ok = false                                   // 标记失败
        record.error = '期望内容未出现: ' + action.expect   // 记录错误信息
      }
    }
  } catch (error) {                                         // 捕获动作执行中的异常
    record.ok = false                                       // 标记失败
    const name = error && error.name === 'TimeoutError' ? '操作超时（疑似无响应）' : (error && error.message ? error.message : String(error))   // 超时错误转中文提示，否则取错误消息
    record.error = String(name).slice(0, 400)               // 记录错误信息（截取前 400 字符）
  }
  record.durationMs = Date.now() - started                  // 计算动作耗时
  actions.push(record)                                      // 将结果记录加入 actions 数组
}

// 检测当前页面是否显示“加载中”等加载指示（返回 { loading, text }）。
async function loadingState() {
  try {
    return await page.evaluate(() => {
      const body = document.body
      const text = (body && body.innerText) || ''
      const html = (body && body.innerHTML) || ''
      const lower = (text + ' ' + html).toLowerCase()
      const patterns = ['加载中', '正在加载', '载入中', '努力加载', 'loading', 'please wait', '稍候']
      const hit = patterns.find((p) => lower.includes(p))
      const busy = !!document.querySelector('[aria-busy="true"]')
      return { loading: !!(hit || busy), text: hit || (busy ? 'aria-busy="true"' : '') }
    })
  } catch {
    return { loading: false, text: '' }
  }
}

// 模拟点击页面上所有可点击按钮，检查每个按钮点击后是否有异样（报错 / 卡在加载中）。
async function clickAllButtons(pageUrl) {
  const loc = page.locator('button, input[type="button"], input[type="submit"], [role="button"]')
  let total = 0
  try { total = await loc.count() } catch { return }
  const limit = Math.min(total, 30)                          // 单页最多点击 30 个按钮
  for (let i = 0; i < limit && buttonClicks.length < MAX_AUDIT_BUTTONS; i++) {
    const btn = loc.nth(i)
    let text = ''
    try { text = (((await btn.innerText()) || '') || ((await btn.getAttribute('value')) || '')).trim().slice(0, 60) } catch { text = '' }
    const rec = { url: pageUrl, text: text || ('按钮 #' + String(i)), ok: true, skipped: false, error: undefined, navigatedTo: undefined }
    let enabled = false
    let visible = false
    try { enabled = await btn.isEnabled() } catch { enabled = false }
    try { visible = await btn.isVisible() } catch { visible = false }
    if (!enabled || !visible) {                              // 禁用/隐藏按钮不可点击，跳过（不算异样）
      rec.skipped = true
      rec.error = '按钮不可点击（disabled/隐藏），已跳过'
      buttonClicks.push(rec)
      continue
    }
    const before = page.url()
    try {
      await btn.click({ timeout: 4000 })
      await page.waitForTimeout(600)
      const first = await loadingState()
      if (first.loading) {                                   // 点击后出现加载指示，再等 1.6 秒看是否一直卡住
        await page.waitForTimeout(1600)
        const again = await loadingState()
        if (again.loading) {
          rec.ok = false
          rec.error = '点击后页面持续显示加载指示: ' + (again.text || '加载中')
        }
      }
    } catch (e) {
      rec.ok = false
      rec.error = String((e && e.message) || e).slice(0, 200)
    }
    const after = page.url()
    if (after && after !== before) {                         // 点击导致跳转：新页面加入待审计队列
      rec.navigatedTo = after
      if (!audited.has(after) && (audited.size + auditQueue.length) < MAX_AUDIT_PAGES) auditQueue.push(after)
      try { await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}) } catch { /* 忽略返回失败 */ }
    }
    buttonClicks.push(rec)
  }
}

// 审计单个页面：检查加载超时/卡在“加载中”，随后点击页面上所有按钮。
async function auditPage(url) {
  if (!url || audited.has(url) || audited.size >= MAX_AUDIT_PAGES) return
  audited.add(url)
  const check = { url, title: '', ok: true, stuckLoading: false, note: '' }
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
  } catch (e) {
    check.ok = false
    check.note = '页面加载超时/失败: ' + String((e && e.message) || e).slice(0, 200)
    pageChecks.push(check)
    return
  }
  await page.waitForTimeout(900)
  try { check.title = await page.title() } catch { check.title = '' }
  const first = await loadingState()
  if (first.loading) {                                       // 初次检测到加载指示，等 2.5 秒后复查
    await page.waitForTimeout(2500)
    const again = await loadingState()
    if (again.loading) {                                     // 加载指示持续存在 → 卡在“加载中”
      check.ok = false
      check.stuckLoading = true
      check.note = '页面持续显示加载指示: ' + (again.text || '加载中')
    }
  }
  pageChecks.push(check)
  await clickAllButtons(url)
}

// 从起点页面开始逐页审计（含计划交互结束后的当前页面）。
async function runAudit(startUrls) {
  for (const u of startUrls) {
    if (u && !audited.has(u) && !auditQueue.includes(u)) auditQueue.push(u)
  }
  const current = page.url()
  if (current && !audited.has(current) && !auditQueue.includes(current)) auditQueue.push(current)
  while (auditQueue.length && audited.size < MAX_AUDIT_PAGES) {
    const url = auditQueue.shift()
    await auditPage(url)
  }
}

let pageText = ''                                          // 渲染后的“用户可见”文本（第 2 步行为验证用）
try {
  for (const action of interactions) {                      // 遍历所有交互动作
    if (!action || typeof action.action !== 'string') continue   // 跳过空对象或 action 非字符串的项
    await runAction(action)                                 // 依次执行交互动作
  }
  shotIndex += 1                                            // 截图序号自增
  await shot('web-' + String(shotIndex) + '.png')           // 交互结束后最后截一张图
  try { pageText = await page.evaluate(() => (document.body && document.body.innerText) ? document.body.innerText : '') } catch { /* 忽略 */ }   // 抓取渲染后的可见文本

  // 逐页审计（仅当计划要求时开启）：逐页检查“卡在加载中”等异样，并模拟点击页面上所有按钮
  if (audit && baseUrl) {
    try {
      const starts = []                                      // 计划里访问过的所有页面都作为审计起点
      for (const a of interactions) {
        if (a && a.action === 'goto' && a.target) {
          starts.push(a.target.startsWith('http')
            ? a.target
            : baseUrl + (a.target.startsWith('/') ? a.target : '/' + a.target))
        }
      }
      if (starts.length === 0) starts.push(baseUrl + '/')
      await runAudit(starts)
    } catch (e) {                                            // 审计异常不得让整个模拟崩溃：记录为一次页面审计异样
      pageChecks.push({ url: baseUrl + '/', title: '', ok: false, stuckLoading: false, note: '逐页审计执行异常: ' + String((e && e.message) || e).slice(0, 300) })
    }
  }
} finally {
  try { await browser.close() } catch { /* 忽略 */ }        // 无论是否异常都尝试关闭浏览器，忽略关闭异常
}

console.log('RESULT:' + JSON.stringify({                    // 输出最终 JSON 结果（供引擎解析）
  ok: true,
  playwright: true,
  actions,
  consoleErrors,
  pageErrors,
  requestFailed,
  screenshots,
  pageText: pageText.slice(0, 50000),                       // 渲染后可见文本（截断）
  pageChecks,                                               // 逐页审计结果（含卡“加载中”检测）
  buttonClicks,                                             // 所有按钮的点击结果
}))
