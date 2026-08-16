/**
 * 文件作用：注册 /check 斜杠命令 —— 手动触发全面检查（人机命令面，不产生模型消息）。
 * /check 斜杠命令：手动触发全面检查（人机命令面，不产生模型消息）。
 * @module dsh-code-checker
 */
import type { Context } from '@deepseek-ai/cordis';
/** 依赖注入接口。 */
export interface CommandDeps {
    /** 对指定 agent 执行一次检查（含回传与存储）。 */
    runCheckForAgent(agent: import('@deepseek-ai/dsh-agent').Agent, reason: 'auto' | 'command' | 'tool', extraRequirements?: string): Promise<void>;
    /** 获取最近一次该会话的报告渲染文本（供命令返回展示）。 */
    lastReportText(sessionId: string): string;
    log(line: string): void;
}
/** 注册 /check 命令。 */
export declare function installCommand(ctx: Context, deps: CommandDeps): void;
