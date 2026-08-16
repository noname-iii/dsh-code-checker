/**
 * 文件作用：插件配置 —— 配置接口、默认值，以及一个自包含的 Standard Schema 校验器。
 *
 * 说明（重要）：本文件【不】依赖 @deepseek-ai/schemastery 等任何外部包。
 * 原因：插件束通过 `dsh plugin add <目录>`（pnpm link）安装时，被链接的目录
 * 可能没有 node_modules，导致运行时 `import '@deepseek-ai/schemastery'` 解析失败、
 * 插件整行加载失败（在 AI 侧完全无踪影）。Cordis 加载器只要求插件导出的 Config
 * 实现 Standard Schema 的 `'~standard'.validate()` 接口，这里手工实现一个
 * “默认值合并 + 宽松校验”的校验器，即可零依赖完成同样的工作。
 * @module dsh-code-checker
 */
/** 默认配置（同时是校验器合并缺失字段的基底）。 */
export const DEFAULT_CONFIG = {
    enabled: true, // 默认启用本插件
    autoCheck: true, // 默认开启自动检查
    maxAutoChecksPerPrompt: 6, // 每个用户提示最多自动检查 6 次（覆盖“检查→修复→再检查”的多轮闭环，仍有上限防死循环）
    minCodingCalls: 1, // 至少 1 次编码活动调用才触发
    codingTools: [
        'write', 'edit', 'str-replace', 'run_code', 'bash', 'pwsh', // 文件写入/编辑/替换、代码执行与 shell 类工具
        'terminal', 'workflow', 'subagent', 'subagent_fork', // 终端、工作流与子代理类工具（子代理可能代为写代码）
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
    promptSectionText: '你完成代码/项目的编写或修改后，请主动调用 check_project 工具对当前项目做一次全面检查；收到检查报告后，请修复报告中的所有问题（编译错误、缺失功能、卡顿/报错等），修复后再调用一次 check_project 直到返回“没有问题”。如果收到插件自动推送的检查报告（消息来源为 dsh-code-checker 插件），也按同样方式处理：立即修复报告中列出的全部问题，然后再次调用 check_project 验证，直到返回“没有问题”。', // 默认提示词段内容
};
/** 宽松字段级校验辅助：类型不符时回退到默认值（默认值即安全值）。 */
function pickBoolean(input, fallback) {
    return typeof input === 'boolean' ? input : fallback; // 是布尔就取用，否则回退默认
}
function pickNumber(input, fallback) {
    return typeof input === 'number' && Number.isFinite(input) ? input : fallback; // 是有限数字就取用，否则回退默认
}
function pickString(input, fallback) {
    return typeof input === 'string' ? input : fallback; // 是字符串就取用，否则回退默认
}
function pickStringArray(input, fallback) {
    return Array.isArray(input) && input.every(item => typeof item === 'string') ? input : fallback; // 全为字符串的数组才取用，否则回退默认
}
function pickOneOf(input, fallback, allowed) {
    return typeof input === 'string' && allowed.includes(input) ? input : fallback; // 属于允许集合才取用，否则回退默认
}
/**
 * 自包含的 Standard Schema 校验器：把用户配置与默认值合并并做宽松校验。
 * Cordis 加载器只依赖 `'~standard'.validate()` 这一标准接口，
 * 因此这里不需要引入 schemastery 依赖。
 */
export const Config = {
    '~standard': {
        version: 1, // Standard Schema 版本
        vendor: 'dsh-code-checker', // 校验器提供方标识
        validate(input) {
            if (input === undefined || input === null)
                return { value: { ...DEFAULT_CONFIG } }; // 未提供配置 → 返回默认值副本
            if (typeof input !== 'object' || Array.isArray(input)) { // 非对象（如字符串/数字/数组）→ 报错
                return { issues: [{ message: 'code-checker config must be an object' }] }; // 返回问题列表
            }
            const source = input; // 把输入视为普通对象
            const value = {
                enabled: pickBoolean(source.enabled, DEFAULT_CONFIG.enabled), // 是否启用
                autoCheck: pickBoolean(source.autoCheck, DEFAULT_CONFIG.autoCheck), // 是否自动检查
                maxAutoChecksPerPrompt: pickNumber(source.maxAutoChecksPerPrompt, DEFAULT_CONFIG.maxAutoChecksPerPrompt), // 自动检查上限
                minCodingCalls: pickNumber(source.minCodingCalls, DEFAULT_CONFIG.minCodingCalls), // 最低编码调用数
                codingTools: pickStringArray(source.codingTools, DEFAULT_CONFIG.codingTools), // 编码工具名单
                installDeps: pickBoolean(source.installDeps, DEFAULT_CONFIG.installDeps), // 是否安装依赖
                buildTimeoutMs: pickNumber(source.buildTimeoutMs, DEFAULT_CONFIG.buildTimeoutMs), // 构建超时
                runProbeMs: pickNumber(source.runProbeMs, DEFAULT_CONFIG.runProbeMs), // 运行探针时长
                simulate: pickBoolean(source.simulate, DEFAULT_CONFIG.simulate), // 是否用户模拟
                useLlm: pickBoolean(source.useLlm, DEFAULT_CONFIG.useLlm), // 是否 LLM 分析
                reportToAi: pickOneOf(source.reportToAi, DEFAULT_CONFIG.reportToAi, ['steer', 'inject', 'none']), // 回传方式
                gui: pickBoolean(source.gui, DEFAULT_CONFIG.gui), // 是否挂载 GUI
                language: pickOneOf(source.language, DEFAULT_CONFIG.language, ['zh', 'en']), // 报告语言
                cleanMessage: pickString(source.cleanMessage, DEFAULT_CONFIG.cleanMessage), // 干净消息
                maxReportChars: pickNumber(source.maxReportChars, DEFAULT_CONFIG.maxReportChars), // 报告长度上限
                maxStoredReports: pickNumber(source.maxStoredReports, DEFAULT_CONFIG.maxStoredReports), // 报告保留份数
                maxSampleBytes: pickNumber(source.maxSampleBytes, DEFAULT_CONFIG.maxSampleBytes), // 采样字节预算
                maxSampleFiles: pickNumber(source.maxSampleFiles, DEFAULT_CONFIG.maxSampleFiles), // 采样文件数上限
                artifactDir: pickString(source.artifactDir, DEFAULT_CONFIG.artifactDir), // 产物目录
                defaultDir: pickString(source.defaultDir, DEFAULT_CONFIG.defaultDir), // 默认目录
                promptSection: pickBoolean(source.promptSection, DEFAULT_CONFIG.promptSection), // 是否提示词段
                promptSectionText: pickString(source.promptSectionText, DEFAULT_CONFIG.promptSectionText), // 提示词段文本
            };
            return { value }; // 返回校验结果
        },
    },
};
//# sourceMappingURL=config.js.map