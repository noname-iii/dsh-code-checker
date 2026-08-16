/**
 * 文件作用：检查结果回传 —— 把报告文本以“插件上下文”消息 steer/inject 给对应 Agent。
 * 检查结果回传 AI：把报告文本以“插件上下文”形式 steer/inject 给对应 Agent。
 * @module dsh-code-checker
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
/** 构造一条插件来源的报告消息。 */
export declare function reportMessage(text: string): UserMessage;
/**
 * 把报告文本回传给 AI。
 * - steer：作为指导消息唤醒驱动，让 AI 立即处理（默认）
 * - inject：仅注入上下文，不唤醒
 * - none：不回传
 */
export declare function deliverToAgent(agent: Agent, text: string, mode: 'steer' | 'inject' | 'none'): boolean;
/** 截断报告文本到配置上限（保证消息体合理大小）。 */
export declare function truncateReport(text: string, maxChars: number): string;
