/**
 * 文件作用：插件配置 —— Schemastery schema（带默认值）与 DEFAULT_CONFIG 兜底。
 * dsh-code-checker 插件配置（Schemastery schema，带默认值）。
 * 所有字段都可在 cordis.yml 的行 config 中覆盖。
 * @module dsh-code-checker
 */
import Schema from '@deepseek-ai/schemastery';
export interface Config {
    /** 是否启用本插件。 */
    enabled: boolean;
    /** 是否在 AI 完成编码轮次后自动执行检查。 */
    autoCheck: boolean;
    /** 每个用户提示词允许的自动检查次数上限（防止修复-检查死循环）。 */
    maxAutoChecksPerPrompt: number;
    /** 自动检查的最低编码活动工具调用次数（低于此数不触发）。 */
    minCodingCalls: number;
    /** 视为“编码活动”的工具名列表（web 预设里的文件/shell 工具）。 */
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
}
/** 默认配置（与 schema 默认值保持同步，作为 apply 的兜底）。 */
export declare const DEFAULT_CONFIG: Config;
export declare const Config: Schema<Config>;
