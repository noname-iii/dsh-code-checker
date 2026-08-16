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

/** 一次命令执行的归一化结果（无论底层是 ctx.shell 还是 child_process，都统一成这个形状）。 */
export interface ExecResult {
  /** 退出码；进程被信号杀死时为 null。 */
  exitCode: number | null
  /** 终止信号名（如 SIGTERM）。 */
  signal: string | null
  /** 是否因超时被杀 —— 对“运行探针”而言，超时恰恰说明程序存活，是预期的结果。 */
  timedOut: boolean
  /** 是否因取消（AbortSignal）被杀。 */
  aborted: boolean
  /** 捕获到的标准输出。 */
  stdout: string
  /** 捕获到的标准错误。 */
  stderr: string
  /** 实际耗时（毫秒）。 */
  durationMs: number
}

/** 命令执行请求（引擎 → IO 适配器的统一入参）。 */
export interface ExecOptions {
  /** 完整命令行（平台相关 shell 语法由调用方负责拼接）。 */
  command: string
  /** 工作目录。 */
  cwd: string
  /** 超时毫秒数；缺省由适配器决定。 */
  timeoutMs?: number
  /** 要写入子进程 stdin 的内容（用于驱动交互式 CLI）。 */
  stdin?: string
  /** 额外环境变量。 */
  env?: Record<string, string>
}

/** 前台执行适配器的函数类型（run-to-completion：跑完返回结果）。 */
export type ExecFn = (opts: ExecOptions) => Promise<ExecResult>

/** 一个已启动的后台进程句柄（用于拉起 dev server / GUI 程序做交互测试）。 */
export interface RunningProcess {
  /** 停止进程（含进程树）并等待其结束。 */
  stop(): Promise<void>
  /** 读取已捕获的累计输出（stdout+stderr）。 */
  output(): string
  /** 进程是否仍存活。 */
  alive(): boolean
}

/** 后台启动适配器的函数类型（立即返回句柄，不等待进程退出）。 */
export type StartFn = (opts: ExecOptions) => Promise<RunningProcess>

/** 注入给引擎的 IO 适配器集合 —— 引擎与宿主的唯一接口。 */
export interface EngineIo {
  /** 前台执行（必须）。 */
  exec: ExecFn
  /** 后台启动（可选；缺省时第 3 步的 web 模拟退化为仅端口探测）。 */
  start?: StartFn
  /** 宿主平台：'win32' | 'posix'（决定命令语法，如 python/python3、路径分隔符）。 */
  platform: 'win32' | 'posix'
  /** 可选 LLM 分析器（第 2/3 步的深度分析；缺省时使用启发式）。 */
  analyzer?: AnalyzeFn
  /** 进度日志回调。 */
  log: (line: string) => void
  /** 整次检查的取消信号（来自 turn 的 AbortSignal 或工具调用信号）。 */
  signal?: AbortSignal
}

/** 一次 LLM 分析请求（引擎 → 分析器的统一入参）。 */
export interface LlmRequest {
  /** 系统提示词（可选）。 */
  system?: string
  /** 用户提示词（必填，由引擎拼接好）。 */
  prompt: string
  /** 最大输出 token 数（可选）。 */
  maxTokens?: number
}

/** LLM 分析适配器的函数类型：返回模型文本输出。 */
export type AnalyzeFn = (req: LlmRequest, signal?: AbortSignal) => Promise<string>

/** 引擎配置 —— 一次完整检查的全部开关与预算。 */
export interface CheckOptions {
  /** 待检查项目根目录（绝对路径）。 */
  projectDir: string
  /** 用户需求条目（每项一条完整需求描述；为空时从 requirementText 自动提取）。 */
  requirements: string[]
  /** 原始需求文本（用于提取与展示）。 */
  requirementText?: string
  /** README 内容（检测阶段也会自动读取，此字段允许显式提供）。 */
  readme?: string
  /** 是否安装依赖（Node 等有锁文件的项目）。 */
  installDeps: boolean
  /** 构建超时（毫秒）。 */
  buildTimeoutMs: number
  /** 运行探针时长（毫秒）—— 程序保持存活这么长时间即视为“能运行”。 */
  runProbeMs: number
  /** 是否执行第 3 步（真实用户模拟）。 */
  simulate: boolean
  /** 是否在第 1 步失败时也继续后续步骤（默认严格按用户流程：失败即返回）。 */
  runAllSteps: boolean
  /** 是否允许使用 LLM 深度分析。 */
  useLlm: boolean
  /** 采样文件数上限。 */
  maxSampleFiles: number
  /** 采样内容总字节上限。 */
  maxSampleBytes: number
  /** 报告语言。 */
  language: 'zh' | 'en'
  /** 产物（截图/日志）输出目录；为空则写入系统临时目录。 */
  artifactDir?: string
  /** 结果“干净”时反馈给 AI 的消息文本（用户要求固定为“没有问题”）。 */
  cleanMessage: string
}

/** 发现（issue）的级别。 */
export type FindingLevel = 'error' | 'warning' | 'info'

/** 一条发现记录（第 1 步的报错、第 2 步的缺失、第 3 步的异常都会转成 Finding）。 */
export interface Finding {
  /** 级别：error 会令整个检查不通过，warning/info 只提示。 */
  level: FindingLevel
  /** 所在位置/阶段（如“构建”、“需求 #3”、“浏览器控制台”）。 */
  where: string
  /** 人类可读的描述。 */
  message: string
  /** 证据片段（原始输出/文件路径等，帮助 AI 定位问题）。 */
  evidence?: string
}

/** 单条需求的核对结论。 */
export interface RequirementVerdict {
  /** 需求在列表中的下标（从 0 开始）。 */
  index: number
  /** 需求原文。 */
  text: string
  /** 核对结论：已实现 / 部分实现 / 缺失 / 无法核对。 */
  status: 'implemented' | 'partial' | 'missing' | 'unchecked'
  /** 判断依据（匹配到的文件与行号，或占位标记）。 */
  evidence: string
  /** 修复建议（LLM 深度分析时给出）。 */
  suggestion?: string
}

/** 第 3 步模拟中记录到的异常。 */
export interface Anomaly {
  /** 异常类型：freeze=卡顿, unresponsive=无响应, error=报错, crash=崩溃, warning=警告。 */
  kind: 'freeze' | 'unresponsive' | 'error' | 'crash' | 'warning'
  /** 发生位置（操作/控件/命令）。 */
  where: string
  /** 异常描述。 */
  message: string
  /** 证据（输出片段等）。 */
  evidence?: string
  /** 耗时（毫秒，用于卡顿类异常）。 */
  durationMs?: number
}

/** 单步结果 —— 三步流水线中每一步的统一产出。 */
export interface StepResult {
  /** 步骤编号：1/2/3。 */
  step: 1 | 2 | 3
  /** 步骤标题（中文）。 */
  title: string
  /** 状态：通过 / 未通过 / 跳过 / 部分通过。 */
  status: 'passed' | 'failed' | 'skipped' | 'partial'
  /** 人类可读的明细行。 */
  detail: string[]
  /** 本步骤的发现记录。 */
  findings: Finding[]
  /** 第 2 步输出的需求核对结论（其余步骤为空）。 */
  verdicts?: RequirementVerdict[]
  /** 第 3 步输出的异常记录（其余步骤为空）。 */
  anomalies?: Anomaly[]
  /** 产物文件（截图等）。 */
  artifacts?: string[]
  /** 本步骤耗时（毫秒）。 */
  durationMs: number
}

/** 完整检查报告 —— 引擎的最终产出。 */
export interface CheckReport {
  /** 是否整体通过（无任何 error 级问题、无缺失功能、无异常）。 */
  ok: boolean
  /** 被检查的项目根目录。 */
  projectDir: string
  /** 识别出的项目类型（node/python/rust/...）。 */
  projectKind: string
  /** 项目名（目录名）。 */
  projectName: string
  /** 检查开始时间（ISO 字符串）。 */
  startedAt: string
  /** 总耗时（毫秒）。 */
  durationMs: number
  /** 三步结果（按顺序）。 */
  steps: StepResult[]
  /** 全部 error/warning 汇总。 */
  issues: Finding[]
  /** 每条需求与实现情况的核对结论（第 2 步的全部输出）。 */
  verdicts: RequirementVerdict[]
  /** 缺失或部分实现的需求（第 2 步结论的子集，供快速判断）。 */
  missingFeatures: RequirementVerdict[]
  /** 第 3 步的全部异常。 */
  anomalies: Anomaly[]
  /** 一段话总结。 */
  summary: string
  /** 渲染好的、可直接回传 AI 的完整报告文本。 */
  rendered: string
}
