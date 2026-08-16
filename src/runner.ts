/**
 * 文件作用：Harness IO 适配器 —— 把 ctx.shell / ctx.llm 适配成引擎的 exec/start/analyzer。
 * Harness IO 适配器：把 ctx.shell / ctx.llm 适配成引擎的 ExecFn / StartFn / AnalyzeFn。
 * @module dsh-code-checker
 */

// 引入 shell 执行器相关类型：ShellExecutor（执行器）与 ShellExecRequest（执行请求）
import type { ShellExecutor, ShellExecRequest } from '@deepseek-ai/dsh-shell'
// 引入 Agent 类型：代理对象
import type { Agent } from '@deepseek-ai/dsh-agent'
// 引入 randomUUID 函数：为手工构造的分析请求消息生成稳定 id
import { randomUUID } from 'node:crypto'
// 引入 LLM 运行时相关类型：LlmRuntime 与 GenerateOptions（生成选项）
import type { LlmRuntime, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
// 引入引擎类型：执行/启动/分析函数及各 IO 结构定义
import type {
  AnalyzeFn, ExecFn, ExecOptions, EngineIo, RunningProcess, StartFn,
} from '../engine/types.js'

/** ctx.shell → 前台执行适配器。 */
// 导出工厂函数：把 shell 执行器适配成引擎的前台执行函数
export function makeShellExec(shell: ShellExecutor): ExecFn {
  // 返回一个异步执行函数，入参为执行选项
  return async (opts: ExecOptions) => {
    // 构造 shell 执行请求对象
    const request: ShellExecRequest = {
      // 要执行的命令
      command: opts.command,
      // 仅当提供了 cwd 时才带上 workdir 字段
      ...opts.cwd !== undefined ? { workdir: opts.cwd } : {},
      // 仅当提供了 timeoutMs 时才带上超时字段
      ...opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {},
      // 仅当提供了 stdin 时才带上标准输入字段
      ...opts.stdin !== undefined ? { stdin: opts.stdin } : {},
      // 仅当提供了 env 时才带上环境变量字段
      ...opts.env !== undefined ? { env: opts.env } : {},
      // 标准输出最大字节数上限
      stdoutMaxBytes: 1_500_000,
    }
    // 调用 shell 解析请求，得到执行规格
    const spec = shell.resolve(request)
    // 记录开始时间戳，用于计算耗时
    const started = Date.now()
    // 实际执行命令并等待结果
    const result = await shell.run(spec)
    // 返回统一格式的执行结果
    return {
      // 退出码
      exitCode: result.exitCode,
      // 终止信号
      signal: result.signal,
      // 是否超时
      timedOut: result.timedOut,
      // 是否被中止
      aborted: result.aborted,
      // 标准输出文本
      stdout: result.stdout.text,
      // 标准错误文本
      stderr: result.stderr.text,
      // 执行耗时（毫秒）
      durationMs: Date.now() - started,
    }
  }
}

/** ctx.shell → 后台启动适配器。 */
// 导出工厂函数：把 shell 执行器适配成引擎的后台启动函数
export function makeShellStart(shell: ShellExecutor): StartFn {
  // 返回一个异步启动函数，返回运行中的进程句柄
  return async (opts: ExecOptions): Promise<RunningProcess> => {
    // 构造并解析启动请求，得到执行规格
    const spec = shell.resolve({
      // 要执行的命令
      command: opts.command,
      // 仅当提供了 cwd 时才带上 workdir 字段
      ...opts.cwd !== undefined ? { workdir: opts.cwd } : {},
      // 仅当提供了 env 时才带上环境变量字段
      ...opts.env !== undefined ? { env: opts.env } : {},
      // 标准输出最大字节数上限
      stdoutMaxBytes: 1_500_000,
    })
    // 启动后台进程，得到进程句柄
    const proc = shell.start(spec)
    // 初始化累积输出缓冲区
    let output = ''
    // 启动定时器，周期性轮询进程输出
    const timer = setInterval(() => {
      // 用 try/catch 包裹读取操作，进程退出后可能抛错
      try {
        // 读取进程增量输出
        const read = proc.readOutput()
        // 把增量输出追加到缓冲区
        output += read.delta
        // 输出超过 2MB 时仅保留最后 1MB，防止无限增长
        if (output.length > 2_000_000) output = output.slice(-1_000_000)
      } catch {
        // 进程退出后 readOutput 可能抛错，忽略
      }
    }, 400)
    // 进程自行退出时停掉轮询（不影响已返回的句柄）
    void proc.done.then(() => clearInterval(timer))
    // 返回运行进程句柄
    return {
      // 停止函数：清理定时器并终止进程
      async stop(): Promise<void> {
        // 先停掉轮询定时器
        clearInterval(timer)
        // 终止后台进程
        proc.kill()
        // 等待进程真正结束
        await proc.done
      },
      // 读取当前累积输出的函数
      output(): string {
        // 用 try/catch 包裹读取，避免进程已退出时抛错
        try {
          // 读取进程增量输出
          const read = proc.readOutput()
          // 把增量追加到缓冲区
          output += read.delta
        } catch {
          // 忽略
        }
        // 返回累积输出
        return output
      },
      // 判断进程是否仍存活
      alive(): boolean {
        // 进程状态为 running 时视为存活
        return proc.status === 'running'
      },
    }
  }
}

/** ctx.llm → 引擎 LLM 分析器。 */
// 导出工厂函数：把 LLM 运行时适配成引擎的分析函数（可能返回 undefined）
export function makeLlmAnalyzer(
  // LLM 运行时实例
  llm: LlmRuntime,
  // provider 名称
  provider: string,
  // 模型名称
  model: string,
  // 日志输出函数
  log: (line: string) => void,
): AnalyzeFn | undefined {
  // 缺少 provider 或 model 时无法分析
  if (!provider || !model) {
    // 记录提示日志
    log('LLM 分析不可用：未提供 provider/model。')
    // 返回 undefined 表示分析器不可用
    return undefined
  }
  // 返回异步分析函数
  return async (req, signal) => {
    // 构造消息数组：手工构造一条用户消息（零依赖；与 createUserMessage 产物同形状）
    const messages: Message[] = [{
      // 稳定身份（每次分析请求一条新消息）
      id: randomUUID(), // 随机 uuid
      // 角色：用户
      role: 'user', // 用户角色
      // 消息内容：单个文本块，内容为请求的提示词
      content: [{ type: 'text', text: req.prompt }], // 文本内容块
      // 消息来源：标记为插件来源
      source: { kind: 'plugin', plugin: 'dsh-code-checker' }, // 插件来源
    } as unknown as Message]
    // 构造生成选项
    const options: GenerateOptions = {
      // provider 名称
      provider,
      // 模型名称
      model,
      // 消息列表
      messages,
      // 仅当提供了 system 时才带上系统提示字段
      ...req.system !== undefined ? { system: req.system } : {},
      // 仅当提供了 maxTokens 时才带上最大 token 字段
      ...req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {},
      // 仅当提供了 signal 时才带上中止信号字段
      ...signal !== undefined ? { signal } : {},
    }
    // 初始化累积文本
    let text = ''
    // 流式消费 LLM 输出
    for await (const chunk of llm.stream(options)) {
      // 文本增量块：追加到累积文本
      if (chunk.type === 'text-delta') text += chunk.text
      // 结束块且原因为错误：抛出异常
      if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
        throw new Error('LLM 流以错误结束：' + chunk.reason.failure.message)
      }
    }
    // 返回累积的文本结果
    return text
  }
}

/** 解析某 agent 的 provider/model（agent options → 默认模型服务）。 */
// 导出函数：解析出实际使用的 provider 与 model
export function resolveModel(
  // agent 对象（可能未定义）
  agent: Agent | undefined,
  // 默认模型（可能未定义）
  defaultModel: { provider: string; model: string } | undefined,
  // provider 列表
  providers: { id?: string; name?: string }[],
): { provider: string; model: string } | undefined {
  // agent 显式配置了 provider 和 model 时优先使用
  if (agent?.options.provider && agent.options.model) {
    return { provider: agent.options.provider, model: agent.options.model }
  }
  // 否则若默认模型提供了 provider 和 model 则使用默认模型
  if (defaultModel?.provider && defaultModel.model) return defaultModel
  // 否则取 provider 列表第一项
  const first = providers[0]
  // 第一个 provider 存在且带 id 时，用其 id 与默认 model 组合返回
  if (first?.id) return { provider: first.id, model: defaultModel?.model ?? '' }
  // 都无法解析时返回 undefined
  return undefined
}

/** 组装完整 EngineIo。 */
// 导出工厂函数：组装引擎 IO 对象
export function makeEngineIo(
  // shell 执行器
  shell: ShellExecutor,
  // 平台标识：win32 或 posix
  platform: 'win32' | 'posix',
  // 分析函数（可能未定义）
  analyzer: AnalyzeFn | undefined,
  // 日志输出函数
  log: (line: string) => void,
  // 中止信号（可选）
  signal?: AbortSignal,
): EngineIo {
  // 返回组装好的引擎 IO 对象
  return {
    // 前台执行函数
    exec: makeShellExec(shell),
    // 后台启动函数
    start: makeShellStart(shell),
    // 平台标识
    platform,
    // 仅当提供了分析器时才带上 analyzer 字段
    ...analyzer !== undefined ? { analyzer } : {},
    // 日志函数
    log,
    // 仅当提供了 signal 时才带上中止信号字段
    ...signal !== undefined ? { signal } : {},
  }
}
