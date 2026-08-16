#!/usr/bin/env node
/**
 * 静态文件服务器（供 web-static 项目模拟使用，无外部依赖）。
 * 文件作用：在 127.0.0.1 上启动一个无外部依赖的静态文件 HTTP 服务器，按请求 URL 路径返回 rootDir 下的文件，
 *           包含目录穿越防护、目录索引拦截、扩展名到 MIME 类型的映射，以及 403/404 处理。
 * 用法: node static-server.mjs <rootDir> <port>
 */
import { createServer } from 'node:http'                    // 引入 Node.js HTTP 模块的 createServer
import { readFile, stat } from 'node:fs/promises'           // 引入基于 Promise 的文件读取与状态查询
import { extname, join, normalize } from 'node:path'        // 引入路径处理工具（扩展名、拼接、规范化）

const root = process.argv[2]                                // 静态文件根目录（命令行第 3 个参数）
const port = Number(process.argv[3] ?? 4173)                // 监听端口（命令行第 4 个参数，默认 4173）

const MIME = {                                              // 扩展名到 MIME 类型的映射表
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
}

const server = createServer(async (req, res) => {           // 创建 HTTP 服务器并定义请求处理回调
  try {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)   // 解析并解码请求 URL 的路径部分
    if (path === '/') path = '/index.html'                  // 根路径默认映射到 index.html
    const file = normalize(join(root, path))                // 拼接并规范化出目标文件的绝对路径
    if (!file.startsWith(normalize(root))) {                // 目录穿越防护：目标路径必须位于根目录之内
      res.writeHead(403)                                    // 返回 403 状态码
      res.end('forbidden')                                  // 返回 forbidden 文本
      return                                                // 结束本次处理
    }
    const info = await stat(file)                           // 查询文件状态
    if (info.isDirectory()) {                               // 若目标为目录
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })   // 返回 200 与 HTML 类型
      res.end('目录服务不支持索引，请访问 /index.html')      // 提示不支持目录索引
      return                                                // 结束本次处理
    }
    const data = await readFile(file)                       // 读取文件内容为 Buffer
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' })   // 按扩展名设置 MIME（未知类型用二进制流）
    res.end(data)                                           // 返回文件内容
  } catch {                                                 // 捕获文件不存在等异常
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })   // 返回 404 与纯文本类型
    res.end('404 not found')                                // 返回 404 提示
  }
})

server.listen(port, '127.0.0.1', () => {                    // 在 127.0.0.1 上监听指定端口
  console.log('static server listening on http://127.0.0.1:' + port)   // 打印启动信息
})
