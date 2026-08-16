/**
 * 文件作用：插件入口 apply() —— 装配配置、跟踪器、命令、工具、GUI 与检查执行。
 * dsh-code-checker —— DeepSeek Harness 代码全面检查插件入口。
 *
 * 三步流水线（engine/）：
 *   1. 编译与运行检查 —— 有报错直接把报错信息回传 AI；
 *   2. 功能完整性核对 —— 按用户消息逐条核对需求，把所有未实现/不完整功能一次性回传 AI；
 *   3. 真实用户模拟 —— 键盘/鼠标模拟操作（web: Playwright；桌面: Windows UIA；
 *      CLI: 命令驱动），记录卡顿、无响应、报错；无问题回传“没有问题”。
 *
 * 集成面：
 *   - 自动触发：监听 session/event，AI 编码轮次结束后自动检查（带防循环上限）；
 *   - /check 斜杠命令（人机命令面）；
 *   - check_project 模型工具（AI 主动请求检查）；
 *   - 可选 GUI：/code-checker/ 检查面板。
 *
 * @module dsh-code-checker
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config as ConfigType } from './config.js';
export declare const name = "code-checker";
export declare const inject: string[];
export { Config } from './config.js';
export declare function apply(ctx: Context, config?: ConfigType): void;
