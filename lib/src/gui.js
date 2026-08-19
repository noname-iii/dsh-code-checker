/**
 * 文件作用：可选 GUI —— 内置 Web 检查面板（报告仓库 + /code-checker/ 路由）。
 * 可选 GUI：内置 Web 检查面板。
 * 通过 ctx.webServer 挂载 /code-checker/ 路由（与 Web GUI 同源，无需额外端口）：
 *   GET /code-checker/             —— 面板页面
 *   GET /code-checker/api/reports  —— 报告列表 JSON
 *   GET /code-checker/api/reports/:id —— 单份报告 JSON（不含 trace）
 *   GET /code-checker/api/reports/:id/trace —— 单份报告的追踪数据（“画面”视图）
 *   GET /code-checker/api/projects —— 项目列表（当前正在修改的项目 + 有报告的项目）
 * 面板顶部有“状态 / 画面”两个视图：
 *   - “状态”：原有的检查报告列表（保持不变）；
 *   - “画面”：左侧项目列表 + 右侧“命令行 / GUI / log”三个面板，展示测试时的命令、真实操作与日志。
 * @module dsh-code-checker
 */
// 引入 randomUUID 函数：生成随机唯一 id
import { randomUUID } from 'node:crypto';
/** 报告仓库（环形缓冲）。 */
// 导出类：报告仓库，用环形缓冲最多保留 max 份报告
export class ReportStore {
    max;
    // 私有只读：存储报告的数组，初始为空
    items = [];
    // 构造函数：记录最大保留数量
    constructor(max) {
        this.max = max;
    }
    // 添加一份报告，返回存储后的报告对象
    add(report, sessionId) {
        // 组装存储项：生成 id、时间，并按需带上 sessionId
        const item = { id: randomUUID(), time: new Date().toISOString(), ...sessionId !== undefined ? { sessionId } : {}, report };
        // 新报告插入到数组头部（最新在前）
        this.items.unshift(item);
        // 超出最大数量时丢弃最旧的一份
        if (this.items.length > this.max)
            this.items.pop();
        // 返回新存储项
        return item;
    }
    // 返回所有报告（副本数组，按时间倒序）
    list() {
        return [...this.items];
    }
    // 按 id 查找报告，找不到返回 undefined
    get(id) {
        return this.items.find(item => item.id === id);
    }
    /** 某会话最近一份报告。 */
    // 查找某会话最近一份报告，找不到返回 undefined
    lastFor(sessionId) {
        return this.items.find(item => item.sessionId === sessionId);
    }
}
// 发送 JSON 响应：把值序列化后按指定状态码写出
function sendJson(res, status, value) {
    // 把值序列化为 JSON 字符串
    const body = JSON.stringify(value);
    // 写响应头：状态码与各响应头字段
    res.writeHead(status, {
        // 内容类型为 JSON
        'content-type': 'application/json; charset=utf-8',
        // 禁止缓存
        'cache-control': 'no-store',
        // 内容长度（字节数）
        'content-length': Buffer.byteLength(body),
    });
    // 结束响应并输出 JSON 文本
    res.end(body);
}
// 发送 HTML 响应：按 200 状态码写出 HTML 正文
function sendHtml(res, body) {
    // 写响应头：状态码 200 与 HTML 内容类型、禁止缓存
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    // 结束响应并输出 HTML 文本
    res.end(body);
}
/** 空的追踪数据（旧报告或未采集 trace 时兜底）。 */
function emptyTrace() {
    return { logs: [], commands: [], operations: [], simKind: 'none', hasGui: false, screenshots: [] };
}
/** 去掉报告里的 trace（详情接口不携带大体积追踪数据，trace 走专用端点）。 */
function reportWithoutTrace(report) {
    const { trace: _trace, ...rest } = report;
    return rest;
}
/** 合并“正在修改的项目”与“有报告的项目”，得到画面视图左侧项目列表。 */
function buildProjects(store, listProjects) {
    // dir → 项目行（先放活跃项目，再用报告补充/更新）
    const byDir = new Map();
    // 1) 正在被 AI 修改的项目（根 agent 会话 cwd）
    for (const p of listProjects ? listProjects() : []) {
        if (!p.dir)
            continue;
        byDir.set(p.dir, { dir: p.dir, name: p.name, active: true, sessionId: p.sessionId, lastTime: null, ok: null, reportId: null });
    }
    // 2) 报告仓库里的项目（按 dir 归并，取每目录最新一份报告）
    for (const item of store.list()) {
        const dir = item.report.projectDir;
        if (!dir)
            continue;
        const existing = byDir.get(dir);
        if (!existing) {
            byDir.set(dir, { dir, name: item.report.projectName, active: false, sessionId: item.sessionId, lastTime: item.time, ok: item.report.ok, reportId: item.id });
        }
        else if (!existing.lastTime || item.time > existing.lastTime) {
            // 已有该目录（可能是活跃项目）：用最新的报告信息更新
            existing.name = item.report.projectName || existing.name;
            existing.lastTime = item.time;
            existing.ok = item.report.ok;
            existing.reportId = item.id;
            if (!existing.sessionId)
                existing.sessionId = item.sessionId;
        }
    }
    // 排序：活跃项目在前，其次按最后报告时间倒序
    return [...byDir.values()].sort((a, b) => {
        if (a.active !== b.active)
            return a.active ? -1 : 1;
        const ta = a.lastTime ?? '';
        const tb = b.lastTime ?? '';
        return tb.localeCompare(ta);
    });
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
  header { padding: 16px 28px; border-bottom: 1px solid #232733; display: flex; align-items: center; gap: 14px; }
  header h1 { font-size: 20px; margin: 0; }
  header span { color: #8b93a3; font-size: 13px; }
  .tabs { margin-left: auto; display: flex; gap: 6px; }
  .tab { background: #1b1f28; color: #aeb6c4; border: 1px solid #2a2f3a; border-radius: 8px; padding: 7px 20px; cursor: pointer; font-size: 14px; }
  .tab:hover { background: #222732; }
  .tab.active { background: #3b82f6; color: #fff; border-color: #3b82f6; }
  main { padding: 20px 28px; max-width: 1360px; }
  .hidden { display: none !important; }
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
  /* ── 画面视图 ── */
  .screen { display: flex; gap: 16px; align-items: stretch; }
  .project-list { width: 264px; min-width: 264px; background: #171a21; border: 1px solid #232733; border-radius: 10px; padding: 12px; overflow: auto; max-height: 82vh; }
  .project-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 8px; border: 1px solid transparent; }
  .project-item:hover { background: #1e222b; }
  .project-item.active { background: #1e2a3f; border-color: #3b82f6; }
  .project-name { font-size: 14px; font-weight: 600; word-break: break-all; }
  .project-meta { color: #8b93a3; font-size: 12px; margin-top: 2px; }
  .project-item .badge { display: inline-block; margin-top: 6px; }
  .screen-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
  .screen-title { font-size: 16px; font-weight: 600; padding: 2px 2px 6px; }
  .pane { background: #171a21; border: 1px solid #232733; border-radius: 10px; overflow: hidden; }
  .pane-head { padding: 10px 16px; border-bottom: 1px solid #232733; font-weight: 600; font-size: 14px; background: #1b1f28; }
  .pane-body { padding: 12px 16px; overflow: auto; }
  .cmd { margin-bottom: 10px; }
  .cmd-line { font-family: ui-monospace, Consolas, "Cascadia Mono", monospace; font-size: 13px; }
  .prompt { color: #5cdb8b; }
  .cmd-exit { font-size: 11px; margin-left: 8px; padding: 1px 8px; border-radius: 999px; }
  .cmd-ok { background: #12351f; color: #5cdb8b; }
  .cmd-err { background: #3a1418; color: #ff8f9b; }
  .cmd-run { background: #25314a; color: #9fc3ff; }
  .cmd-out { margin: 6px 0 0; max-height: 240px; }
  .gui-summary { font-size: 13px; margin-bottom: 10px; color: #c6ccd8; }
  .browser { border: 1px solid #2a2f3a; border-radius: 10px; overflow: hidden; }
  .browser-bar { display: flex; align-items: center; gap: 6px; background: #1b1f28; padding: 8px 12px; border-bottom: 1px solid #2a2f3a; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .dot.r { background: #ff5f57; } .dot.y { background: #febc2e; } .dot.g { background: #28c840; }
  .addr { margin-left: 8px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #8b93a3; background: #0b0d12; border-radius: 6px; padding: 4px 10px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .browser-body { padding: 12px; }
  .op-list { display: flex; flex-direction: column; gap: 6px; }
  .op { font-size: 13px; padding: 7px 10px; border-radius: 8px; background: #0b0d12; border: 1px solid #1f232d; }
  .op.ok { border-left: 3px solid #28c840; }
  .op.bad { border-left: 3px solid #ff5f57; }
  .op-err { color: #ff8f9b; font-size: 12px; margin-top: 4px; }
  .shots { margin-top: 10px; font-size: 12px; color: #8b93a3; }
  .shot { display: inline-block; background: #0b0d12; border: 1px solid #1f232d; border-radius: 6px; padding: 2px 8px; margin: 2px 4px 0 0; font-family: ui-monospace, Consolas, monospace; }
  .log { margin: 0; max-height: 320px; }
</style>
</head>
<body>
<header>
  <h1>🩺 代码全面检查面板</h1>
  <span>dsh-code-checker · 编译运行 / 功能完整性 / 用户模拟</span>
  <nav class="tabs">
    <button class="tab active" data-view="status">状态</button>
    <button class="tab" data-view="screen">画面</button>
  </nav>
</header>
<main>
  <section id="statusView"><div class="empty">加载中…</div></section>
  <section id="screenView" class="hidden screen">
    <aside id="projectList" class="project-list"><div class="empty">加载中…</div></aside>
    <div id="screenBody" class="screen-body"><div class="empty">选择左侧项目查看测试画面。</div></div>
  </section>
</main>
<script>
var currentView = 'status'
var selectedDir = null
var lastTraceKey = null

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] })
}

function shortTime(iso) {
  if (!iso) return ''
  var d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return d.toLocaleString()
}

function showView(view) {
  currentView = view
  document.getElementById('statusView').classList.toggle('hidden', view !== 'status')
  document.getElementById('screenView').classList.toggle('hidden', view !== 'screen')
  var tabs = document.querySelectorAll('.tab')
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === view)
  }
  if (view === 'status') loadStatus()
  else loadProjects()
}

function bindTabs() {
  var tabs = document.querySelectorAll('.tab')
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function() { showView(this.getAttribute('data-view')) })
  }
}

async function loadStatus() {
  var main = document.getElementById('statusView')
  try {
    var res = await fetch('/code-checker/api/reports')
    var items = await res.json()
    var scrollY = window.scrollY
    if (!items.length) {
      main.innerHTML = '<div class="empty">还没有检查记录。在会话中让 AI 写代码后会自动检查，或输入 /check 手动触发。</div>'
      window.scrollTo(0, scrollY)
      return
    }
    var openState = {}
    var cards = main.querySelectorAll('.card')
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute('data-id')
      var details = cards[i].querySelector('details')
      if (id && details && details.open) openState[id] = true
    }
    main.innerHTML = ''
    for (var j = 0; j < items.length; j++) {
      var item = items[j]
      var card = document.createElement('div')
      card.className = 'card'
      card.setAttribute('data-id', item.id)
      var detail = await fetch('/code-checker/api/reports/' + encodeURIComponent(item.id)).then(function(r) { return r.json() })
      var ok = detail.report && detail.report.ok
      var wasOpen = openState[item.id]
      card.innerHTML = '<h2>' +
        '<span class="badge ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '没有问题' : '发现问题') + '</span>' +
        '<span>' + esc(detail.report ? detail.report.projectName : '') + '</span></h2>' +
        '<div class="meta">' + esc(item.time) + ' · ' + esc(detail.report ? detail.report.projectDir : '') + '</div>' +
        '<div class="summary">' + esc(detail.report ? detail.report.summary : '') + '</div>' +
        '<details' + (wasOpen ? ' open' : '') + '><summary>完整报告</summary><pre>' + esc(detail.report ? detail.report.rendered : '') + '</pre></details>'
      main.appendChild(card)
    }
    window.scrollTo(0, scrollY)
  } catch (err) {
    main.innerHTML = '<div class="empty">加载失败: ' + esc(String(err)) + '</div>'
  }
}

async function loadProjects() {
  var listEl = document.getElementById('projectList')
  var body = document.getElementById('screenBody')
  try {
    var res = await fetch('/code-checker/api/projects')
    var projects = await res.json()
    projects = projects || []
    if (!projects.length) {
      listEl.innerHTML = '<div class="empty">没有再检查的项目</div>'
      body.innerHTML = '<div class="empty">没有再检查的项目。<br><span class="meta">AI 修改代码后会自动检查，或输入 /check 手动触发。</span></div>'
      selectedDir = null
      lastTraceKey = null
      return
    }
    var found = false
    for (var i = 0; i < projects.length; i++) {
      if (projects[i].dir === selectedDir) { found = true; break }
    }
    if (!found) selectedDir = projects[0].dir
    listEl.innerHTML = ''
    for (var j = 0; j < projects.length; j++) {
      (function(p) {
        var item = document.createElement('div')
        item.className = 'project-item' + (p.dir === selectedDir ? ' active' : '')
        item.innerHTML = '<div class="project-name">' + esc(p.name) + '</div>' +
          '<div class="project-meta">' + (p.active ? '进行中 · ' : '') + (p.lastTime ? shortTime(p.lastTime) : '无报告') + '</div>' +
          (p.ok === true ? '<span class="badge ok">没有问题</span>' : (p.ok === false ? '<span class="badge bad">发现问题</span>' : ''))
        item.addEventListener('click', function() { selectedDir = p.dir; lastTraceKey = null; loadProjects() })
        listEl.appendChild(item)
      })(projects[j])
    }
    var sel = null
    for (var k = 0; k < projects.length; k++) {
      if (projects[k].dir === selectedDir) { sel = projects[k]; break }
    }
    if (sel) {
      if (sel.reportId) {
        var key = sel.reportId + '|' + (sel.lastTime || '')
        if (key !== lastTraceKey) { lastTraceKey = key; loadTrace(sel.reportId) }
      } else {
        lastTraceKey = null
        body.innerHTML = '<div class="empty">该项目还没有检查报告（AI 修改代码后会自动检查，或输入 /check 手动触发）。</div>'
      }
    }
  } catch (err) {
    listEl.innerHTML = '<div class="empty">加载失败: ' + esc(String(err)) + '</div>'
  }
}

async function loadTrace(reportId) {
  var body = document.getElementById('screenBody')
  body.innerHTML = '<div class="empty">加载中…</div>'
  try {
    var res = await fetch('/code-checker/api/reports/' + encodeURIComponent(reportId) + '/trace')
    var data = await res.json()
    renderTrace(data)
  } catch (err) {
    body.innerHTML = '<div class="empty">加载失败: ' + esc(String(err)) + '</div>'
  }
}

function renderTrace(data) {
  var body = document.getElementById('screenBody')
  var trace = data.trace || { logs: [], commands: [], operations: [], simKind: 'none', hasGui: false, screenshots: [] }
  var statusMark = data.ok === true ? ' · ✅ 没有问题' : (data.ok === false ? ' · ❌ 发现问题' : '')
  var title = '<div class="screen-title">' + esc(data.projectName || '') +
    ' <span class="meta">' + esc(data.projectKind || '') + ' · ' + esc(data.projectDir || '') + statusMark + '</span></div>'
  body.innerHTML = title +
    pane('命令行', renderCommands(trace.commands)) +
    pane('GUI', renderGui(trace)) +
    pane('log', renderLogs(trace.logs))
}

function pane(title, html) {
  return '<div class="pane"><div class="pane-head">' + esc(title) + '</div><div class="pane-body">' + html + '</div></div>'
}

function renderCommands(commands) {
  if (!commands || !commands.length) return '<div class="empty">（无命令）</div>'
  var out = ''
  for (var i = 0; i < commands.length; i++) {
    var c = commands[i]
    var exitText = c.exitCode === null ? '后台启动/运行中' : ('退出码 ' + c.exitCode)
    var exitCls = c.exitCode === 0 ? 'cmd-ok' : (c.exitCode === null ? 'cmd-run' : 'cmd-err')
    var output = (c.stdout || '') + (c.stderr ? ((c.stdout ? '\\n' : '') + c.stderr) : '')
    out += '<div class="cmd">' +
      '<div class="cmd-line"><span class="prompt">$</span> ' + esc(c.command) + ' <span class="cmd-exit ' + exitCls + '">' + esc(exitText) + '</span></div>' +
      (output ? '<pre class="cmd-out">' + esc(output) + '</pre>' : '') +
      '</div>'
  }
  return out
}

function renderGui(trace) {
  var kindText = { web: '浏览器（Web）', desktop: '桌面程序（UIA）', cli: '命令行（CLI）', none: '无' }
  var summary = '<div class="gui-summary">模拟类型：' + esc(kindText[trace.simKind] || trace.simKind) +
    ' · 界面：' + (trace.hasGui ? '有' : '无') +
    (trace.baseUrl ? (' · 服务地址：' + esc(trace.baseUrl)) : '') + '</div>'
  var ops = trace.operations || []
  var html = summary
  if (trace.simKind === 'web' && trace.baseUrl) {
    html += '<div class="browser">' +
      '<div class="browser-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>' +
      '<span class="addr">' + esc(trace.baseUrl) + '</span></div>' +
      '<div class="browser-body">' + (ops.length ? renderOps(ops) : '<div class="empty">（已探测到页面，但未记录到浏览器操作——可能未安装 Playwright）</div>') + '</div>' +
      '</div>'
  } else if (ops.length) {
    html += renderOps(ops)
  } else {
    html += '<div class="empty">无界面场景（CLI 项目或无 GUI 操作）。</div>'
  }
  if (trace.screenshots && trace.screenshots.length) {
    html += '<div class="shots">截图产物：' + trace.screenshots.map(function(s) { return '<span class="shot">' + esc(s) + '</span>' }).join('') + '</div>'
  }
  return html
}

function renderOps(ops) {
  var out = '<div class="op-list">'
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i]
    var icon = op.ok ? '✅' : '❌'
    var desc = op.action + (op.target ? (' ' + op.target) : '') + (op.value ? (' “' + op.value + '”') : '')
    out += '<div class="op ' + (op.ok ? 'ok' : 'bad') + '">' + icon + ' ' + esc(desc) +
      ' <span class="meta">' + (op.durationMs != null ? (op.durationMs + 'ms') : '') + '</span>' +
      (op.error ? ('<div class="op-err">' + esc(op.error) + '</div>') : '') + '</div>'
  }
  return out + '</div>'
}

function renderLogs(logs) {
  if (!logs || !logs.length) return '<div class="empty">（无日志）</div>'
  return '<pre class="log">' + esc(logs.join('\\n')) + '</pre>'
}

function refresh() {
  if (currentView === 'status') loadStatus()
  else loadProjects()
}

bindTabs()
loadStatus()
setInterval(refresh, 5000)
</script>
</body>
</html>`;
/** 挂载 GUI 路由。 */
// 导出安装函数：把 GUI 路由挂载到 webServer；listProjects 用于提供“画面”视图左侧的活跃项目列表。
export function installGui(webServer, store, listProjects) {
    // 注册精确匹配的 /code-checker 路由：重定向到带斜杠路径
    webServer.register({
        kind: 'exact',
        path: '/code-checker',
        handler(_req, res) {
            res.writeHead(302, { location: '/code-checker/' });
            res.end();
        },
    });
    // 注册前缀匹配的 /code-checker 路由：处理页面与 API 请求
    webServer.register({
        kind: 'prefix',
        path: '/code-checker',
        handler(req, res) {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            const path = url.pathname;
            // 首页路径：返回面板页面
            if (path === '/code-checker/' || path === '/code-checker/index.html') {
                sendHtml(res, PAGE);
                return;
            }
            // 项目列表 API（“画面”视图左侧栏）
            if (path === '/code-checker/api/projects') {
                sendJson(res, 200, buildProjects(store, listProjects));
                return;
            }
            // 报告列表 API：返回报告列表 JSON
            if (path === '/code-checker/api/reports') {
                const list = store.list().map(item => ({
                    id: item.id,
                    time: item.time,
                    ok: item.report.ok,
                    projectName: item.report.projectName,
                    projectDir: item.report.projectDir,
                    projectKind: item.report.projectKind,
                    summary: item.report.summary,
                    durationMs: item.report.durationMs,
                }));
                sendJson(res, 200, list);
                return;
            }
            // 单份报告的追踪数据（“画面”视图）
            const traceMatch = /^\/code-checker\/api\/reports\/([0-9a-f-]+)\/trace$/.exec(path);
            if (traceMatch) {
                const id = traceMatch[1];
                const item = store.get(id ?? '');
                if (!item) {
                    sendJson(res, 404, { error: 'report not found' });
                    return;
                }
                sendJson(res, 200, {
                    id: item.id,
                    time: item.time,
                    ok: item.report.ok,
                    projectName: item.report.projectName,
                    projectDir: item.report.projectDir,
                    projectKind: item.report.projectKind,
                    trace: item.report.trace ?? emptyTrace(),
                });
                return;
            }
            // 用正则匹配单份报告详情路径，捕获 id
            const detail = /^\/code-checker\/api\/reports\/([0-9a-f-]+)$/.exec(path);
            if (detail) {
                const id = detail[1];
                const item = store.get(id ?? '');
                if (!item) {
                    sendJson(res, 404, { error: 'report not found' });
                    return;
                }
                // 详情不携带 trace（避免大体积）；trace 由上面的专用端点提供。
                sendJson(res, 200, { ...item, report: reportWithoutTrace(item.report) });
                return;
            }
            // 其余路径返回 404
            sendJson(res, 404, { error: 'not found' });
        },
    });
}
//# sourceMappingURL=gui.js.map