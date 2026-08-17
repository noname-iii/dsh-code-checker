/**
 * 文件作用：实现“真实用户模拟”（第 3 步）——依据用户描述的功能（或 README）设计并执行操作计划，
 *   模拟真实用户使用软件（键盘输入、鼠标点击/拖动等），记录卡顿、无响应、报错等异常。
 *   支持三类模拟：web（HTTP 探针 + 可选 Playwright）、cli（执行命令并核对期望输出）、
 *   desktop（Windows UIA）；模拟计划优先由 LLM 生成，失败则使用按项目类型的默认计划。
 *
 * 第 3 步：模拟真实用户使用软件（键盘输入、鼠标点击/拖动等），
 * 依据用户描述的功能（或 README）操作，记录卡顿、无响应、报错等异常。
 * @module dsh-code-checker/engine
 */
import type { CheckOptions, EngineIo, StepResult } from './types.js';
import type { ProjectInfo } from './detect.js';
import type { ProjectFiles } from './fs.js';
/** 模拟计划中的一次交互。 */
export interface Interaction {
    action: 'goto' | 'click' | 'type' | 'press' | 'wait' | 'screenshot' | 'drag';
    target?: string;
    value?: string;
    expect?: string;
}
/** 模拟计划。 */
export interface SimPlan {
    kind: 'web' | 'cli' | 'desktop' | 'none';
    /** 启动说明（供日志展示）。 */
    startNote?: string;
    /** web 专用交互。 */
    interactions: Interaction[];
    /** cli 专用命令（或交互输入）。 */
    commands: {
        input: string;
        expect?: string;
    }[];
    /** 期望的 web 服务端口（候选）。 */
    ports?: number[];
}
/** 执行第 3 步。 */
export declare function runStep3(// 定义第 3 步主函数
sourceText: string, // 来源文本（用户需求与 README）
projectInfo: ProjectInfo, // 项目信息
opts: CheckOptions, // 检查配置
io: EngineIo, // IO 适配器
project?: ProjectFiles): Promise<StepResult>;
