/**
 * 文件作用：会话跟踪器 —— 统计编码活动并在 turn-stopping 检查点自动触发检查，
 * 支持“检查 → 报告 → AI 修复 → 再检查”的自动闭环，直到没有新问题或达到上限。
 *
 * 触发模型（相对旧版的重要修复）：
 *   - 不再用“本轮只检查一次”的 checkedTurns 去重（那会阻止修复后再检查）；
 *   - 改为按“自上次检查以来是否有新的编码活动”判断：
 *     · 有编码活动且自上次检查后产生了新的编码工具调用 → 自动检查；
 *     · 检查报告会 steer 回 AI，AI 修复会产生新的编码调用，
 *       于是同一轮或下一轮的 turn-stopping 会再次触发检查 —— 形成自动闭环；
 *     · AI 收到报告后若只是说话（没有新的编码活动），不再重复检查，避免空转。
 *   - 防循环：每个用户提示最多 maxAutoChecksPerPrompt 次；新用户消息重置计数。
 * @module dsh-code-checker
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
/** 从会话历史提取用户需求文本。 */
export declare function userRequirementsFromSession(session: Session, maxMessages?: number): {
    text: string;
    requirements: string[];
};
/** 依赖注入接口。 */
export interface TrackerDeps {
    config: {
        enabled: boolean;
        autoCheck: boolean;
        maxAutoChecksPerPrompt: number;
        minCodingCalls: number;
        codingTools: string[];
    };
    /** 是否为顶层（根）agent。 */
    isRoot(agent: Agent): boolean;
    /** 对某个 agent 执行一次完整检查（含回传与存储）。 */
    runCheckForAgent(agent: Agent, reason: 'auto' | 'command' | 'tool', extraRequirements?: string, signal?: AbortSignal): Promise<void>;
    log(line: string): void;
}
/** 安装会话跟踪器。 */
export declare function installTracker(ctx: Context, deps: TrackerDeps): void;
