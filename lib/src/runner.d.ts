/**
 * 文件作用：Harness IO 适配器 —— 把 ctx.shell / ctx.llm 适配成引擎的 exec/start/analyzer。
 * Harness IO 适配器：把 ctx.shell / ctx.llm 适配成引擎的 ExecFn / StartFn / AnalyzeFn。
 * @module dsh-code-checker
 */
import type { ShellExecutor } from '@deepseek-ai/dsh-shell';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { AnalyzeFn, ExecFn, EngineIo, StartFn } from '../engine/types.js';
/** ctx.shell → 前台执行适配器。 */
export declare function makeShellExec(shell: ShellExecutor): ExecFn;
/** ctx.shell → 后台启动适配器。 */
export declare function makeShellStart(shell: ShellExecutor): StartFn;
/** ctx.llm → 引擎 LLM 分析器。 */
export declare function makeLlmAnalyzer(llm: LlmRuntime, provider: string, model: string, log: (line: string) => void): AnalyzeFn | undefined;
/** 解析某 agent 的 provider/model（agent options → 默认模型服务）。 */
export declare function resolveModel(agent: Agent | undefined, defaultModel: {
    provider: string;
    model: string;
} | undefined, providers: {
    id?: string;
    name?: string;
}[]): {
    provider: string;
    model: string;
} | undefined;
/** 组装完整 EngineIo。 */
export declare function makeEngineIo(shell: ShellExecutor, platform: 'win32' | 'posix', analyzer: AnalyzeFn | undefined, log: (line: string) => void, signal?: AbortSignal): EngineIo;
