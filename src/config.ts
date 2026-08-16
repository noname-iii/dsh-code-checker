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
  enabled: boolean // 是否启用本插件（布尔值）
  /** 是否在 AI 完成编码轮次后自动执行检查。 */
  autoCheck: boolean // 是否在编码轮次结束后自动执行检查
  /** 每个用户提示词允许的自动检查次数上限（防死循环；“检查→修复→再检查”闭环每次修复后会再次触发，上限到后等待新用户输入）。 */
  maxAutoChecksPerPrompt: number // 每个用户提示词允许的自动检查次数上限
  /** 自动检查的最低编码活动工具调用次数（低于此数不触发）。 */
  minCodingCalls: number // 触发自动检查的最低编码活动工具调用次数
  /** 视为“编码活动”的工具名列表（web 预设里的文件/shell 工具；只列出会产生/改变代码的工具，避免纯浏览也触发）。 */
  codingTools: string[] // 视为“编码活动”的工具名列表
  /** 是否安装依赖（有锁文件且 node_modules 缺失时）。 */
  installDeps: boolean // 是否在缺依赖时安装依赖
  /** 构建超时（毫秒）。 */
  buildTimeoutMs: number // 构建超时（毫秒）
  /** 运行探针时长（毫秒）。 */
  runProbeMs: number // 运行探针时长（毫秒）
  /** 是否执行第 3 步（真实用户模拟）。 */
  simulate: boolean // 是否执行第 3 步（真实用户模拟）
  /** 第 2/3 步是否使用 LLM 深度分析。 */
  useLlm: boolean // 第 2/3 步是否使用 LLM 深度分析
  /** 检查结果回传给 AI 的方式。 */
  reportToAi: 'steer' | 'inject' | 'none' // 检查结果回传给 AI 的方式（三选一）
  /** 是否挂载内置 Web 检查面板（/code-checker/）。 */
  gui: boolean // 是否挂载内置 Web 检查面板
  /** 报告语言。 */
  language: 'zh' | 'en' // 报告语言（二选一）
  /** 结果干净时回传 AI 的消息文本。 */
  cleanMessage: string // 结果干净时回传 AI 的消息文本
  /** 回传 AI 的报告文本长度上限（超出截断）。 */
  maxReportChars: number // 回传 AI 的报告文本长度上限
  /** 保存的检查报告份数（GUI 用）。 */
  maxStoredReports: number // 保存的检查报告份数
  /** 源码采样预算（字节）。 */
  maxSampleBytes: number // 源码采样预算（字节）
  /** 源码采样文件数上限。 */
  maxSampleFiles: number // 源码采样文件数上限
  /** 模拟产物目录（截图等）；为空用系统临时目录。 */
  artifactDir: string // 模拟产物目录（为空用系统临时目录）
  /** 默认检查目录（会话没有 cwd 时使用）。 */
  defaultDir: string // 默认检查目录
  /** 是否追加“写完代码后主动调用 check_project 检查”的系统提示词段（只追加、不修改既有提示词）。 */
  promptSection: boolean // 是否注册提示词段
  /** 提示词段内容（追加到系统提示词尾部，可自定义）。 */
  promptSectionText: string // 提示词段文本
}

/** 默认配置（同时是校验器合并缺失字段的基底）。 */
export const DEFAULT_CONFIG: Config = {
  enabled: true, // 默认启用本插件
  autoCheck: true, // 默认开启自动检查
  maxAutoChecksPerPrompt: 6, // 每个用户提示最多自动检查 6 次（覆盖“检查→修复→再检查”的多轮闭环，仍有上限防死循环）
  minCodingCalls: 1, // 至少 1 次编码活动调用才触发
  codingTools: [ // 编码活动工具名列表（数组开始；只列会写/改代码或执行代码的工具）
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
}

/** 宽松字段级校验辅助：类型不符时回退到默认值（默认值即安全值）。 */
function pickBoolean(input: unknown, fallback: boolean): boolean { // 布尔字段校验
  return typeof input === 'boolean' ? input : fallback // 是布尔就取用，否则回退默认
}

function pickNumber(input: unknown, fallback: number): number { // 数字字段校验
  return typeof input === 'number' && Number.isFinite(input) ? input : fallback // 是有限数字就取用，否则回退默认
}

function pickString(input: unknown, fallback: string): string { // 字符串字段校验
  return typeof input === 'string' ? input : fallback // 是字符串就取用，否则回退默认
}

function pickStringArray(input: unknown, fallback: string[]): string[] { // 字符串数组字段校验
  return Array.isArray(input) && input.every(item => typeof item === 'string') ? input : fallback // 全为字符串的数组才取用，否则回退默认
}

function pickOneOf<T extends string>(input: unknown, fallback: T, allowed: readonly T[]): T { // 枚举字段校验
  return typeof input === 'string' && (allowed as readonly string[]).includes(input) ? input as T : fallback // 属于允许集合才取用，否则回退默认
}

/**
 * 自包含的 Standard Schema 校验器：把用户配置与默认值合并并做宽松校验。
 * Cordis 加载器只依赖 `'~standard'.validate()` 这一标准接口，
 * 因此这里不需要引入 schemastery 依赖。
 */
export const Config: {
  '~standard': {
    version: 1
    vendor: 'dsh-code-checker'
    validate: (input: unknown) => { value: Config } | { issues: { message: string }[] }
  }
} = {
  '~standard': {
    version: 1, // Standard Schema 版本
    vendor: 'dsh-code-checker', // 校验器提供方标识
    validate(input: unknown) { // 校验入口：input 为行 config（可能为 undefined）
      if (input === undefined || input === null) return { value: { ...DEFAULT_CONFIG } } // 未提供配置 → 返回默认值副本
      if (typeof input !== 'object' || Array.isArray(input)) { // 非对象（如字符串/数字/数组）→ 报错
        return { issues: [{ message: 'code-checker config must be an object' }] } // 返回问题列表
      }
      const source = input as Record<string, unknown> // 把输入视为普通对象
      const value: Config = { // 逐字段合并默认值 + 宽松校验
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
        reportToAi: pickOneOf(source.reportToAi, DEFAULT_CONFIG.reportToAi, ['steer', 'inject', 'none'] as const), // 回传方式
        gui: pickBoolean(source.gui, DEFAULT_CONFIG.gui), // 是否挂载 GUI
        language: pickOneOf(source.language, DEFAULT_CONFIG.language, ['zh', 'en'] as const), // 报告语言
        cleanMessage: pickString(source.cleanMessage, DEFAULT_CONFIG.cleanMessage), // 干净消息
        maxReportChars: pickNumber(source.maxReportChars, DEFAULT_CONFIG.maxReportChars), // 报告长度上限
        maxStoredReports: pickNumber(source.maxStoredReports, DEFAULT_CONFIG.maxStoredReports), // 报告保留份数
        maxSampleBytes: pickNumber(source.maxSampleBytes, DEFAULT_CONFIG.maxSampleBytes), // 采样字节预算
        maxSampleFiles: pickNumber(source.maxSampleFiles, DEFAULT_CONFIG.maxSampleFiles), // 采样文件数上限
        artifactDir: pickString(source.artifactDir, DEFAULT_CONFIG.artifactDir), // 产物目录
        defaultDir: pickString(source.defaultDir, DEFAULT_CONFIG.defaultDir), // 默认目录
        promptSection: pickBoolean(source.promptSection, DEFAULT_CONFIG.promptSection), // 是否提示词段
        promptSectionText: pickString(source.promptSectionText, DEFAULT_CONFIG.promptSectionText), // 提示词段文本
      }
      return { value } // 返回校验结果
    },
  },
}
