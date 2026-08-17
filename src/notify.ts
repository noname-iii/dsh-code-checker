/**
 * 文件作用：系统级桌面通知 —— 当某个会话需要用户操作（审批/决策是否运行命令）时，
 * 在 Windows/macOS/Linux 系统层面弹出通知，通知包含：哪个会话、具体命令信息、可选项。
 *
 * 实现要点：
 *   - 零外部依赖：直接调用操作系统内置命令（macOS: osascript；Windows: PowerShell 托盘气泡；
 *     Linux: notify-send），通过 child_process.spawn 以【参数数组】方式调用（不走 shell），
 *     因此通知内容不会被当作命令注入；
 *   - 只“观察”审批请求，绝不劫持用户决策：approval/request 是 waterfall 事件，
 *     本模块发完通知后原样调用 next()，把决定权交还给 Harness 的审批应答链；
 *   - 通知是 fire-and-forget（detached + unref），不阻塞审批流程。
 * @module dsh-code-checker/notify
 */

import { spawn } from 'node:child_process' // 引入 child_process.spawn：以参数数组方式启动系统通知命令
import { basename } from 'node:path' // 引入 basename：从 cwd 取目录名作为会话标识回退
// 引入 Context / Agent / Session 类型（仅类型，编译后不产生运行时代码，保持零运行时依赖）
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
// 加载 approval/request 事件的类型增强（仅类型）
import type {} from '@deepseek-ai/dsh-user-approval'

/** 清洗通知文本：去控制字符/换行，截断到 max 长度（避免超长命令刷屏）。 */
function sanitize(text: string, max = 240): string { // 清洗并截断文本
  return String(text ?? '') // 转字符串
    .replace(/[\r\n\t\0-\x1F\x7F]+/g, ' ') // 控制字符与换行统一替换为空格
    .replace(/\s+/g, ' ') // 连续空白合并
    .trim() // 去首尾空白
    .slice(0, max) // 截断到 max 长度
}

/** macOS 的 AppleScript 字符串转义（反斜杠与双引号）。 */
function escapeAppleScript(text: string): string { // 转义 AppleScript 字符串字面量
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') // 反斜杠、双引号转义
}

/** Windows PowerShell 单引号转义。 */
function escapePowerShell(text: string): string { // 转义 PowerShell 单引号
  return text.replace(/'/g, "''") // 单引号翻倍
}

/** 发送系统通知（按平台选择命令；fire-and-forget）。 */
export function sendSystemNotification(platform: NodeJS.Platform, title: string, body: string): void { // 按平台发送系统通知
  const t = sanitize(title, 120) // 清洗标题
  const b = sanitize(body, 400) // 清洗正文
  try { // 受保护的发送
    if (platform === 'darwin') { // macOS
      const script = 'display notification "' + escapeAppleScript(b) + '" with title "' + escapeAppleScript(t) + '"' // AppleScript 通知脚本
      const child = spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }) // 启动 osascript
      child.unref() // 不阻塞父进程
    } else if (platform === 'win32') { // Windows
      // 用 Windows Forms 托盘气泡做系统通知（无需安装任何额外组件）
      const script = [ // 组装 PowerShell 脚本
        'Add-Type -AssemblyName System.Windows.Forms',
        '$n = New-Object System.Windows.Forms.NotifyIcon',
        '$n.Icon = [System.Drawing.SystemIcons]::Information',
        '$n.Visible = $true',
        "$n.BalloonTipTitle = '" + escapePowerShell(t) + "'",
        "$n.BalloonTipText = '" + escapePowerShell(b) + "'",
        '$n.ShowBalloonTip(8000)',
        'Start-Sleep -Milliseconds 9000',
        '$n.Dispose()',
      ].join('; ') // 用分号连接
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { stdio: 'ignore', detached: true }) // 启动 powershell
      child.unref() // 不阻塞父进程
    } else { // Linux 等
      const child = spawn('notify-send', ['-a', 'dsh-code-checker', t, b], { stdio: 'ignore', detached: true }) // notify-send
      child.unref() // 不阻塞父进程
    }
  } catch {
    // 通知发送失败不致命，静默忽略
  }
}

/** 从会话事件日志里按 callId 反查该次工具调用的“具体命令/参数”。 */
export function toolArgumentsFromSession(session: Session, callId?: unknown): string | undefined { // 反查工具调用参数
  if (callId === undefined || callId === null) return undefined // 无 callId 直接返回
  for (const event of [...session.events].reverse()) { // 倒序遍历会话事件（找最近的匹配）
    if (event.type !== 'tool/call') continue // 跳过非工具调用事件
    const data = event.data as { callId?: unknown; arguments?: string } // 取事件数据
    if (data.callId !== callId) continue // callId 不匹配则继续
    const raw = data.arguments ?? '' // 原始参数 JSON 字符串
    if (!raw) return undefined // 空则返回
    try { // 尝试解析 JSON 提取更友好的命令字段
      const parsed = JSON.parse(raw) as unknown // 解析参数
      if (typeof parsed === 'string') return parsed.slice(0, 240) // 直接是字符串
      if (parsed && typeof parsed === 'object') { // 对象时优先取常见命令字段
        const obj = parsed as Record<string, unknown> // 转记录类型
        const picked = obj.command ?? obj.cmd ?? obj.input ?? obj.text ?? obj.code ?? obj.path // 依次取常见字段
        if (typeof picked === 'string' && picked) return picked.slice(0, 240) // 命中字符串字段
        const compact = JSON.stringify(obj) // 否则用紧凑 JSON
        return compact.length > 240 ? compact.slice(0, 240) + '…' : compact // 截断
      }
    } catch {
      // 非 JSON（很少见），直接用原始串
    }
    return raw.length > 240 ? raw.slice(0, 240) + '…' : raw // 返回原始参数（截断）
  }
  return undefined // 没找到
}

/** 取会话的可读标识：优先会话标题（session/title 事件），其次 cwd 目录名，最后会话 id 前 8 位。 */
export function sessionLabel(session: Session): string { // 取会话可读标识
  for (const event of [...session.events].reverse()) { // 倒序找会话标题事件（session/title 是 merge 扩展事件，按字符串比较）
    if ((event as { type: string }).type === 'session/title') { // 命中标题事件
      const title = (event.data as { title?: unknown }).title // 取标题字段
      if (typeof title === 'string' && title.trim()) return title.trim().slice(0, 80) // 非空则返回（截断）
      break // 找到标题事件但没有可用标题，跳出
    }
  }
  const cwd = (session as Session & { header?: { cwd?: string } }).header?.cwd // 取会话工作目录
  if (cwd) { // 有 cwd
    const name = basename(cwd) // 取目录名
    if (name) return name.slice(0, 80) // 返回目录名
  }
  return String(session.id).slice(0, 8) // 回退到会话 id 前 8 位
}

/** 审批通知配置子集。 */
export interface NotifyConfig { // 通知配置
  enabled: boolean // 是否启用审批通知
}

/** 组装审批通知正文（纯函数，便于测试）：会话 + 工具 + 具体信息 + 选项。 */
export function buildApprovalBody(label: string, toolName: string, info: string): string { // 组装通知正文
  return '会话「' + label + '」请求执行 ' + toolName + '\n' + info + '\n选项：运行 / 不运行（请在 Harness 中处理）' // 正文
}

/** 审批通知标题。 */
export const APPROVAL_NOTICE_TITLE = 'dsh-code-checker：需要用户操作' // 通知标题

/**
 * 安装“审批请求 → 系统通知”观察器。
 * 监听 approval/request（waterfall），发系统通知后原样 next()，不改变审批结果。
 */
export function installApprovalNotifier(ctx: Context, config: NotifyConfig, log: (line: string) => void): void { // 安装审批通知观察器
  if (!config.enabled) return // 配置关闭则直接返回
  ctx.on('approval/request', (req, next) => { // 监听审批请求（waterfall：本观察器只旁观）
    try { // 受保护的提取与发送（通知失败不影响审批）
      const session: Session | undefined = req.agent?.session // 取会话（可能不存在）
      const label = session ? sessionLabel(session) : String(req.agent?.id ?? '未知会话') // 会话标识
      const command = session ? toolArgumentsFromSession(session, req.callId) : undefined // 反查具体命令
      const info = command ?? req.reason ?? req.toolName // 具体信息：命令 > 原因 > 工具名
      const title = APPROVAL_NOTICE_TITLE // 通知标题
      const body = buildApprovalBody(label, req.toolName, info) // 通知正文
      sendSystemNotification(process.platform, title, body) // 发送系统通知
      log('已发送审批系统通知（会话: ' + label + '，工具: ' + req.toolName + '）') // 记录日志
    } catch (error) { // 捕获提取/发送异常
      log('审批通知发送失败: ' + (error instanceof Error ? error.message : String(error))) // 记录失败
    }
    return next() // 关键：原样委托给下一个应答者，绝不劫持用户决策
  })
}
