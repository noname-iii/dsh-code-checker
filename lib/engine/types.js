/**
 * 文件作用：dsh-code-checker 引擎的“核心类型定义”文件。
 *
 * 这个文件不包含任何可执行逻辑，只定义整个检查引擎使用的数据结构：
 *   - ExecResult / ExecOptions / ExecFn / StartFn：进程执行相关的接口，
 *     让引擎可以“不关心宿主是谁”——在 Harness 里由 ctx.shell 适配，
 *     在独立 CLI 里由 child_process 适配；
 *   - EngineIo：注入给引擎的 IO 适配器集合（执行、后台启动、LLM 分析、日志）；
 *   - CheckOptions：一次检查的全部配置；
 *   - Finding / RequirementVerdict / Anomaly / StepResult / CheckReport：
 *     检查结果的完整数据模型，最后被渲染成回传 AI 的报告文本。
 *
 * 引擎（engine/）与 DeepSeek Harness 完全解耦，只依赖 Node 内置模块，
 * 因此同一套引擎可以同时被 Harness 插件、独立 CLI、MCP 服务器复用。
 *
 * @module dsh-code-checker/engine
 */
export {};
//# sourceMappingURL=types.js.map