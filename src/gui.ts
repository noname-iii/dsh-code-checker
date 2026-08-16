/**
 * 文件作用：可选 GUI —— 内置 Web 检查面板（报告仓库 + /code-checker/ 路由）。
 * 可选 GUI：内置 Web 检查面板。
 * 通过 ctx.webServer 挂载 /code-checker/ 路由（与 Web GUI 同源，无需额外端口）：
 *   GET /code-checker/             —— 面板页面
 *   GET /code-checker/api/reports  —— 报告列表 JSON
 *   GET /code-checker/api/reports/:id —— 单份报告 JSON
 * @module dsh-code-checker
 */

// 引入 Node HTTP 类型：请求与响应对象
import type { IncomingMessage, ServerResponse } from 'node:http'
// 引入 randomUUID 函数：生成随机唯一 id
import { randomUUID } from 'node:crypto'
// 引入 CheckReport 类型：引擎检查报告结构
import type { CheckReport } from '../engine/types.js'

/** 存储的单份报告。 */
// 导出接口：存储的单个报告结构
export interface StoredReport {
  // 报告唯一 id
  id: string
  // 报告生成时间（ISO 字符串）
  time: string
  /** 触发检查的会话 id（手动/工具触发的检查无会话）。 */
  // 会话 id（可选，手动/工具触发的检查没有会话）
  sessionId?: string
  // 报告内容
  report: CheckReport
}

/** 报告仓库（环形缓冲）。 */
// 导出类：报告仓库，用环形缓冲最多保留 max 份报告
export class ReportStore {
  // 私有只读：存储报告的数组，初始为空
  private readonly items: StoredReport[] = []
  // 构造函数：记录最大保留数量
  constructor(private readonly max: number) {}

  // 添加一份报告，返回存储后的报告对象
  add(report: CheckReport, sessionId?: string): StoredReport {
    // 组装存储项：生成 id、时间，并按需带上 sessionId
    const item: StoredReport = { id: randomUUID(), time: new Date().toISOString(), ...sessionId !== undefined ? { sessionId } : {}, report }
    // 新报告插入到数组头部（最新在前）
    this.items.unshift(item)
    // 超出最大数量时丢弃最旧的一份
    if (this.items.length > this.max) this.items.pop()
    // 返回新存储项
    return item
  }

  // 返回所有报告（副本数组，按时间倒序）
  list(): StoredReport[] {
    return [...this.items]
  }

  // 按 id 查找报告，找不到返回 undefined
  get(id: string): StoredReport | undefined {
    return this.items.find(item => item.id === id)
  }

  /** 某会话最近一份报告。 */
  // 查找某会话最近一份报告，找不到返回 undefined
  lastFor(sessionId: string): StoredReport | undefined {
    return this.items.find(item => item.sessionId === sessionId)
  }
}

// 发送 JSON 响应：把值序列化后按指定状态码写出
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  // 把值序列化为 JSON 字符串
  const body = JSON.stringify(value)
  // 写响应头：状态码与各响应头字段
  res.writeHead(status, {
    // 内容类型为 JSON
    'content-type': 'application/json; charset=utf-8',
    // 禁止缓存
    'cache-control': 'no-store',
    // 内容长度（字节数）
    'content-length': Buffer.byteLength(body),
  })
  // 结束响应并输出 JSON 文本
  res.end(body)
}

// 发送 HTML 响应：按 200 状态码写出 HTML 正文
function sendHtml(res: ServerResponse, body: string): void {
  // 写响应头：状态码 200 与 HTML 内容类型、禁止缓存
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  // 结束响应并输出 HTML 文本
  res.end(body)
}

// 面板页面 HTML 模板（内置样式与前端脚本，作为字符串常量嵌入，内容保持原样）
const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>代码全面检查面板 · dsh-code-checker</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: #0f1115; color: #e6e8ec; }
  header { padding: 18px 28px; border-bottom: 1px solid #232733; display: flex; align-items: baseline; gap: 14px; }
  header h1 { font-size: 20px; margin: 0; }
  header span { color: #8b93a3; font-size: 13px; }
  main { padding: 22px 28px; max-width: 1080px; }
  .card { background: #171a21; border: 1px solid #232733; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
  .card h2 { font-size: 15px; margin: 0 0 6px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .badge { font-size: 12px; padding: 2px 10px; border-radius: 999px; }
  .ok { background: #12351f; color: #5cdb8b; }
  .bad { background: #3a1418; color: #ff8f9b; }
  .meta { color: #8b93a3; font-size: 12px; }
  .summary { margin-top: 8px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
  details { margin-top: 10px; }
  summary { cursor: pointer; color: #7db4ff; font-size: 13px; }
  pre { background: #0b0d12; border: 1px solid #1f232d; border-radius: 8px; padding: 12px; overflow: auto; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .empty { color: #8b93a3; }
</style>
</head>
<body>
<header><h1>🩺 代码全面检查面板</h1><span>dsh-code-checker · 编译运行 / 功能完整性 / 用户模拟</span></header>
<main id="main"><div class="empty">加载中…</div></main>
<script>
async function load() {
  const main = document.getElementById('main')
  try {
    const res = await fetch('/code-checker/api/reports')
    const items = await res.json()
    if (!items.length) {
      main.innerHTML = '<div class="empty">还没有检查记录。在会话中让 AI 写代码后会自动检查，或输入 /check 手动触发。</div>'
      return
    }
    // 记住用户已展开的“完整报告”详情（按报告 id），刷新后保持展开状态不回缩。
    const openState = new Map()
    for (const card of main.querySelectorAll('.card')) {
      const id = card.dataset && card.dataset.id
      const details = card.querySelector('details')
      if (id && details && details.open) openState.set(id, true)
    }
    main.innerHTML = ''
    for (const item of items) {
      const card = document.createElement('div')
      card.className = 'card'
      card.dataset.id = item.id
      const detail = await fetch('/code-checker/api/reports/' + item.id).then(r => r.json())
      const ok = detail.report && detail.report.ok
      const wasOpen = openState.get(item.id)
      card.innerHTML = '<h2>' +
        '<span class="badge ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '没有问题' : '发现问题') + '</span>' +
        '<span>' + esc(detail.report ? detail.report.projectName : '') + '</span></h2>' +
        '<div class="meta">' + esc(item.time) + ' · ' + esc(detail.report ? detail.report.projectDir : '') + '</div>' +
        '<div class="summary">' + esc(detail.report ? detail.report.summary : '') + '</div>' +
        '<details' + (wasOpen ? ' open' : '') + '><summary>完整报告</summary><pre>' + esc(detail.report ? detail.report.rendered : '') + '</pre></details>'
      main.appendChild(card)
    }
  } catch (err) {
    main.innerHTML = '<div class="empty">加载失败: ' + esc(String(err)) + '</div>'
  }
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
load()
setInterval(load, 5000)
</script>
</body>
</html>`

/** 挂载 GUI 路由。 */
// 导出安装函数：把 GUI 路由挂载到 webServer
export function installGui(webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void }, store: ReportStore): void {
  // 注册精确匹配的 /code-checker 路由：重定向到带斜杠路径
  webServer.register({
    // 路由匹配方式：精确匹配
    kind: 'exact',
    // 路由路径
    path: '/code-checker',
    // 处理函数：发出 302 重定向
    handler(_req, res) {
      // 写 302 响应头，Location 指向带斜杠路径
      res.writeHead(302, { location: '/code-checker/' })
      // 结束响应
      res.end()
    },
  })
  // 注册前缀匹配的 /code-checker 路由：处理页面与 API 请求
  webServer.register({
    // 路由匹配方式：前缀匹配
    kind: 'prefix',
    // 路由前缀
    path: '/code-checker',
    // 处理函数
    handler(req, res) {
      // 解析请求 URL（缺失时用根路径），以本地地址作为 base
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      // 取 URL 的路径名
      const path = url.pathname
      // 首页路径：返回面板页面
      if (path === '/code-checker/' || path === '/code-checker/index.html') {
        sendHtml(res, PAGE)
        return
      }
      // 报告列表 API：返回报告列表 JSON
      if (path === '/code-checker/api/reports') {
        // 把存储的每份报告映射为列表项（仅暴露摘要字段）
        const list = store.list().map(item => ({
          id: item.id,
          time: item.time,
          ok: item.report.ok,
          projectName: item.report.projectName,
          projectDir: item.report.projectDir,
          projectKind: item.report.projectKind,
          summary: item.report.summary,
          durationMs: item.report.durationMs,
        }))
        // 发送列表 JSON
        sendJson(res, 200, list)
        return
      }
      // 用正则匹配单份报告详情路径，捕获 id
      const detail = /^\/code-checker\/api\/reports\/([0-9a-f-]+)$/.exec(path)
      // 匹配成功时处理详情
      if (detail) {
        // 取出捕获的 id
        const id = detail[1]
        // 按 id 查找报告
        const item = store.get(id ?? '')
        // 找不到时返回 404
        if (!item) {
          sendJson(res, 404, { error: 'report not found' })
          return
        }
        // 找到时返回完整报告 JSON
        sendJson(res, 200, item)
        return
      }
      // 其余路径返回 404
      sendJson(res, 404, { error: 'not found' })
    },
  })
}
