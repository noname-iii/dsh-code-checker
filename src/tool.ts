/**
 * 文件作用：注册 check_project 模型工具 —— AI 可主动请求检查项目并把报告作为工具结果返回。
 *
 * 说明（重要）：本文件【不】依赖 @deepseek-ai/dsh-tools。
 * 插件束通过 `dsh plugin add <目录>`（pnpm link）安装时，被链接目录可能没有
 * node_modules，运行时 import 外部包会解析失败导致插件整行加载失败。
 * ctx.tools.register() 接受一个普通 ToolDefinition 对象（原始 JSON Schema 参数 +
 * output 渲染 + execute），因此这里手工构造定义即可，零外部依赖。
 * @module dsh-code-checker
 */

// 引入 Context 类型：Cordis 插件上下文
import type { Context } from '@deepseek-ai/cordis'

/** 依赖注入接口。 */
// 导出接口：工具所需的依赖
export interface ToolDeps {
  /** 对指定 agent 执行检查（返回渲染文本）。 */
  // 对指定 agent 执行检查并返回渲染文本
  runCheckReturnText(
    agent: import('@deepseek-ai/dsh-agent').Agent | undefined,
    reason: 'auto' | 'command' | 'tool',
    options: { projectDir?: string; extraRequirements?: string; simulate?: boolean },
  ): Promise<string>
  // 日志输出函数
  log(line: string): void
}

/**
 * 注册 check_project 工具（零依赖：手工构造 ToolDefinition）。
 * parameters 使用原始 JSON Schema（与 dsh-tools 的 defineTool 编译产物一致：
 * 隐式开放的对象根、无 required 字段、所有属性可选）。
 */
// 导出安装函数：注册 check_project 工具
export function installTool(ctx: Context, deps: ToolDeps): void {
  // 在上下文中注册工具（register 接受任意 ToolDefinition 对象）
  ctx.tools.register({
    // 工具名
    name: 'check_project',
    // 工具描述
    description: '对当前项目执行三步全面检查：1) 编译与运行并收集报错；2) 核对用户需求是否全部实现；3) 运行项目自动化测试（Node 项目 pnpm test，非 Node 项目等价测试）并模拟真实用户操作（键盘/鼠标）记录卡顿、无响应、报错。返回结构化报告；无问题时返回“没有问题”。',
    // 原始 JSON Schema 参数定义（模型可见）
    parameters: {
      type: 'object',
      properties: {
        // project_dir 参数
        project_dir: {
          // 参数类型为字符串
          type: 'string',
          // 参数说明
          description: '要检查的项目目录（绝对路径）。缺省为当前会话工作目录。',
        },
        // requirements 参数
        requirements: {
          // 参数类型为字符串
          type: 'string',
          // 参数说明
          description: '附加的用户需求文本（会与会话历史中的用户消息合并）。',
        },
        // simulate 参数
        simulate: {
          // 参数类型为布尔
          type: 'boolean',
          // 参数说明
          description: '是否执行第 3 步用户模拟。缺省按插件配置。',
        },
      },
    },
    // 工具输出定义
    output: {
      // 输出模式：字符串
      schema: { type: 'string' },
      // 输出渲染函数：忽略入参，返回文本块
      render(_args: unknown, value: unknown) {
        return [{ type: 'text', text: typeof value === 'string' ? value : String(value ?? '') }]
      },
    },
    // 工具执行超时时间（毫秒）
    timeoutMs: 900000,
    // 工具执行函数（args 未经 schema 校验，需防御性解析）
    async execute(args, exec) {
      // 参数可能不是对象（模型偶发异常），按对象处理
      const source = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      // 获取执行上下文中的 agent
      const agent = exec.agent
      // project_dir 为字符串且去除空白后非空时，取去除空白后的值，否则为 undefined
      const projectDir = typeof source.project_dir === 'string' && source.project_dir.trim()
        ? source.project_dir.trim()
        : undefined
      // requirements 为字符串且去除空白后非空时，取去除空白后的值，否则为 undefined
      const requirements = typeof source.requirements === 'string' && source.requirements.trim()
        ? source.requirements.trim()
        : undefined
      // simulate 为布尔值时取其值，否则为 undefined
      const simulate = typeof source.simulate === 'boolean' ? source.simulate : undefined
      // 用 try/catch 包裹执行，捕获失败
      try {
        // 调用依赖执行检查并返回文本
        return await deps.runCheckReturnText(agent, 'tool', { projectDir, extraRequirements: requirements, simulate })
      } catch (error) {
        // 提取错误消息文本
        const message = error instanceof Error ? error.message : String(error)
        // 记录失败日志
        deps.log('check_project 工具执行失败: ' + message)
        // 返回失败文本
        return '检查执行失败: ' + message
      }
    },
  })
}
