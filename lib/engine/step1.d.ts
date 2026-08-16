/**
 * 第 1 步：编译 / 运行检查。
 * 有报错 → 直接返回报错信息（后续步骤跳过），且一次性汇报本步收集到的所有错误。
 * @module dsh-code-checker/engine
 *
 * 文件作用：本文件实现检查流程的第 1 步，即对项目执行依赖安装、构建与运行探针，
 * 从命令输出中提取错误（含具体的 文件:行号 定位）并生成检查发现（Finding），
 * 有报错则直接返回报错信息。
 */
import type { CheckOptions, EngineIo, StepResult } from './types.js';
/** 一条结构化的错误信息：文本 + 可能的文件/行号/列号定位。 */
export interface LocatedError {
    /** 错误描述文本。 */
    text: string;
    /** 出错文件（相对或绝对路径，能解析出来时才有）。 */
    file?: string;
    /** 出错行号（1 起）。 */
    line?: number;
    /** 出错列号（可选）。 */
    column?: number;
}
/** 把一条定位信息格式化为可读文本（“文件:行号”）。 */
export declare function formatErrorLocation(error: LocatedError): string;
/** 提炼输出中最多 N 条错误片段（含文件:行号定位）。 */
export declare function extractErrors(stdout: string, stderr: string, max?: number): LocatedError[];
/**
 * 执行第 1 步。
 */
export declare function runStep1(opts: CheckOptions, io: EngineIo): Promise<StepResult>;
