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
export {};
