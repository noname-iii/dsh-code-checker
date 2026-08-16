/**
 * 文件作用：OpenAI 兼容接口的 LLM 分析器（CLI/MCP 在无 Harness 环境下使用）。
 * OpenAI 兼容接口的 LLM 分析器（CLI/MCP 在无 Harness 环境下使用）。
 * @module dsh-code-checker/cli
 */
import type { AnalyzeFn } from '../engine/types.js';
export interface OpenAiAnalyzerOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** 请求超时（毫秒）。 */
    timeoutMs?: number;
}
/** 构造 OpenAI 兼容分析器。 */
export declare function makeOpenAiAnalyzer(options: OpenAiAnalyzerOptions): AnalyzeFn;
