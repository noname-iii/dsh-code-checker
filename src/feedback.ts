/**
 * 文件作用：检查结果回传 —— 把报告文本以“插件上下文”消息 steer/inject 给对应 Agent。
 *
 * 说明（重要）：本文件【不】依赖 @deepseek-ai/dsh-llm。
 * 插件束通过 `dsh plugin add <目录>`（pnpm link）安装时，被链接目录可能没有
 * node_modules，运行时 import 外部包会解析失败导致插件整行加载失败。
 * UserMessage 只是普通 JSON 形状（{ id, role: 'user', content, source }），
 * 这里手工构造即可，零外部依赖（id 用 node:crypto 的 randomUUID）。
 * @module dsh-code-checker
 */

// 引入 randomUUID 函数：生成消息稳定 id
import { randomUUID } from 'node:crypto'
// 引入 Agent 类型：代表可被 steer/inject 的目标智能体
import type { Agent } from '@deepseek-ai/dsh-agent'
// 引入 UserMessage 类型：仅用于标注返回类型（编译期擦除，无运行时依赖）
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** 构造一条插件来源的报告消息（零依赖：UserMessage 只是普通 JSON 形状）。 */
// 导出函数：把报告文本构造成一条带插件来源标记的用户消息
export function reportMessage(text: string): UserMessage {
  // 手工构造并返回消息对象（与 createUserMessage 的产物同形状；
  // MessageId 只是品牌化字符串，运行时就是普通 uuid 字符串）
  return {
    // 稳定身份（agent loop 依赖每一条消息都有 id）
    id: randomUUID(), // 生成随机 uuid
    // 角色：用户（作为 steer/inject 的输入消息）
    role: 'user', // 固定为 user
    // 消息内容：仅包含一个文本类型的内容块
    content: [{ type: 'text', text }], // 文本内容块
    // 消息来源信息
    source: {
      // 来源种类：插件
      kind: 'plugin', // 插件来源
      // 插件标识名
      plugin: 'dsh-code-checker', // 插件名
      // 消息形式：通知（一次性事件记录，需要 summary 一行摘要）
      form: 'notice', // notice 形式
      // 摘要文案
      summary: '代码全面检查报告', // 一行摘要
    },
  } as unknown as UserMessage
}

/**
 * 把报告文本回传给 AI。
 * - steer：发现问题时作为指导消息唤醒驱动，让 AI 立即修复（默认）；
 *          结果干净时改为 inject —— 不额外唤醒、只注入“没有问题”上下文，
 *          避免为一条干净报告多烧一次模型步（AI 直接继续收尾）。
 * - inject：无论结果如何都仅注入上下文，不唤醒。
 * - none：不回传。
 */
// 导出函数：按指定模式把报告文本回传给指定 agent（isClean 区分是否有问题）
export function deliverToAgent(agent: Agent, text: string, mode: 'steer' | 'inject' | 'none', isClean = false): boolean {
  // 模式为 none 或文本为空时直接返回 false（不回传）
  if (mode === 'none' || !text) return false
  // 先把报告文本构造成一条报告消息
  const message = reportMessage(text)
  // 用 try/catch 包裹回传操作，避免抛错中断
  try {
    // steer 模式：有问题的报告 steer 唤醒 agent 立即修复；干净结果 inject（不唤醒）
    if (mode === 'steer' && !isClean) agent.steer(message)
    // inject 模式（以及 steer 模式下的干净结果）：仅注入上下文，不唤醒
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

/** 有问题时加在报告前头的修复指令（让 AI 修复后再复查，形成闭环）。 */
// 导出函数：按语言返回“修复并复查”的指令前缀
export function fixInstruction(language: 'zh' | 'en'): string {
  // 中文指令
  if (language === 'zh') {
    return '【代码全面检查报告】发现以下问题，请立即修复全部问题；修复完成后请再次调用 check_project 工具验证，直到返回“没有问题”。\n\n'
  }
  // 英文指令
  return '[Comprehensive Code Check Report] Problems were found. Fix ALL of them immediately, then call the check_project tool again to verify, until it returns "No problems".\n\n'
}
