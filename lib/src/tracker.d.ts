/**
 * 文件作用：会话跟踪器 —— 统计编码活动并在 turn-stopping 检查点自动触发检查。
 * 会话跟踪器：
 *   - 监听 session/event，统计每轮编码活动（文件写入/shell/终端等工具调用）、
 *     记录用户消息（提取需求 + 重置防循环计数）；
 *   - 在 agent/turn-stopping（轮次真正关闭前、被机器 await 的串行检查点）内
 *     同步执行自动检查并 steer 报告 —— 这样报告一定在本轮关闭前送到 AI，
 *     对 headless 一次性会话同样生效；
 *   - 防循环：每用户提示最多 maxAutoChecksPerPrompt 次，同一轮只检查一次。
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
