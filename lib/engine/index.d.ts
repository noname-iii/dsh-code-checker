/**
 * 文件作用：dsh-code-checker 引擎入口 —— 组织并串联“三步流水线”检查：
 *   1. 编译运行检查 —— 有报错直接返回报错信息；
 *   2. 功能完整性核对 —— 全部缺失项一次性汇报；
 *   3. 真实用户模拟 —— 记录卡顿/无响应/报错，无问题返回“没有问题”；
 *      第 3 步在第 1、2 步都通过后执行；项目带 GUI（用户操作界面，含
 *      DeepSeek Harness 插件面板）时必须走 GUI 模拟（web/桌面），CLI 项目走命令模拟。
 * 同时对外导出配置缺省值、配置合并函数、各子步骤函数、类型与工具函数。
 *
 * dsh-code-checker 引擎入口：三步流水线
 *   1. 编译运行检查 —— 有报错直接返回报错信息
 *   2. 功能完整性核对 —— 全部缺失项一次性汇报
 *   3. 真实用户模拟 —— 第 1、2 步通过后执行；有 GUI 的项目必须走 GUI 模拟
 * @module dsh-code-checker/engine
 */
import type { CheckOptions, CheckReport, EngineIo } from './types.js';
export * from './types.js';
export * from './fs.js';
export * from './detect.js';
export * from './requirements.js';
export { runStep1 } from './step1.js';
export { runStep2 } from './step2.js';
export { runStep3 } from './step3.js';
export { renderReport } from './report.js';
/** 配置缺省值。 */
export declare const DEFAULTS: {
    readonly installDeps: true;
    readonly buildTimeoutMs: 180000;
    readonly runProbeMs: 8000;
    readonly simulate: true;
    readonly runAllSteps: false;
    readonly useLlm: true;
    readonly maxSampleFiles: 400;
    readonly maxSampleBytes: 250000;
    readonly language: "zh";
    readonly cleanMessage: "没有问题";
};
/** 合并默认配置。 */
export declare function resolveOptions(partial: Partial<CheckOptions> & {
    projectDir: string;
}): CheckOptions;
/**
 * 执行完整三步检查。
 * @param opts - 检查配置（projectDir 必填）
 * @param io - IO 适配器（exec / start / analyzer / log / platform）
 */
export declare function runCheck(opts: CheckOptions, io: EngineIo): Promise<CheckReport>;
