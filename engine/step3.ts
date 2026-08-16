/**
 * 文件作用：实现“真实用户模拟”（第 3 步）——依据用户描述的功能（或 README）设计并执行操作计划，
 *   模拟真实用户使用软件（键盘输入、鼠标点击/拖动等），记录卡顿、无响应、报错等异常。
 *   支持三类模拟：web（HTTP 探针 + 可选 Playwright）、cli（执行命令并核对期望输出）、
 *   desktop（Windows UIA）；模拟计划优先由 LLM 生成，失败则使用按项目类型的默认计划。
 *
 * 第 3 步：模拟真实用户使用软件（键盘输入、鼠标点击/拖动等），
 * 依据用户描述的功能（或 README）操作，记录卡顿、无响应、报错等异常。
 * @module dsh-code-checker/engine
 */

// 引入 Node 内置模块：文件系统（promise 版）、路径处理、URL 转路径、随机 UUID
import { promises as fsp } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
// 从类型定义中引入第 3 步所需的类型（仅在编译期使用）
import type {
  Anomaly, CheckOptions, EngineIo, Finding, StepResult,
} from './types.js'
import type { ProjectInfo } from './detect.js' // 引入项目信息类型
import { extractErrors } from './step1.js' // 引入错误提取工具（复用第 1 步）

/** 模拟计划中的一次交互。 */
export interface Interaction { // 单次交互动作结构
  action: 'goto' | 'click' | 'type' | 'press' | 'wait' | 'screenshot' | 'drag' // 动作类型
  target?: string // 目标（控件文字 / CSS 选择器 / URL 路径等）
  value?: string // 要输入的文本 / 按键 / 等待毫秒数
  expect?: string // 期望看到的结果
}

/** 模拟计划。 */
export interface SimPlan { // 模拟计划结构
  kind: 'web' | 'cli' | 'desktop' | 'none' // 模拟类型
  /** 启动说明（供日志展示）。 */
  startNote?: string // 可选的启动说明
  /** web 专用交互。 */
  interactions: Interaction[] // web 交互列表
  /** cli 专用命令（或交互输入）。 */
  commands: { input: string; expect?: string }[] // cli 命令列表
  /** 期望的 web 服务端口（候选）。 */
  ports?: number[] // 候选端口列表
}

const moduleDir = dirname(fileURLToPath(import.meta.url)) // 当前模块所在目录
const SIMULATORS_DIR = join(moduleDir, '..', 'simulators') // 模拟器脚本目录（上级目录的 simulators 子目录）

/** 依据 README/需求文本推导模拟计划（LLM 可用时用 LLM）。 */
async function buildPlan( // 定义模拟计划生成函数
  sourceText: string, // 来源文本（用户需求与 README）
  projectInfo: ProjectInfo, // 项目信息
  opts: CheckOptions, // 检查配置
  io: EngineIo, // IO 适配器
): Promise<SimPlan> { // 返回模拟计划
  // 尝试 LLM 生成计划
  if (io.analyzer && opts.useLlm && sourceText.trim()) { // 有分析器、允许 LLM 且有来源文本时
    try {
      const prompt = [ // 组装 LLM 提示词
        '以下是用户对该软件的功能描述（来自用户需求与 README）：', // 说明来源文本
        sourceText.slice(0, 20_000), // 来源文本（截断到 20000 字符）
        '', // 空行
        '请设计一个“真实用户操作模拟计划”，并只输出 JSON，形如：', // 任务说明
        '{"kind":"web|cli|desktop|none","interactions":[{"action":"goto|click|type|press|wait|drag","target":"控件文字或CSS选择器或URL路径","value":"要输入的文本/按键","expect":"期望看到的结果"}],"commands":[{"input":"命令行或交互输入","expect":"期望输出片段"}],"ports":[候选端口]}', // JSON 模板
        '规则：kind=web 时填 interactions 与 ports；kind=cli 时填 commands；桌面程序填 interactions（按钮/输入框文字）。不确定的字段留空字符串。最多 12 条操作。', // 规则说明
      ].join('\n') // 用换行拼接
      const raw = await io.analyzer({ system: '你是软件测试工程师，负责设计用户操作模拟。只输出 JSON。', prompt, maxTokens: 2000 }, io.signal) // 调用 LLM
      const start = raw.indexOf('{') // 找 JSON 起始
      const end = raw.lastIndexOf('}') // 找 JSON 结束
      if (start >= 0 && end > start) { // 找到有效 JSON 范围时
        const plan = JSON.parse(raw.slice(start, end + 1)) as Partial<SimPlan> // 解析 JSON
        if (typeof plan === 'object' && plan !== null && typeof plan.kind === 'string') { // 解析结果有效时
          io.log('[第3步] 使用 LLM 生成的模拟计划: kind=' + plan.kind) // 输出日志
          return { // 返回清洗后的计划
            kind: (['web', 'cli', 'desktop', 'none'] as const).includes(plan.kind as never) ? (plan.kind as SimPlan['kind']) : 'none', // 校验 kind 取值
            interactions: Array.isArray(plan.interactions) ? plan.interactions.slice(0, 12) : [], // 交互列表（最多 12 条）
            commands: Array.isArray(plan.commands) ? plan.commands.slice(0, 12) : [], // 命令列表（最多 12 条）
            ports: Array.isArray(plan.ports) ? plan.ports.map(Number).filter(p => Number.isInteger(p) && p > 0 && p < 65536).slice(0, 4) : undefined, // 端口列表（校验为合法端口，最多 4 个）
          }
        }
      }
    } catch (error) { // LLM 生成失败
      io.log('[第3步] LLM 计划生成失败，使用默认计划: ' + (error instanceof Error ? error.message : String(error))) // 输出日志
    }
  }
  // 默认计划
  switch (projectInfo.kind) { // 按项目类型选择默认计划
    case 'web-static': // 静态 Web 项目
    case 'node-web': // Node Web 项目
      return { // 返回 web 默认计划
        kind: 'web', // web 类型
        interactions: [ // 默认交互序列
          { action: 'goto', target: '/' }, // 访问首页
          { action: 'wait', value: '1200' }, // 等待 1200ms
          { action: 'click', target: 'button' }, // 点击按钮
          { action: 'type', target: 'input', value: '测试输入' }, // 输入测试文本
          { action: 'press', target: 'Enter' }, // 回车
          { action: 'wait', value: '1000' }, // 等待 1000ms
          { action: 'screenshot' }, // 截图
        ],
        commands: [], // web 无命令行
        ports: [5173, 3000, 8080, 4173, 5000, 8000], // 候选端口
      }
    case 'electron': // Electron 应用
    case 'desktop-exe': // Windows 桌面程序
      return { // 返回桌面默认计划
        kind: 'desktop', // 桌面类型
        interactions: [ // 默认交互序列
          { action: 'wait', value: '2000' }, // 等待 2000ms
          { action: 'click', target: 'firstButton' }, // 点击第一个按钮
          { action: 'type', target: 'firstEdit', value: '测试输入' }, // 输入测试文本
          { action: 'press', target: 'Enter' }, // 回车
          { action: 'wait', value: '1000' }, // 等待 1000ms
          { action: 'screenshot' }, // 截图
        ],
        commands: [], // 桌面无命令行
      }
    default: // 其他类型按 CLI 处理
      return { // 返回 cli 默认计划
        kind: 'cli', // cli 类型
        interactions: [], // cli 无交互
        commands: [ // 默认命令
          { input: '--help', expect: '' }, // 查看帮助
          { input: '--version', expect: '' }, // 查看版本
        ],
      }
  }
}

/** HTTP 探针：检测 web 服务是否存活/卡顿。 */
async function httpProbe(url: string, io: EngineIo): Promise<{ ok: boolean; status?: number; durationMs: number; error?: string }> { // 定义 HTTP 探针函数
  const started = Date.now() // 记录开始时间
  const controller = new AbortController() // 创建用于超时中止的控制器
  const timer = setTimeout(() => controller.abort(), 6000) // 6 秒后触发中止
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' }) // 发起请求（跟随重定向）
    const durationMs = Date.now() - started // 计算耗时
    return { ok: res.status >= 200 && res.status < 500, status: res.status, durationMs } // 状态码 2xx~4xx 视为存活
  } catch (error) { // 请求异常
    return { ok: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) } // 返回失败与错误信息
  } finally {
    clearTimeout(timer) // 清理超时定时器
  }
}

/** 执行 web 模拟。 */
async function simulateWeb( // 定义 web 模拟函数
  plan: SimPlan, // 模拟计划
  projectInfo: ProjectInfo, // 项目信息
  opts: CheckOptions, // 检查配置
  io: EngineIo, // IO 适配器
  artifacts: string, // 产物目录
): Promise<{ anomalies: Anomaly[]; detail: string[]; artifacts: string[]; ran: boolean }> { // 返回模拟结果
  const anomalies: Anomaly[] = [] // 累积异常
  const detail: string[] = [] // 累积详细说明
  const produced: string[] = [] // 累积截图等产物
  const ports = plan.ports ?? [5173, 3000, 8080, 4173] // 候选端口（无则用默认）
  const startCommand = projectInfo.runCommands[0] // 取首个启动命令
  let server: Awaited<ReturnType<NonNullable<EngineIo['start']>>> | undefined // 保存启动的服务器句柄

  let baseUrl: string | undefined // 探测到的服务地址
  // 1) 尝试直接探测已运行的服务
  for (const port of ports) { // 逐个候选端口探测
    const probe = await httpProbe('http://127.0.0.1:' + String(port) + '/', io) // 探测该端口
    if (probe.ok) { // 已有服务在运行
      baseUrl = 'http://127.0.0.1:' + String(port) // 记录服务地址
      detail.push('检测到 web 服务已在端口 ' + String(port) + ' 运行。') // 记录说明
      break // 停止探测
    }
  }
  // 2) 否则自行启动 dev server
  if (!baseUrl && startCommand && io.start) { // 未探测到服务且可启动时
    io.log('[第3步] 启动开发服务器: ' + startCommand) // 输出日志
    try {
      server = await io.start({ command: startCommand, cwd: opts.projectDir }) // 启动开发服务器
      for (const port of ports) { // 逐个候选端口等待
        const deadline = Date.now() + 60_000 // 60 秒截止时间
        while (Date.now() < deadline) { // 在截止时间前轮询
          const probe = await httpProbe('http://127.0.0.1:' + String(port) + '/', io) // 探测该端口
          if (probe.ok) { // 探测成功
            baseUrl = 'http://127.0.0.1:' + String(port) // 记录服务地址
            break // 跳出轮询
          }
          await new Promise(resolve => setTimeout(resolve, 700)) // 等待 700ms 后重试
        }
        if (baseUrl) break // 已就绪则停止端口循环
      }
      if (baseUrl) { // 成功启动时
        detail.push('开发服务器已在端口 ' + String((baseUrl.split(':')[2] ?? '').split('/')[0] ?? '') + ' 启动。') // 记录端口
      } else { // 未就绪时
        const out = server.output().slice(-1200) // 取服务器输出尾部
        anomalies.push({ // 记录异常
          kind: 'error', // 错误级
          where: '启动开发服务器', // 位置
          message: '启动命令执行后 60 秒内未能在候选端口上探测到服务', // 消息
          evidence: out, // 输出作为证据
        })
        detail.push('启动开发服务器失败：未探测到服务端口。输出：\n' + out) // 记录说明
      }
    } catch (error) { // 启动异常
      anomalies.push({ kind: 'error', where: '启动开发服务器', message: '启动失败: ' + (error instanceof Error ? error.message : String(error)) }) // 记录异常
    }
  }

  // 2.5) 静态站点：自行启动内置静态服务器
  if (!baseUrl && projectInfo.kind === 'web-static' && io.start) { // 静态站点且可启动时
    const staticServer = join(SIMULATORS_DIR, 'static-server.mjs') // 内置静态服务器脚本路径
    try {
      server = await io.start({ // 启动内置静态服务器
        command: '"' + process.execPath.replace(/"/g, '') + '" "' + staticServer.replace(/"/g, '') + '" "' + opts.projectDir.replace(/"/g, '') + '" 4173', // node 执行静态服务器，端口 4173
        cwd: opts.projectDir, // 工作目录
      })
      for (let i = 0; i < 20; i++) { // 最多重试 20 次
        const probe = await httpProbe('http://127.0.0.1:4173/', io) // 探测 4173 端口
        if (probe.ok) { // 就绪
          baseUrl = 'http://127.0.0.1:4173' // 记录服务地址
          detail.push('静态站点已由内置服务器托管在 4173 端口。') // 记录说明
          break // 停止重试
        }
        await new Promise(resolve => setTimeout(resolve, 500)) // 等待 500ms 后重试
      }
      if (!baseUrl) { // 未就绪时
        detail.push('内置静态服务器未能就绪。输出：\n' + server.output().slice(-800)) // 记录说明与输出尾部
      }
    } catch (error) { // 启动异常
      detail.push('内置静态服务器启动失败: ' + (error instanceof Error ? error.message : String(error))) // 记录说明
    }
  }

  // 3) 浏览器自动化（Playwright，可选）
  let playwrightUsed = false // 是否真正使用了 Playwright
  if (baseUrl) { // 有服务地址时才做浏览器自动化
    const script = join(SIMULATORS_DIR, 'web-playwright.mjs') // Playwright 脚本路径
    const planFile = join(artifacts, 'web-plan.json') // 计划文件路径
    await fsp.writeFile(planFile, JSON.stringify({ baseUrl, interactions: plan.interactions, artifacts }, null, 2), 'utf8') // 把计划写入文件
    const node = process.execPath // Node 可执行文件路径
    const command = '"' + node.replace(/"/g, '') + '" "' + script.replace(/"/g, '') + '" "' + planFile.replace(/"/g, '') + '"' // 组装执行命令
    const res = await io.exec({ command, cwd: opts.projectDir, timeoutMs: 150_000 }) // 执行 Playwright 脚本
    if (res.exitCode === 0) { // 脚本执行成功
      const lines = (res.stdout || '').trim().split(/\r?\n/) // 按行拆分输出
      const jsonLine = lines.find(l => l.startsWith('RESULT:'))?.slice('RESULT:'.length) // 找以 RESULT: 开头的行并去掉前缀
      if (jsonLine) { // 找到结果行
        try {
          const result = JSON.parse(jsonLine) as { // 解析结果 JSON
            ok: boolean; playwright?: boolean; note?: string; actions: { action: string; target?: string; ok: boolean; durationMs: number; error?: string }[]; // 基础字段与操作列表
            consoleErrors: string[]; pageErrors: string[]; requestFailed: string[]; screenshots: string[]; // 错误与截图字段
          }
          if (result.playwright) { // Playwright 可用
            playwrightUsed = true // 标记使用了 Playwright
            for (const action of result.actions) { // 逐个操作检查
              if (!action.ok) { // 操作失败
                anomalies.push({ // 记录异常
                  kind: 'unresponsive', // 无响应级
                  where: '浏览器操作: ' + action.action + (action.target ? ' (' + action.target + ')' : ''), // 位置
                  message: action.error ?? '操作未成功', // 消息
                  durationMs: action.durationMs, // 耗时
                })
              }
            }
            for (const err of result.consoleErrors.slice(0, 10)) { // 控制台错误（最多 10 条）
              anomalies.push({ kind: 'error', where: '浏览器控制台', message: err.slice(0, 300) }) // 记录异常
            }
            for (const err of result.pageErrors.slice(0, 10)) { // 页面错误（最多 10 条）
              anomalies.push({ kind: 'error', where: '页面运行时报错', message: err.slice(0, 300) }) // 记录异常
            }
            for (const err of result.requestFailed.slice(0, 10)) { // 请求失败（最多 10 条）
              anomalies.push({ kind: 'error', where: '网络请求失败', message: err.slice(0, 300) }) // 记录异常
            }
            for (const shot of result.screenshots) produced.push(shot) // 收集截图产物
            detail.push('浏览器自动化完成：' + String(result.actions.length) + ' 个操作，控制台错误 ' + String(result.consoleErrors.length) + ' 条，页面错误 ' + String(result.pageErrors.length) + ' 条。') // 汇总
          } else { // Playwright 未安装
            detail.push('Playwright 未安装（' + (result.note ?? '') + '），已回退到 HTTP 探针。') // 记录回退说明
          }
        } catch (error) { // 解析失败
          detail.push('无法解析浏览器自动化结果: ' + (error instanceof Error ? error.message : String(error))) // 记录说明
        }
      } else { // 无结果行
        detail.push('浏览器自动化脚本输出异常，已回退到 HTTP 探针。') // 记录说明
      }
    } else { // 脚本执行失败
      detail.push('浏览器自动化脚本失败（退出码 ' + String(res.exitCode) + '），已回退到 HTTP 探针。') // 记录说明
    }

    // 4) HTTP 卡顿探针（无论 Playwright 是否可用都做）
    const probe = await httpProbe(baseUrl + '/', io) // 再次探测首页
    if (probe.durationMs > 3000) { // 响应超过 3 秒
      anomalies.push({ kind: 'freeze', where: '首页 HTTP 响应', message: '响应耗时 ' + String(probe.durationMs) + 'ms，疑似卡顿', durationMs: probe.durationMs }) // 记录卡顿异常
    }
    if (probe.status && probe.status >= 500) { // 状态码 5xx
      anomalies.push({ kind: 'error', where: '首页 HTTP 响应', message: 'HTTP 状态码 ' + String(probe.status) }) // 记录错误
    }
    if (!probe.ok) { // 探测失败
      anomalies.push({ kind: 'error', where: '首页 HTTP 响应', message: '探测失败: ' + (probe.error ?? '未知错误') }) // 记录错误
    }
  } else if (!startCommand && !io.start) { // 无启动命令且无后台执行能力
    detail.push('无启动命令且无后台执行能力，仅做端口探测。') // 记录说明
    for (const port of ports) { // 逐个候选端口探测
      const probe = await httpProbe('http://127.0.0.1:' + String(port) + '/', io) // 探测端口
      if (probe.ok) { // 端口上有服务
        detail.push('端口 ' + String(port) + ' 上有服务在运行（可能非本项目的服务，仅供参考）。') // 记录说明
        break // 停止探测
      }
    }
  }

  if (server) { // 若启动了服务器
    try { await server.stop() } catch { /* 忽略停止失败 */ } // 停止服务器（忽略失败）
  }
  return { anomalies, detail, artifacts: produced, ran: playwrightUsed || baseUrl !== undefined } // 返回模拟结果
}

/** 执行 CLI 模拟。 */
async function simulateCli( // 定义 CLI 模拟函数
  plan: SimPlan, // 模拟计划
  projectInfo: ProjectInfo, // 项目信息
  opts: CheckOptions, // 检查配置
  io: EngineIo, // IO 适配器
): Promise<{ anomalies: Anomaly[]; detail: string[]; artifacts: string[]; ran: boolean }> { // 返回模拟结果
  const anomalies: Anomaly[] = [] // 累积异常
  const detail: string[] = [] // 累积详细说明
  const commands = plan.commands.length > 0 // 优先使用计划中的命令
    ? plan.commands // 计划命令
    : (projectInfo.runCommands.length > 0 ? projectInfo.runCommands.map(() => ({ input: '', expect: '' })) : []) // 无计划命令则按运行命令生成空探针
  if (commands.length === 0) { // 无命令可模拟时
    detail.push('没有可模拟的 CLI 命令，跳过。') // 记录说明
    return { anomalies, detail, artifacts: [], ran: false } // 返回未运行
  }
  let ran = false // 是否实际运行过命令
  for (const entry of commands.slice(0, 8)) { // 最多模拟 8 条命令
    const input = entry.input.trim() // 去首尾空白的输入
    let command: string // 声明最终命令
    if (input === '' || input.startsWith('-') || input.startsWith('/')) { // 空输入或参数形式时
      // 探针参数：挂到首个运行命令后
      const base = projectInfo.runCommands[0] // 取首个运行命令
      if (!base) continue // 无运行命令则跳过
      command = input === '' ? base : base + ' ' + input // 空输入直接用运行命令，否则拼接参数
    } else { // 完整命令时
      command = input // 直接用输入作为命令
    }
    io.log('[第3步] CLI 操作: ' + command) // 输出日志
    const started = Date.now() // 记录开始时间
    const res = await io.exec({ command, cwd: opts.projectDir, timeoutMs: Math.min(opts.runProbeMs * 3, 30_000) }) // 执行命令（超时取运行探针 3 倍与 30 秒的较小值）
    ran = true // 标记已运行
    const durationMs = Date.now() - started // 计算耗时
    if (res.timedOut) { // 命令超时
      anomalies.push({ kind: 'unresponsive', where: 'CLI: ' + command, message: '命令 ' + String(durationMs) + 'ms 无响应（超时被杀），疑似卡死', durationMs }) // 记录无响应异常
      detail.push('CLI 命令无响应: ' + command) // 记录说明
      continue // 继续下一条
    }
    if (res.exitCode !== 0 && res.exitCode !== null) { // 非零退出码
      const errorLines = extractErrors(res.stdout, res.stderr, 2) // 提取错误行
      anomalies.push({ // 记录错误异常
        kind: 'error', // 错误级
        where: 'CLI: ' + command, // 位置
        message: '退出码 ' + String(res.exitCode) + (errorLines.length > 0 ? '：' + errorLines.join(' | ') : ''), // 消息
        evidence: (res.stderr || res.stdout).slice(0, 800), // 证据
      })
      detail.push('CLI 命令报错: ' + command) // 记录说明
      continue // 继续下一条
    }
    const expect = entry.expect?.trim() // 期望输出片段
    if (expect) { // 有期望输出时
      const combined = res.stdout + '\n' + res.stderr // 合并标准输出与错误输出
      if (!combined.includes(expect)) { // 期望片段未出现
        anomalies.push({ kind: 'warning', where: 'CLI: ' + command, message: '期望输出未出现（期望包含: ' + expect + '）' }) // 记录警告
        detail.push('CLI 输出与预期不符: ' + command) // 记录说明
      } else { // 期望片段出现
        detail.push('CLI 操作符合预期: ' + command) // 记录说明
      }
    } else { // 无期望输出
      detail.push('CLI 操作完成（退出码 0）: ' + command) // 记录说明
    }
  }
  return { anomalies, detail, artifacts: [], ran } // 返回模拟结果
}

/** 执行桌面程序模拟（Windows UIA）。 */
async function simulateDesktop( // 定义桌面模拟函数
  plan: SimPlan, // 模拟计划
  projectInfo: ProjectInfo, // 项目信息
  opts: CheckOptions, // 检查配置
  io: EngineIo, // IO 适配器
  artifacts: string, // 产物目录
): Promise<{ anomalies: Anomaly[]; detail: string[]; artifacts: string[]; ran: boolean }> { // 返回模拟结果
  const anomalies: Anomaly[] = [] // 累积异常
  const detail: string[] = [] // 累积详细说明
  const produced: string[] = [] // 累积截图产物
  if (io.platform !== 'win32') { // 非 Windows 平台
    detail.push('桌面程序模拟当前仅支持 Windows（UIA），本平台跳过。') // 记录说明
    return { anomalies, detail, artifacts: [], ran: false } // 返回未运行
  }
  const exe = projectInfo.entryCandidates.find(e => /\.exe$/i.test(e)) ?? projectInfo.runCommands[0] // 找 exe 入口（否则用运行命令）
  if (!exe) { // 无 exe
    detail.push('未找到可启动的 exe，跳过桌面模拟。') // 记录说明
    return { anomalies, detail, artifacts: [], ran: false } // 返回未运行
  }
  const script = join(SIMULATORS_DIR, 'windows-uia.ps1') // UIA 脚本路径
  const planFile = join(artifacts, 'desktop-plan.json') // 计划文件路径
  await fsp.writeFile(planFile, JSON.stringify({ exe, workDir: opts.projectDir, artifacts, probeMs: Math.min(opts.runProbeMs * 2, 20_000), interactions: plan.interactions }, null, 2), 'utf8') // 写入计划文件
  const command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + script.replace(/"/g, '') + '" -PlanFile "' + planFile.replace(/"/g, '') + '"' // 组装 PowerShell 命令
  io.log('[第3步] 桌面模拟: ' + command) // 输出日志
  const res = await io.exec({ command, cwd: opts.projectDir, timeoutMs: 90_000 }) // 执行 UIA 脚本
  if (res.exitCode !== 0) { // 脚本执行失败
    detail.push('桌面模拟脚本失败（退出码 ' + String(res.exitCode) + '）：' + (res.stderr || res.stdout).slice(0, 800)) // 记录说明
    return { anomalies, detail, artifacts: [], ran: false } // 返回未运行
  }
  const line = (res.stdout || '').trim().split(/\r?\n/).find(l => l.startsWith('RESULT:')) // 找以 RESULT: 开头的行
  if (!line) { // 无结果行
    detail.push('桌面模拟脚本未输出结果，视为未运行。') // 记录说明
    return { anomalies, detail, artifacts: [], ran: false } // 返回未运行
  }
  try {
    const result = JSON.parse(line.slice('RESULT:'.length)) as { // 解析结果 JSON
      windowFound: boolean; hangDetected: boolean; crashed: boolean; crashInfo?: string; // 窗口/挂起/崩溃字段
      controls: number; actions: { action: string; target?: string; ok: boolean; error?: string }[]; // 控件数与操作列表
      screenshots: string[]; note?: string; // 截图与备注
    }
    if (!result.windowFound) { // 未找到主窗口
      detail.push('未检测到程序主窗口（' + (result.note ?? '') + '）。') // 记录说明
      anomalies.push({ kind: 'warning', where: '主窗口', message: '启动后未检测到主窗口' }) // 记录警告
      return { anomalies, detail, artifacts: produced, ran: true } // 返回已运行
    }
    if (result.hangDetected) { // 检测到窗口无响应
      anomalies.push({ kind: 'freeze', where: '程序窗口', message: '窗口无响应（IsHungAppWindow 判定）' }) // 记录冻结异常
    }
    if (result.crashed) { // 检测到崩溃
      anomalies.push({ kind: 'crash', where: '程序进程', message: '程序在模拟过程中崩溃/退出' + (result.crashInfo ? '：' + result.crashInfo : '') }) // 记录崩溃异常
    }
    for (const action of result.actions) { // 逐个操作检查
      if (!action.ok) { // 操作失败
        anomalies.push({ kind: 'unresponsive', where: '桌面操作: ' + action.action + (action.target ? ' (' + action.target + ')' : ''), message: action.error ?? '操作未成功' }) // 记录无响应异常
      }
    }
    produced.push(...result.screenshots) // 收集截图产物
    detail.push('桌面模拟完成：窗口正常，控件数 ' + String(result.controls) + '，操作 ' + String(result.actions.length) + ' 次，截图 ' + String(result.screenshots.length) + ' 张。') // 汇总
  } catch (error) { // 解析失败
    detail.push('桌面模拟结果解析失败: ' + (error instanceof Error ? error.message : String(error))) // 记录说明
  }
  return { anomalies, detail, artifacts: produced, ran: true } // 返回模拟结果
}

/** 执行第 3 步。 */
export async function runStep3( // 定义第 3 步主函数
  sourceText: string, // 来源文本（用户需求与 README）
  projectInfo: ProjectInfo, // 项目信息
  opts: CheckOptions, // 检查配置
  io: EngineIo, // IO 适配器
): Promise<StepResult> { // 返回步骤结果
  const started = Date.now() // 记录开始时间
  const detail: string[] = [] // 累积详细说明
  const findings: Finding[] = [] // 累积问题
  const anomalies: Anomaly[] = [] // 累积异常
  const produced: string[] = [] // 累积截图产物

  if (!opts.simulate) { // 模拟被配置关闭时
    return { step: 3, title: '真实用户模拟', status: 'skipped', detail: ['模拟已通过配置关闭。'], findings, anomalies, artifacts: [], durationMs: Date.now() - started } // 返回跳过结果
  }

  const artifacts = opts.artifactDir ?? join(process.env.TEMP ?? '/tmp', 'dsh-code-checker', randomUUID()) // 产物目录（优先配置，否则临时目录 + 随机 UUID）
  await fsp.mkdir(artifacts, { recursive: true }).catch(() => {}) // 递归创建产物目录（忽略失败）

  const plan = await buildPlan(sourceText, projectInfo, opts, io) // 推导模拟计划
  detail.push('模拟类型: ' + plan.kind + (plan.startNote ? '；启动说明: ' + plan.startNote : '')) // 记录模拟类型

  let result: { anomalies: Anomaly[]; detail: string[]; artifacts: string[]; ran: boolean } // 声明模拟结果
  switch (plan.kind) { // 按计划类型分派
    case 'web': // web 模拟
      result = await simulateWeb(plan, projectInfo, opts, io, artifacts) // 执行 web 模拟
      break // 跳出 switch
    case 'cli': // cli 模拟
      result = await simulateCli(plan, projectInfo, opts, io) // 执行 cli 模拟
      break // 跳出 switch
    case 'desktop': // 桌面模拟
      result = await simulateDesktop(plan, projectInfo, opts, io, artifacts) // 执行桌面模拟
      break // 跳出 switch
    default: // 无法确定模拟方式
      result = { anomalies: [], detail: ['无法确定模拟方式，跳过用户模拟。'], artifacts: [], ran: false } // 返回未运行
  }
  anomalies.push(...result.anomalies) // 合并异常
  detail.push(...result.detail) // 合并说明
  produced.push(...result.artifacts) // 合并产物
  for (const anomaly of anomalies) { // 把异常转成问题
    const level = anomaly.kind === 'warning' ? 'warning' : 'error' // warning 级异常对应 warning，其余为 error
    findings.push({ level, where: anomaly.where, message: anomaly.message, evidence: anomaly.evidence }) // 记录问题
  }

  const status = !result.ran // 未运行时
    ? 'skipped' // 跳过
    : (anomalies.some(a => a.kind !== 'warning') ? 'failed' : (anomalies.length > 0 ? 'partial' : 'passed')) // 有非警告异常 failed，仅警告 partial，无异常 passed
  if (status === 'passed') detail.push('未发现卡顿、无响应、报错等异常。') // 通过时记录说明
  return { step: 3, title: '真实用户模拟', status, detail, findings, anomalies, artifacts: produced, durationMs: Date.now() - started } // 返回步骤结果
}