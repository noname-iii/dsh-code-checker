/**
 * 文件作用：OpenAI 兼容接口的 LLM 分析器（CLI/MCP 在无 Harness 环境下使用）。
 * OpenAI 兼容接口的 LLM 分析器（CLI/MCP 在无 Harness 环境下使用）。
 * @module dsh-code-checker/cli
 */

import type { AnalyzeFn } from '../engine/types.js'  // 导入引擎的分析函数类型（仅类型）

export interface OpenAiAnalyzerOptions {  // 定义 OpenAI 兼容分析器的配置选项接口
  baseUrl: string  // 接口地址
  apiKey: string  // API Key
  model: string  // 模型名
  /** 请求超时（毫秒）。 */
  timeoutMs?: number  // 请求超时毫秒数（可选）
}

/** 构造 OpenAI 兼容分析器。 */
export function makeOpenAiAnalyzer(options: OpenAiAnalyzerOptions): AnalyzeFn {  // 导出一个工厂函数，返回符合 AnalyzeFn 签名的分析函数
  const endpoint = options.baseUrl.replace(/\/+$/, '') + '/chat/completions'  // 去除 baseUrl 末尾斜杠后拼接 chat/completions 端点
  return async (req, signal) => {  // 返回分析函数，接收请求对象与可选的取消信号
    const controller = new AbortController()  // 创建 AbortController 用于取消请求
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000)  // 设置超时定时器，到期时取消请求（默认 120 秒）
    const onAbort = (): void => controller.abort()  // 定义取消回调：触发 controller.abort
    signal?.addEventListener('abort', onAbort)  // 若外部提供取消信号，则监听其 abort 事件
    try {  // 开始请求（finally 中清理资源）
      const res = await fetch(endpoint, {  // 发起 HTTP 请求到 OpenAI 兼容端点
        method: 'POST',  // 使用 POST 方法
        signal: controller.signal,  // 绑定内部取消信号
        headers: {  // 请求头
          'content-type': 'application/json',  // 内容类型为 JSON
          ...options.apiKey ? { authorization: 'Bearer ' + options.apiKey } : {},  // 有 API Key 时添加 Bearer 认证头
        },
        body: JSON.stringify({  // 请求体（JSON 序列化）
          model: options.model,  // 模型名
          messages: [  // 消息列表
            ...req.system !== undefined ? [{ role: 'system', content: req.system }] : [],  // 有 system 提示时加入 system 消息
            { role: 'user', content: req.prompt },  // 用户消息（提示词）
          ],
          ...req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {},  // 限制最大 token 时加入该字段
          stream: false,  // 不使用流式输出
        }),
      })
      if (!res.ok) {  // HTTP 状态非 2xx 时
        throw new Error('LLM 请求失败 HTTP ' + String(res.status) + ': ' + (await res.text()).slice(0, 300))  // 抛出包含状态码与响应摘要的错误
      }
      const data = await res.json() as {  // 解析响应 JSON
        choices?: { message?: { content?: string } }[]  // 候选回复结构
        error?: { message?: string }  // 错误信息结构
      }
      if (data.error?.message) throw new Error('LLM 接口错误: ' + data.error.message)  // 接口返回错误时抛出异常
      return data.choices?.[0]?.message?.content ?? ''  // 返回首个候选的消息内容，缺省空字符串
    } finally {  // 无论成功失败都会执行的清理
      clearTimeout(timer)  // 清理超时定时器
      signal?.removeEventListener('abort', onAbort)  // 移除取消信号监听器
    }
  }
}
