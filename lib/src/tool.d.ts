/**
 * 文件作用：注册 check_project 模型工具 —— AI 可主动请求检查项目并把报告作为工具结果返回。
 * check_project 模型工具：AI 可在任意时刻主动请求检查项目。
 * @module dsh-code-checker
 */
import type { Context } from '@deepseek-ai/cordis';
/** 依赖注入接口。 */
export interface ToolDeps {
    /** 对指定 agent 执行检查（返回渲染文本）。 */
    runCheckReturnText(agent: import('@deepseek-ai/dsh-agent').Agent | undefined, reason: 'auto' | 'command' | 'tool', options: {
        projectDir?: string;
        extraRequirements?: string;
        simulate?: boolean;
    }): Promise<string>;
    log(line: string): void;
}
/** 注册 check_project 工具。 */
export declare function installTool(ctx: Context, deps: ToolDeps): void;
