/**
 * 文件作用：MCP（Model Context Protocol）stdio 服务器 —— 让支持 MCP 的客户端调用检查能力。
 * MCP（Model Context Protocol）stdio 服务器 —— 让 Trae / Qoder / Cursor / Claude Desktop
 * 等支持 MCP 的客户端直接调用代码检查能力。
 *
 * 客户端配置示例：
 * {
 *   "mcpServers": {
 *     "code-checker": {
 *       "command": "node",
 *       "args": ["<本包路径>/lib/cli/index.js", "mcp"],
 *       "env": { "CODE_CHECK_LLM_BASE_URL": "...", "CODE_CHECK_LLM_API_KEY": "...", "CODE_CHECK_LLM_MODEL": "..." }
 *     }
 *   }
 * }
 *
 * 协议：stdio 上每行一个 JSON-RPC 消息。
 * @module dsh-code-checker/cli
 */
/** 运行 MCP stdio 服务器（阻塞直至 stdin 关闭）。 */
export declare function runMcpServer(): Promise<void>;
