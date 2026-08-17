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
/** 插件所有可配置字段的类型。 */
export interface Config {
    /** 是否启用本插件。 */
    enabled: boolean;
    /** 是否在 AI 完成编码轮次后自动执行检查。 */
    autoCheck: boolean;
    /** 每个用户提示词允许的自动检查次数上限（防死循环；“检查→修复→再检查”闭环每次修复后会再次触发，上限到后等待新用户输入）。 */
    maxAutoChecksPerPrompt: number;
    /** 自动检查的最低编码活动工具调用次数（低于此数不触发）。 */
    minCodingCalls: number;
    /** 视为“编码活动”的工具名列表（web 预设里的文件/shell 工具；只列出会产生/改变代码的工具，避免纯浏览也触发）。 */
    codingTools: string[];
    /** 是否安装依赖（有锁文件且 node_modules 缺失时）。 */
    installDeps: boolean;
    /** 构建超时（毫秒）。 */
    buildTimeoutMs: number;
    /** 运行探针时长（毫秒）。 */
    runProbeMs: number;
    /** 是否执行第 3 步（真实用户模拟）。 */
    simulate: boolean;
    /** 第 2/3 步是否使用 LLM 深度分析。 */
    useLlm: boolean;
    /** 检查结果回传给 AI 的方式。 */
    reportToAi: 'steer' | 'inject' | 'none';
    /** 是否挂载内置 Web 检查面板（/code-checker/）。 */
    gui: boolean;
    /** 报告语言。 */
    language: 'zh' | 'en';
    /** 结果干净时回传 AI 的消息文本。 */
    cleanMessage: string;
    /** 回传 AI 的报告文本长度上限（超出截断）。 */
    maxReportChars: number;
    /** 保存的检查报告份数（GUI 用）。 */
    maxStoredReports: number;
    /** 源码采样预算（字节）。 */
    maxSampleBytes: number;
    /** 源码采样文件数上限。 */
    maxSampleFiles: number;
    /** 模拟产物目录（截图等）；为空用系统临时目录。 */
    artifactDir: string;
    /** 默认检查目录（会话没有 cwd 时使用）。 */
    defaultDir: string;
    /** 是否追加“写完代码后主动调用 check_project 检查”的系统提示词段（只追加、不修改既有提示词）。 */
    promptSection: boolean;
    /** 提示词段内容（追加到系统提示词尾部，可自定义）。 */
    promptSectionText: string;
    /** 当某会话需要用户操作（审批/决策是否运行命令）时，是否在系统层面发桌面通知（Windows/macOS/Linux）。 */
    notifyApprovals: boolean;
}
/** 默认配置（同时是校验器合并缺失字段的基底）。 */
export declare const DEFAULT_CONFIG: Config;
/**
 * 自包含的 Standard Schema 校验器：把用户配置与默认值合并并做宽松校验。
 * Cordis 加载器只依赖 `'~standard'.validate()` 这一标准接口，
 * 因此这里不需要引入 schemastery 依赖。
 */
export declare const Config: {
    '~standard': {
        version: 1;
        vendor: 'dsh-code-checker';
        validate: (input: unknown) => {
            value: Config;
        } | {
            issues: {
                message: string;
            }[];
        };
    };
};
