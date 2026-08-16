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
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
/** 构造一条插件来源的报告消息（零依赖：UserMessage 只是普通 JSON 形状）。 */
export declare function reportMessage(text: string): UserMessage;
/**
 * 把报告文本回传给 AI。
 * - steer：发现问题时作为指导消息唤醒驱动，让 AI 立即修复（默认）；
 *          结果干净时改为 inject —— 不额外唤醒、只注入“没有问题”上下文，
 *          避免为一条干净报告多烧一次模型步（AI 直接继续收尾）。
 * - inject：无论结果如何都仅注入上下文，不唤醒。
 * - none：不回传。
 */
export declare function deliverToAgent(agent: Agent, text: string, mode: 'steer' | 'inject' | 'none', isClean?: boolean): boolean;
/** 截断报告文本到配置上限（保证消息体合理大小）。 */
export declare function truncateReport(text: string, maxChars: number): string;
/** 有问题时加在报告前头的修复指令（让 AI 修复后再复查，形成闭环）。 */
export declare function fixInstruction(language: 'zh' | 'en'): string;
