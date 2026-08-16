/**
 * 文件作用：检查结果回传 —— 把报告文本以“插件上下文”消息 steer/inject 给对应 Agent。
 * 检查结果回传 AI：把报告文本以“插件上下文”形式 steer/inject 给对应 Agent。
 * @module dsh-code-checker
 */

// 引入 Agent 类型：代表可被 steer/inject 的目标智能体
import type { Agent } from '@deepseek-ai/dsh-agent'
// 引入 UserMessage 类型：描述用户消息的数据结构
import type { UserMessage } from '@deepseek-ai/dsh-llm'
// 引入 createUserMessage 工厂函数：用于构造一条用户消息
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** 构造一条插件来源的报告消息。 */
// 导出函数：把报告文本构造成一条带插件来源标记的用户消息
export function reportMessage(text: string): UserMessage {
  // 调用 createUserMessage 构造并返回消息对象
  return createUserMessage({
    // 消息内容：仅包含一个文本类型的内容块
    content: [{ type: 'text', text }],
    // 消息来源信息
    source: {
      // 来源种类：插件
      kind: 'plugin',
      // 插件标识名
      plugin: 'dsh-code-checker',
      // 消息形式：通知
      form: 'notice',
      // 摘要文案
      summary: '代码全面检查报告',
    },
  })
}

/**
 * 把报告文本回传给 AI。
 * - steer：作为指导消息唤醒驱动，让 AI 立即处理（默认）
 * - inject：仅注入上下文，不唤醒
 * - none：不回传
 */
// 导出函数：按指定模式把报告文本回传给指定 agent
export function deliverToAgent(agent: Agent, text: string, mode: 'steer' | 'inject' | 'none'): boolean {
  // 模式为 none 或文本为空时直接返回 false（不回传）
  if (mode === 'none' || !text) return false
  // 先把报告文本构造成一条报告消息
  const message = reportMessage(text)
  // 用 try/catch 包裹回传操作，避免抛错中断
  try {
    // steer 模式：作为指导消息唤醒 agent
    if (mode === 'steer') agent.steer(message)
    // inject 模式：仅注入上下文，不唤醒
    else agent.inject(message)
    // 回传成功返回 true
    return true
  } catch (error) {
    // 回传过程抛出异常时返回 false
    return false
  }
}

/** 截断报告文本到配置上限（保证消息体合理大小）。 */
// 导出函数：把报告文本截断到指定最大字符数
export function truncateReport(text: string, maxChars: number): string {
  // 文本长度未超上限时原样返回
  if (text.length <= maxChars) return text
  // 超过上限时截取前 maxChars 个字符并追加截断提示
  return text.slice(0, maxChars) + '\n…[报告过长，已截断；完整报告见 /code-checker/ 面板]'
}
