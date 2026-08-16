/**
 * 文件作用：插件配置 —— Schemastery schema（带默认值）与 DEFAULT_CONFIG 兜底。
 * dsh-code-checker 插件配置（Schemastery schema，带默认值）。
 * 所有字段都可在 cordis.yml 的行 config 中覆盖。
 * @module dsh-code-checker
 */
// 导入 Schemastery 库，用于声明带校验规则与默认值的配置 schema
import Schema from '@deepseek-ai/schemastery';
/** 默认配置（与 schema 默认值保持同步，作为 apply 的兜底）。 */
// 导出默认配置常量对象（结构与 Config 接口一致）
export const DEFAULT_CONFIG = {
    enabled: true, // 默认启用本插件
    autoCheck: true, // 默认开启自动检查
    maxAutoChecksPerPrompt: 2, // 每个用户提示最多自动检查 2 次
    minCodingCalls: 1, // 至少 1 次编码活动调用才触发
    codingTools: [
        'write', 'edit', 'str-replace', 'read', 'run_code', 'bash', 'pwsh', // 文件写入/编辑/替换/读取、代码执行与 shell 类工具
        'terminal', 'todo_write', 'workflow', 'subagent', 'subagent_fork', // 终端、待办、工作流与子代理类工具
    ], // 编码活动工具名列表（数组结束）
    installDeps: true, // 默认在缺依赖时安装
    buildTimeoutMs: 180000, // 构建超时 180000 毫秒
    runProbeMs: 8000, // 运行探针 8000 毫秒
    simulate: true, // 默认执行第 3 步模拟
    useLlm: true, // 默认使用 LLM 分析
    reportToAi: 'steer', // 默认用 steer 方式回传
    gui: true, // 默认挂载 GUI
    language: 'zh', // 默认语言为中文
    cleanMessage: '没有问题', // 干净结果回传消息
    maxReportChars: 20000, // 报告长度上限 20000 字符
    maxStoredReports: 100, // 保存 100 份报告
    maxSampleBytes: 250000, // 采样预算 250000 字节
    maxSampleFiles: 400, // 采样文件数上限 400
    artifactDir: '', // 产物目录为空（用系统临时目录）
    defaultDir: '', // 默认目录为空（用进程 cwd）
    promptSection: true, // 默认追加“完成后调用 check_project”提示词段
    promptSectionText: '你完成代码/项目的编写或修改后，请主动调用 check_project 工具对当前项目做一次全面检查；收到检查报告后，请修复报告中的所有问题（编译错误、缺失功能、卡顿/报错等），修复后再调用一次 check_project 直到返回“没有问题”。', // 默认提示词段内容
};
// 导出 Config schema：用 Schemastery 声明每个字段的类型与默认值
export const Config = Schema.object({
    enabled: Schema.boolean().default(true), // 布尔类型，默认 true
    autoCheck: Schema.boolean().default(true), // 布尔类型，默认 true
    maxAutoChecksPerPrompt: Schema.number().default(2), // 数字类型，默认 2
    minCodingCalls: Schema.number().default(1), // 数字类型，默认 1
    codingTools: Schema.array(Schema.string()).default([
        'write', 'edit', 'str-replace', 'read', 'run_code', 'bash', 'pwsh', // 默认编码活动工具名（第一行）
        'terminal', 'todo_write', 'workflow', 'subagent', 'subagent_fork', // 默认编码活动工具名（第二行）
    ]), // 字符串数组默认值（数组结束）
    installDeps: Schema.boolean().default(true), // 布尔类型，默认 true
    buildTimeoutMs: Schema.number().default(180000), // 数字类型，默认 180000
    runProbeMs: Schema.number().default(8000), // 数字类型，默认 8000
    simulate: Schema.boolean().default(true), // 布尔类型，默认 true
    useLlm: Schema.boolean().default(true), // 布尔类型，默认 true
    reportToAi: Schema.union(['steer', 'inject', 'none']).default('steer'), // 三选一联合类型，默认 steer
    gui: Schema.boolean().default(true), // 布尔类型，默认 true
    language: Schema.union(['zh', 'en']).default('zh'), // 二选一联合类型，默认 zh
    cleanMessage: Schema.string().default('没有问题'), // 字符串类型，默认“没有问题”
    maxReportChars: Schema.number().default(20000), // 数字类型，默认 20000
    maxStoredReports: Schema.number().default(100), // 数字类型，默认 100
    maxSampleBytes: Schema.number().default(250000), // 数字类型，默认 250000
    maxSampleFiles: Schema.number().default(400), // 数字类型，默认 400
    artifactDir: Schema.string().default(''), // 字符串类型，默认为空
    defaultDir: Schema.string().default(''), // 字符串类型，默认为空
    promptSection: Schema.boolean().default(true), // 布尔类型，默认 true（追加“完成后调用 check_project”提示词段）
    promptSectionText: Schema.string().default('你完成代码/项目的编写或修改后，请主动调用 check_project 工具对当前项目做一次全面检查；收到检查报告后，请修复报告中的所有问题（编译错误、缺失功能、卡顿/报错等），修复后再调用一次 check_project 直到返回“没有问题”。'), // 字符串类型，默认提示词段内容
});
//# sourceMappingURL=config.js.map