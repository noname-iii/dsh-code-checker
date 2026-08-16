#!/usr/bin/env node
/**
 * 文件作用：独立 CLI 入口 —— check / detect / mcp 三个子命令与参数解析。
 * dsh-code-checker 独立 CLI —— 供 Trae / Qoder / Cursor 等任何 AI 编码工具使用。
 *
 * 用法：
 *   dsh-code-checker check <项目目录> [选项]
 *   dsh-code-checker detect <项目目录>
 *   dsh-code-checker mcp
 *
 * check 命令选项：
 *   --requirements <文件>      用户需求文件（每行一条，或整体文本）
 *   --readme <文件>            显式指定 README
 *   --no-install               不安装依赖
 *   --no-simulate              跳过第 3 步用户模拟
 *   --no-llm                   关闭 LLM 深度分析（纯启发式）
 *   --build-timeout <毫秒>     构建超时（默认 180000）
 *   --probe <毫秒>             运行探针时长（默认 8000）
 *   --artifacts <目录>         模拟产物目录
 *   --language zh|en           报告语言
 *   --json                     输出 JSON 报告
 *   --llm-base-url <url>       OpenAI 兼容接口地址（用于第 2/3 步深度分析）
 *   --llm-api-key <key|env:名> API Key（或 env: 前缀引用环境变量）
 *   --llm-model <model>        模型名
 *
 * 退出码：0 = 没有问题；1 = 发现问题；2 = 用法错误。
 * @module dsh-code-checker/cli
 */

import { existsSync } from 'node:fs'  // 从 Node 内置 fs 模块导入 existsSync：同步判断文件/目录是否存在
import { readFile } from 'node:fs/promises'  // 从 fs/promises 导入 readFile：异步读取文件内容
import { resolve } from 'node:path'  // 从 path 模块导入 resolve：把相对路径解析为绝对路径
import { runCheck } from '../engine/index.js'  // 导入引擎核心的检查函数 runCheck
import type { CheckOptions } from '../engine/types.js'  // 导入引擎类型 CheckOptions（仅类型，编译后不产生运行时代码）
import { makeExec, makeStart } from './exec.js'  // 导入进程适配器工厂：makeExec（前台执行）、makeStart（后台启动）
import { makeOpenAiAnalyzer } from './llm.js'  // 导入 OpenAI 兼容接口的 LLM 分析器工厂函数
import { runMcpServer } from './mcp.js'  // 导入 MCP 服务器启动函数
import { readPackageVersion } from './version.js'  // 导入版本号读取函数（唯一事实来源是 package.json）

const VERSION = readPackageVersion()  // 从 package.json 读取版本号（发布包与源码开发两种层级都兼容）

function usage(exitCode = 0): never {  // 打印用法说明并退出进程；返回类型 never 表示该函数永不正常返回
  // 向标准错误输出用法文本
  console.error(`dsh-code-checker v${VERSION} —— 代码全面检查（编译运行 / 功能完整性 / 用户模拟）

用法:
  dsh-code-checker check <项目目录> [选项]
  dsh-code-checker detect <项目目录>
  dsh-code-checker mcp`)
  process.exit(exitCode)  // 以指定退出码结束进程
}

interface CliArgs {  // 定义 CLI 命令行参数结构体
  projectDir: string  // 待检查的项目目录
  requirements?: string  // 需求文件路径（可选）
  readme?: string  // README 文件路径（可选）
  installDeps: boolean  // 是否安装依赖
  simulate: boolean  // 是否执行用户模拟
  useLlm: boolean  // 是否启用 LLM 深度分析
  buildTimeoutMs: number  // 构建超时毫秒数
  runProbeMs: number  // 运行探针毫秒数
  artifacts?: string  // 模拟产物目录（可选）
  language: 'zh' | 'en'  // 报告语言：中文或英文
  json: boolean  // 是否输出 JSON 报告
  llmBaseUrl?: string  // LLM 接口地址（可选）
  llmApiKey?: string  // LLM API Key（可选）
  llmModel?: string  // LLM 模型名（可选）
}

function parseArgs(argv: string[]): CliArgs {  // 解析命令行参数，返回填充好的 CliArgs
  const args: CliArgs = {  // 初始化默认参数对象
    projectDir: '',  // 项目目录默认为空字符串
    installDeps: true,  // 默认安装依赖
    simulate: true,  // 默认执行用户模拟
    useLlm: true,  // 默认启用 LLM
    buildTimeoutMs: 180_000,  // 构建超时默认 180 秒
    runProbeMs: 8_000,  // 运行探针默认 8 秒
    language: 'zh',  // 报告语言默认中文
    json: false,  // 默认不输出 JSON
  }
  for (let i = 0; i < argv.length; i++) {  // 遍历所有命令行参数
    const arg = argv[i] ?? ''  // 取出当前参数（为空时用空字符串兜底）
    const next = (): string => {  // next：把索引前移一位并返回下一个参数值，用于读取选项后面的值
      i += 1  // 索引前进一位
      return argv[i] ?? ''  // 返回下一个参数，越界时返回空字符串
    }
    switch (arg) {  // 根据当前参数匹配各个选项
      case '--requirements': args.requirements = next(); break  // 指定需求文件路径
      case '--readme': args.readme = next(); break  // 指定 README 路径
      case '--no-install': args.installDeps = false; break  // 关闭依赖安装
      case '--no-simulate': args.simulate = false; break  // 关闭用户模拟
      case '--no-llm': args.useLlm = false; break  // 关闭 LLM 深度分析
      case '--build-timeout': args.buildTimeoutMs = Number(next()) || args.buildTimeoutMs; break  // 设置构建超时（非法值则保留默认）
      case '--probe': args.runProbeMs = Number(next()) || args.runProbeMs; break  // 设置探针时长（非法值则保留默认）
      case '--artifacts': args.artifacts = next(); break  // 指定模拟产物目录
      case '--language': {  // 指定报告语言
        const lang = next()  // 读取语言值
        args.language = lang === 'en' ? 'en' : 'zh'  // 仅 'en' 生效，其余一律按中文处理
        break  // 结束本分支
      }
      case '--json': args.json = true; break  // 开启 JSON 输出
      case '--llm-base-url': args.llmBaseUrl = next(); break  // 指定 LLM 接口地址
      case '--llm-api-key': args.llmApiKey = next(); break  // 指定 LLM API Key
      case '--llm-model': args.llmModel = next(); break  // 指定 LLM 模型名
      default: {  // 未匹配到任何选项时的默认分支
        if (arg.startsWith('-')) {  // 若仍以 '-' 开头则是未知选项
          console.error('未知选项: ' + arg)  // 输出未知选项提示
          usage(2)  // 以用法错误码退出
        }
        args.projectDir = arg  // 否则视为项目目录位置参数
      }
    }
  }
  return args  // 返回解析结果
}

async function loadTextFile(path: string): Promise<string> {  // 读取文本文件并返回其 UTF-8 内容
  return await readFile(path, 'utf8')  // 以 UTF-8 编码读取文件内容
}

async function main(): Promise<void> {  // CLI 主函数
  const argv = process.argv.slice(2)  // 去掉 node 与脚本路径，得到真正的参数列表
  const command = argv[0] ?? ''  // 第一个参数作为命令名
  if (command === '') {  // 未提供任何参数时
    // 无参数调用：打印用法，视为正常（运行探针会以“程序可运行”判定）
    usage(0)  // 以退出码 0 打印用法
  }
  if (command === '--version' || command === '-V') {  // 请求查看版本号
    console.log(VERSION)  // 打印版本号
    return  // 结束主函数
  }
  if (command === 'mcp') {  // 请求启动 MCP 服务器
    await runMcpServer()  // 运行 MCP 服务器（阻塞至 stdin 关闭）
    return  // 结束主函数
  }
  if (command === 'detect') {  // 请求识别项目类型
    const dir = resolve(argv[1] ?? '.')  // 解析目标目录（缺省当前目录）
    if (!existsSync(dir)) {  // 目录不存在时
      console.error('目录不存在: ' + dir)  // 输出错误提示
      process.exit(2)  // 以用法错误码退出
    }
    const { detectProject } = await import('../engine/detect.js')  // 动态导入项目识别函数
    const io = { exec: makeExec(process.platform === 'win32' ? 'win32' : 'posix'), platform: process.platform === 'win32' ? 'win32' as const : 'posix' as const, log: (line: string): void => console.error('[detect] ' + line) }  // 构造 IO：执行器、平台与日志函数
    const info = await detectProject(dir, io)  // 执行项目识别
    console.log(JSON.stringify(info, null, 2))  // 以缩进 JSON 输出识别结果
    return  // 结束主函数
  }
  if (command !== 'check') usage(2)  // 命令不是 check 时按用法错误退出

  const args = parseArgs(argv.slice(1))  // 解析 check 命令后面的选项
  if (!args.projectDir) usage(2)  // 未指定项目目录时按用法错误退出
  const projectDir = resolve(args.projectDir)  // 解析项目目录为绝对路径
  if (!existsSync(projectDir)) {  // 项目目录不存在时
    console.error('目录不存在: ' + projectDir)  // 输出错误提示
    process.exit(2)  // 以用法错误码退出
  }

  let requirements: string[] = []  // 需求列表，初始为空数组
  if (args.requirements) {  // 显式指定了需求文件时
    requirements = (await loadTextFile(args.requirements)).split(/\r?\n/).map(l => l.trim()).filter(Boolean)  // 读取并按行拆分、去空白、过滤空行
  } else {  // 未指定需求文件时
    // 未指定需求文件时，自动加载项目内常见需求文档
    for (const name of ['需求.txt', '需求.md', 'requirements.txt', 'REQUIREMENTS.md', 'requirements.md']) {  // 依次尝试常见需求文件名
      const candidate = resolve(projectDir, name)  // 拼接出候选文件绝对路径
      if (existsSync(candidate)) {  // 找到存在的候选文件时
        requirements = (await loadTextFile(candidate)).split(/\r?\n/).map(l => l.trim()).filter(Boolean)  // 读取并按行拆分、去空白、过滤空行
        break  // 找到后立即停止
      }
    }
  }
  const readme = args.readme ? await loadTextFile(args.readme) : undefined  // 指定 README 时读取内容，否则置为 undefined

  const platform: 'win32' | 'posix' = process.platform === 'win32' ? 'win32' : 'posix'  // 根据运行平台判定为 win32 或 posix
  let analyzer  // 声明 LLM 分析器变量（可能为 undefined）
  if (args.useLlm && args.llmBaseUrl && args.llmModel) {  // 启用 LLM 且接口地址与模型齐全时
    let apiKey = args.llmApiKey ?? ''  // 取 API Key，缺省空字符串
    if (apiKey.startsWith('env:')) apiKey = process.env[apiKey.slice(4)] ?? ''  // 以 env: 前缀时改为读取对应环境变量
    analyzer = makeOpenAiAnalyzer({ baseUrl: args.llmBaseUrl, apiKey, model: args.llmModel })  // 构造 LLM 分析器
  }

  const options: CheckOptions = {  // 组装引擎检查选项
    projectDir,  // 项目目录
    requirements,  // 需求列表
    requirementText: requirements.join('\n'),  // 需求合并文本
    ...readme !== undefined ? { readme } : {},  // 仅在提供了 README 时携带 readme 字段
    installDeps: args.installDeps,  // 是否安装依赖
    buildTimeoutMs: args.buildTimeoutMs,  // 构建超时
    runProbeMs: args.runProbeMs,  // 运行探针时长
    simulate: args.simulate,  // 是否用户模拟
    runAllSteps: false,  // 不强制运行全部步骤
    useLlm: args.useLlm && analyzer !== undefined,  // 仅当启用且分析器存在时才使用 LLM
    maxSampleFiles: 400,  // 最大采样文件数
    maxSampleBytes: 250_000,  // 最大采样字节数
    language: args.language,  // 报告语言
    ...args.artifacts !== undefined ? { artifactDir: resolve(args.artifacts) } : {},  // 仅在指定产物目录时携带该字段
    cleanMessage: '没有问题',  // 无问题时的提示文案
  }
  const io = {  // 组装引擎 IO 适配器
    exec: makeExec(platform),  // 前台执行适配器
    start: makeStart(platform),  // 后台启动适配器
    platform,  // 平台标识
    ...analyzer !== undefined ? { analyzer } : {},  // 仅在分析器存在时携带 analyzer 字段
    log: (line: string): void => console.error('[check] ' + line),  // 日志函数：输出到标准错误
  }
  const report = await runCheck(options, io)  // 执行完整检查并得到报告
  if (args.json) {  // 请求 JSON 输出时
    console.log(JSON.stringify(report, null, 2))  // 以缩进 JSON 输出报告
  } else {  // 否则
    console.log(report.rendered)  // 输出渲染后的文本报告
  }
  process.exit(report.ok ? 0 : 1)  // 根据报告结果设置退出码：无问题 0，有问题 1
}

void main().catch((error) => {  // 调用主函数并捕获异常（void 忽略返回的 Promise）
  console.error('执行失败: ' + (error instanceof Error ? error.stack ?? error.message : String(error)))  // 输出执行失败信息
  process.exit(2)  // 以用法错误码退出
})
