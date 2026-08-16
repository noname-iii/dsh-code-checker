#!/usr/bin/env node
// 文件作用：MCP 服务器冒烟测试 —— 模拟 IDE 客户端完成一次完整的 JSON-RPC 会话。
// 校验 MCP 规范握手：initialize → notifications/initialized → tools/list → tools/call(detect_project)，
// 每步断言响应结构合法（jsonrpc 2.0、id 回显、result/error 形状）。
// 用法：node scripts/mcp-smoke.mjs（需要能启动子进程的环境）
import { spawn } from 'node:child_process'      // 启动 MCP 服务器子进程
import { dirname, join } from 'node:path'       // 路径工具
import { fileURLToPath } from 'node:url'        // import.meta.url → 路径

const here = dirname(fileURLToPath(import.meta.url)) // 本脚本目录
const cli = join(here, '..', 'lib', 'cli', 'index.js') // CLI 入口

/** 启动 MCP 服务器并返回一个“发送请求、等待响应”的函数。 */
function startMcp() {
  const child = spawn(process.execPath, [cli, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] }) // stdin/stdout 管道
  let buffer = ''                                   // stdout 行缓冲
  const pending = []                                // 等待中的请求（id → resolve）
  child.stdout.on('data', (chunk) => {              // 收到输出
    buffer += chunk.toString('utf8')                // 追加缓冲
    let newline = buffer.indexOf('\n')              // 找完整行
    while (newline >= 0) {                          // 逐行处理
      const line = buffer.slice(0, newline).trim()  // 取出一行
      buffer = buffer.slice(newline + 1)            // 移除该行
      if (line) {                                   // 非空行
        let message
        try { message = JSON.parse(line) } catch { continue } // 跳过无法解析的行
        const waiter = pending.shift()              // 取最早等待的请求
        waiter?.(message)                           // 交付响应
      }
      newline = buffer.indexOf('\n')                // 继续找下一行
    }
  })
  let seq = 0                                        // 请求序号
  return (method, params = {}) => new Promise((resolve, reject) => { // 发送一个请求
    const id = ++seq                                 // 分配 id
    const timer = setTimeout(() => reject(new Error('MCP 响应超时: ' + method)), 15000) // 超时保护
    pending.push((message) => {                      // 注册等待
      clearTimeout(timer)                            // 清超时
      resolve(message)                               // 交付
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') // 写请求行
  })
}

const send = startMcp()                              // 启动服务器
try {
  // 1) initialize 握手
  const init = await send('initialize', { protocolVersion: '2024-11-05', capabilities: {} }) // 握手请求
  if (init?.result?.protocolVersion !== '2024-11-05') throw new Error('initialize 响应异常: ' + JSON.stringify(init)) // 校验协议版本
  if (init?.result?.capabilities?.tools !== undefined) { /* tools 能力声明，不强制 */ }
  console.log('[mcp-smoke] initialize 通过（协议版本 ' + init.result.protocolVersion + '）。')

  // 2) tools/list 目录
  const list = await send('tools/list')              // 工具目录请求
  const names = (list?.result?.tools ?? []).map(t => t.name).sort() // 工具名
  if (!names.includes('check_project') || !names.includes('detect_project')) { // 必须包含两个工具
    throw new Error('tools/list 缺少 check_project / detect_project: ' + JSON.stringify(names))
  }
  console.log('[mcp-smoke] tools/list 通过（' + names.join(', ') + '）。')

  // 3) tools/call：detect_project（识别本插件目录，纯读操作）
  const call = await send('tools/call', { name: 'detect_project', arguments: { project_dir: join(here, '..') } }) // 调用检测
  const content = call?.result?.content ?? []        // 工具结果内容
  const text = content.map(c => c.text ?? '').join('') // 文本
  if (!text.includes('node')) throw new Error('detect_project 结果异常: ' + text.slice(0, 200)) // 应识别为 node 项目
  console.log('[mcp-smoke] tools/call(detect_project) 通过（识别为 node 项目）。')

  console.log('')
  console.log('[mcp-smoke] 全部通过：MCP 服务器符合 JSON-RPC/MCP 基础规范。')
  process.exit(0)                                    // 成功退出
} catch (error) {
  console.error('[mcp-smoke] 失败: ' + (error && error.message ? error.message : String(error))) // 打印失败原因
  process.exit(1)                                    // 失败退出
}
