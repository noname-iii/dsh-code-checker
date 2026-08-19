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

// 导入 path.basename：从目录路径取项目名（画面视图左侧项目列表用）
import { basename } from 'node:path'
// 导入 Cordis 的 Context 类型（插件 apply 函数参数用）
import type { Context } from '@deepseek-ai/cordis'
// 导入 dsh-agent 的 Agent 类型
import type { Agent } from '@deepseek-ai/dsh-agent'
// 导入 dsh-session 的 Session 类型
import type { Session } from '@deepseek-ai/dsh-session'
// 导入本模块的 Config schema 与默认配置
import { Config, DEFAULT_CONFIG } from './config.js'
// 以别名导入 Config 类型（避免与导出的 Config schema 值重名）
import type { Config as ConfigType } from './config.js'
// 导入会话跟踪器安装函数与需求提取函数
import { installTracker, userRequirementsFromSession } from './tracker.js'
// 导入斜杠命令安装函数
import { installCommand } from './commands.js'
// 导入模型工具安装函数
import { installTool } from './tool.js'
// 导入 GUI 安装函数与报告存储类
import { installGui, ReportStore } from './gui.js'
// 导入审批系统通知安装函数
import { installApprovalNotifier } from './notify.js'
// 导入回传、修复指令与报告截断函数
import { deliverToAgent, fixInstruction, truncateReport } from './feedback.js'
// 导入引擎 IO、LLM 分析器与模型解析函数
import { makeEngineIo, makeLlmAnalyzer, resolveModel } from './runner.js'
// 导入三步检查流水线入口函数
import { runCheck } from '../engine/index.js'
// 导入引擎相关类型
import type { AnalyzeFn, CheckOptions, CheckReport } from '../engine/types.js'
// 导入需求提取函数
import { extractRequirements } from '../engine/requirements.js'

// 加载各包的类型增强（Context.shell / Context.tools / Context.commands / Context.agents 等）
import type {} from '@deepseek-ai/dsh-shell' // 加载 shell 相关类型增强
import type {} from '@deepseek-ai/dsh-llm' // 加载 llm 相关类型增强
import type {} from '@deepseek-ai/dsh-commands' // 加载 commands 相关类型增强
import type {} from '@deepseek-ai/dsh-agent' // 加载 agent 相关类型增强
import type {} from '@deepseek-ai/dsh-tools' // 加载 tools 相关类型增强
import type {} from '@deepseek-ai/dsh-host-webserver' // 加载 webserver 相关类型增强
import type {} from '@deepseek-ai/dsh-agent-default-model' // 加载默认模型相关类型增强

export const name = 'code-checker' // 导出插件名称标识
export const inject = ['shell', 'tools', 'commands', 'agents'] // 声明本插件需要注入的服务列表
// 供 Cordis loader 填充 schema 默认值（必须在插件模块本身导出 Config schema）
export { Config } from './config.js' // 重新导出 Config schema，供 loader 填充默认值

export function apply(ctx: Context, config?: ConfigType): void { // 插件入口：Cordis 加载本插件时调用
  // loader 已按 schema 填充默认值；万一未提供（例如被其他加载方式直接调用），回退到默认配置
  config = config ?? DEFAULT_CONFIG // 若未传入配置则回退到默认配置
  if (!config.enabled) { // 若配置禁用了本插件
    console.log('[dsh-code-checker] 插件已通过配置禁用（enabled: false）。') // 输出禁用提示
    return // 直接返回，不再执行后续初始化
  }
  // headless/部分组合未挂载 console logger，直接写 stdout（与官方插件教程一致）
  const log = (line: string): void => { console.log('[dsh-code-checker] ' + line) } // 定义日志函数：加前缀后输出到 stdout
  log('dsh-code-checker 已加载（自动检查 ' + (config.autoCheck ? '开' : '关') + '，回传方式 ' + config.reportToAi + '）') // 输出插件加载信息

  const store = new ReportStore(config.maxStoredReports) // 创建报告存储实例，容量来自配置
  const platform: 'win32' | 'posix' = process.platform === 'win32' ? 'win32' : 'posix' // 判断当前运行平台（win32 或 posix）

  /** 解析项目目录。 */
  const projectDirFor = (session: Session | undefined, explicit?: string): string => { // 定义项目目录解析函数
    if (explicit && explicit.trim()) return explicit.trim() // 有显式目录且非空则去除首尾空白后直接返回
    return session?.header.cwd ?? (config.defaultDir.trim() ? config.defaultDir.trim() : process.cwd()) // 否则依次回退到会话 cwd、默认目录、进程 cwd
  }

  /** 构造 LLM 分析器（第 2/3 步深度分析）。 */
  const buildAnalyzer = (agent: Agent | undefined): AnalyzeFn | undefined => { // 定义 LLM 分析器构造函数
    if (!config.useLlm) return undefined // 未启用 LLM 则直接返回 undefined
    const llm = ctx.get('llm', false) // 从上下文获取 llm 服务（不存在则返回 false）
    if (!llm) { // 若 llm 服务不可用
      log('LLM 服务不可用，第 2/3 步使用启发式分析。') // 记录降级为启发式分析的日志
      return undefined // 返回 undefined
    }
    const defaultModelService = ctx.get('agentDefaultModel', false) // 获取默认模型服务（不存在则 false）
    const selection = defaultModelService // 取默认模型服务
      ? defaultModelService.currentSelection() // 若存在则取它的当前模型选择
      : undefined // 否则为 undefined
    const providers = llm.listProviders() // 列出所有可用的 LLM provider
    const model = resolveModel(agent, selection, providers) // 解析出最终要使用的模型
    if (!model || !model.model) { // 若未能确定模型
      log('无法确定 LLM provider/model，第 2/3 步使用启发式分析。') // 记录降级日志
      return undefined // 返回 undefined
    }
    return makeLlmAnalyzer(llm, model.provider, model.model, log) // 构造并返回 LLM 分析器
  }

  /**
   * 对某个 agent 执行一次完整检查。
   * options.projectDir / extraRequirements / simulate 用于手动与工具触发时覆盖。
   */
  const runForAgent = async ( // 定义对单个 agent 执行完整检查的异步函数
    agent: Agent | undefined, // 参数：目标 agent（可能不存在）
    reason: 'auto' | 'command' | 'tool', // 参数：触发方式（自动/命令/工具）
    options: { projectDir?: string; extraRequirements?: string; simulate?: boolean; signal?: AbortSignal } = {}, // 参数：可选覆盖项，默认为空对象
  ): Promise<CheckReport> => { // 函数返回检查报告
    const session = agent?.session // 取 agent 的会话（可能不存在）
    const projectDir = projectDirFor(session, options.projectDir) // 解析出项目目录
    const sessionText = session ? userRequirementsFromSession(session).text : '' // 从会话提取用户需求文本
    const requirementText = (sessionText + (options.extraRequirements ? '\n' + options.extraRequirements : '')).trim() // 拼接额外需求文本并去除首尾空白
    const requirements = extractRequirements(requirementText) // 从需求文本提取需求列表

    const analyzer = buildAnalyzer(agent) // 构造 LLM 分析器（可能为 undefined）
    const io = makeEngineIo(ctx.shell, platform, analyzer, log, options.signal) // 构造引擎 IO（含 shell 执行与取消信号）
    const checkOptions: CheckOptions = { // 组装传给引擎的检查选项对象
      projectDir, // 项目目录
      requirements, // 需求列表
      requirementText, // 需求原文
      installDeps: config.installDeps, // 是否安装依赖
      buildTimeoutMs: config.buildTimeoutMs, // 构建超时
      runProbeMs: config.runProbeMs, // 运行探针时长
      simulate: options.simulate ?? config.simulate, // 是否模拟（优先取覆盖项）
      runAllSteps: false, // 不强制运行全部步骤
      useLlm: config.useLlm, // 是否使用 LLM 分析
      maxSampleFiles: config.maxSampleFiles, // 采样文件数上限
      maxSampleBytes: config.maxSampleBytes, // 采样字节预算
      language: config.language, // 报告语言
      ...config.artifactDir.trim() ? { artifactDir: config.artifactDir.trim() } : {}, // 若配置了产物目录则展开传入（去除空白）
      cleanMessage: config.cleanMessage, // 干净结果回传消息
    }
    log('开始检查 ' + projectDir + '（触发方式: ' + reason + '，需求 ' + String(requirements.length) + ' 条）') // 记录开始检查日志
    const report = await runCheck(checkOptions, io) // 等待执行三步检查流水线
    store.add(report, agent ? String(agent.id) : undefined) // 将报告存入存储（带 agent id）

    if (agent && reason !== 'tool') { // 仅当有 agent 且不是工具触发时才回传
      // 有问题的报告：前缀“修复并复查”指令 + 截断后的报告正文；干净则用干净消息
      const message = report.ok // 报告是否干净（无问题）
        ? config.cleanMessage // 干净则使用干净消息
        : fixInstruction(config.language) + truncateReport(report.rendered, config.maxReportChars) // 有问题则“修复指令 + 报告正文”
      const delivered = deliverToAgent(agent, message, config.reportToAi, report.ok) // 按配置方式回传（steer 模式：问题唤醒修复、干净仅注入）
      log(delivered // 根据回传结果输出日志
        ? (report.ok ? '检查通过，已回传“' + config.cleanMessage + '”。' : '发现问题，已回传报告给 AI（AI 修复后会自动再次检查）。') // 回传成功：区分通过/发现问题
        : '检查完成（按配置未回传 AI）。') // 回传未发生（如配置为 none）
    }
    return report // 返回检查报告
  }

  // ── 自动检查跟踪器 ──
  installTracker(ctx, { // 安装自动检查跟踪器
    config: { // 传入跟踪器所需的配置子对象
      enabled: config.enabled, // 是否启用
      autoCheck: config.autoCheck, // 是否自动检查
      maxAutoChecksPerPrompt: config.maxAutoChecksPerPrompt, // 每提示自动检查次数上限
      minCodingCalls: config.minCodingCalls, // 最低编码活动调用次数
      codingTools: config.codingTools, // 编码活动工具名列表
    },
    isRoot(agent: Agent): boolean { // 判断是否为根 agent 的方法
      return ctx.agents.roots().includes(agent) // 返回该 agent 是否在根 agent 列表中
    },
    async runCheckForAgent(agent: Agent, reason, extraRequirements, signal): Promise<void> { // 供跟踪器调用的检查执行方法
      await runForAgent(agent, reason, { extraRequirements, signal }) // 执行一次完整检查
    },
    log, // 传入日志函数
  })

  // ── 审批系统通知（会话需要用户操作时弹桌面通知，不劫持决策）──
  installApprovalNotifier(ctx, { enabled: config.notifyApprovals }, log) // 安装审批通知观察器

  // ── /check 命令 ──
  installCommand(ctx, { // 安装 /check 斜杠命令
    async runCheckForAgent(agent: Agent, _reason, extraRequirements): Promise<void> { // 命令触发的检查执行方法
      await runForAgent(agent, 'command', { extraRequirements }) // 以 command 方式执行检查
    },
    lastReportText(sessionId: string): string { // 获取指定会话最后一份报告文本
      return store.lastFor(sessionId)?.report.summary ?? '' // 返回摘要，无报告则返回空串
    },
    log, // 传入日志函数
  })

  // ── check_project 模型工具 ──
  installTool(ctx, { // 安装 check_project 模型工具
    async runCheckReturnText(agent, _reason, options): Promise<string> { // 工具触发的检查执行方法
      const report = await runForAgent(agent, 'tool', options) // 以 tool 方式执行检查
      return report.rendered // 返回渲染后的报告文本
    },
    log, // 传入日志函数
  })

  // ── 方式一：追加系统提示词段（只追加、不改动任何既有提示词）──
  // 让 AI 在写完代码后主动调用 check_project 检查并按报告修复；
  // 方式二（turn-stopping 自动检查）由 tracker 提供，作为兜底始终生效。
  if (config.promptSection) { // 若配置启用了提示词段
    const systemPrompt = ctx.get('systemPrompt', false) // 获取系统提示词服务（不存在则跳过）
    if (systemPrompt) { // 若服务存在
      systemPrompt.section({ // 注册提示词段（追加式，不删除任何既有内容）
        name: 'code-checker:finish-guidance', // 段名（唯一）
        order: 180, // 顺序：位于工具引导带（100-199）内，工具声明之后
        text: config.promptSectionText, // 段内容（可配置）
      }) // 注册即生效，随插件卸载自动移除
      log('已追加系统提示词段（完成后主动调用 check_project）。') // 记录日志
    } else { // 服务不存在
      log('systemPrompt 服务不可用，跳过提示词段（turn-stopping 自动检查仍然生效）。') // 记录回退说明
    }
  }

  // ── 可选 GUI ──
  if (config.gui) { // 若配置启用了 GUI
    const webServer = ctx.get('webServer', false) // 获取 webServer 服务（不存在则 false）
    if (webServer) { // 若 webServer 服务存在
      // 把“正在被 AI 修改的项目”（根 agent 会话 cwd）作为画面视图左侧的活跃项目列表提供给 GUI。
      installGui(webServer, store, () => { // 挂载 GUI 检查面板，并注入活跃项目列表回调
        const seen = new Set<string>() // 按目录去重
        const out: { dir: string; name: string; sessionId: string }[] = [] // 项目列表结果
        for (const rootAgent of ctx.agents.roots()) { // 遍历所有根 agent
          const dir = rootAgent.session?.header.cwd // 取会话工作目录
          if (!dir || seen.has(dir)) continue // 无目录或已记录则跳过
          seen.add(dir) // 标记已记录
          out.push({ dir, name: basename(dir), sessionId: String(rootAgent.id) }) // 收集项目
        }
        return out // 返回活跃项目列表
      })
      log('检查面板已挂载: /code-checker/') // 记录面板挂载日志
    } else { // 否则（webServer 不存在）
      log('webServer 服务不存在（headless 环境），跳过 GUI 挂载。') // 记录跳过 GUI 的日志
    }
  }
}
