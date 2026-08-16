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
import { createInterface } from 'node:readline'; // 从 Node 内置 readline 模块导入 createInterface：逐行读取输入流
import { existsSync } from 'node:fs'; // 从 Node 内置 fs 模块导入 existsSync：同步判断目录是否存在
import { resolve } from 'node:path'; // 从 Node 内置 path 模块导入 resolve：解析绝对路径
import { runCheck } from '../engine/index.js'; // 导入引擎核心的检查函数 runCheck
import { makeExec, makeStart } from './exec.js'; // 导入进程适配器工厂函数
import { makeOpenAiAnalyzer } from './llm.js'; // 导入 OpenAI 兼容 LLM 分析器工厂函数
const TOOLS = [
    {
        name: 'check_project', // 工具名
        description: '对项目执行三步全面检查：1) 编译与运行并收集报错；2) 核对用户需求是否全部实现（逐条列出所有未实现/不完整功能）；3) 模拟真实用户操作（键盘/鼠标）记录卡顿、无响应、报错。无问题时返回“没有问题”。', // 工具描述
        inputSchema: {
            type: 'object', // 参数类型为对象
            properties: {
                project_dir: { type: 'string', description: '项目目录绝对路径（缺省为当前工作目录）' }, // 项目目录参数
                requirements: { type: 'string', description: '用户需求文本（每行一条；也会读取 --requirements 引用的文件）' }, // 需求文本参数
                simulate: { type: 'boolean', description: '是否执行第 3 步用户模拟（默认 true）' }, // 是否模拟参数
                install_deps: { type: 'boolean', description: '是否安装依赖（默认 true）' }, // 是否安装依赖参数
            },
        },
    },
    {
        name: 'detect_project', // 工具名
        description: '识别项目类型并推导构建/运行命令。', // 工具描述
        inputSchema: {
            type: 'object', // 参数类型为对象
            properties: {
                project_dir: { type: 'string', description: '项目目录绝对路径（缺省为当前工作目录）' }, // 项目目录参数
            },
        },
    },
];
const CLIENT_NAME = 'dsh-code-checker'; // 定义客户端名称常量
const CLIENT_VERSION = '0.1.0'; // 定义客户端版本号常量
async function checkProject(args) {
    const platform = process.platform === 'win32' ? 'win32' : 'posix'; // 根据运行平台判定 win32 或 posix
    const projectDir = resolve(typeof args.project_dir === 'string' && args.project_dir ? args.project_dir : process.cwd()); // 解析项目目录（缺省当前工作目录）
    if (!existsSync(projectDir))
        return '错误：项目目录不存在: ' + projectDir; // 目录不存在时直接返回错误文本
    const requirements = typeof args.requirements === 'string' && args.requirements // 判断是否提供了需求文本
        ? args.requirements.split(/\r?\n/).map(l => l.trim()).filter(Boolean) // 有则按行拆分、去空白、过滤空行
        : []; // 无则使用空数组
    let analyzer; // 声明 LLM 分析器变量（可能为 undefined）
    const baseUrl = process.env.CODE_CHECK_LLM_BASE_URL; // 从环境变量读取 LLM 接口地址
    const apiKey = process.env.CODE_CHECK_LLM_API_KEY ?? ''; // 从环境变量读取 API Key，缺省空字符串
    const model = process.env.CODE_CHECK_LLM_MODEL; // 从环境变量读取模型名
    if (baseUrl && model)
        analyzer = makeOpenAiAnalyzer({ baseUrl, apiKey, model }); // 地址与模型齐全时构造 LLM 分析器
    const options = {
        projectDir, // 项目目录
        requirements, // 需求列表
        requirementText: requirements.join('\n'), // 需求合并文本
        installDeps: args.install_deps !== false, // 是否安装依赖（缺省 true）
        buildTimeoutMs: 180_000, // 构建超时 180 秒
        runProbeMs: 8_000, // 运行探针 8 秒
        simulate: args.simulate !== false, // 是否用户模拟（缺省 true）
        runAllSteps: false, // 不强制运行全部步骤
        useLlm: analyzer !== undefined, // 分析器存在时启用 LLM
        maxSampleFiles: 400, // 最大采样文件数
        maxSampleBytes: 250_000, // 最大采样字节数
        language: 'zh', // 报告语言为中文
        cleanMessage: '没有问题', // 无问题提示文案
    };
    const report = await runCheck(options, {
        exec: makeExec(platform), // 前台执行适配器
        start: makeStart(platform), // 后台启动适配器
        platform, // 平台标识
        ...analyzer !== undefined ? { analyzer } : {}, // 分析器存在时携带 analyzer 字段
        log: (line) => { console.error('[mcp] ' + line); }, // 日志函数：输出到标准错误
    });
    return report.rendered; // 返回渲染后的报告文本
}
async function detectProject(args) {
    const platform = process.platform === 'win32' ? 'win32' : 'posix'; // 根据运行平台判定 win32 或 posix
    const projectDir = resolve(typeof args.project_dir === 'string' && args.project_dir ? args.project_dir : process.cwd()); // 解析项目目录（缺省当前工作目录）
    const { detectProject: runDetect } = await import('../engine/detect.js'); // 动态导入项目识别函数并重命名为 runDetect
    const info = await runDetect(projectDir, {
        exec: makeExec(platform), // 前台执行适配器
        platform, // 平台标识
        log: (line) => { console.error('[mcp] ' + line); }, // 日志函数：输出到标准错误
    });
    return JSON.stringify(info, null, 2); // 返回缩进 JSON 结果
}
function send(message) {
    process.stdout.write(JSON.stringify(message) + '\n'); // 序列化消息并追加换行写入 stdout
}
/** 运行 MCP stdio 服务器（阻塞直至 stdin 关闭）。 */
export async function runMcpServer() {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity }); // 创建逐行读取接口，读取标准输入
    for await (const line of rl) { // 逐行读取输入（每行一个 JSON-RPC 消息）
        if (!line.trim())
            continue; // 跳过空行
        let request; // 声明请求对象类型
        try { // 尝试解析 JSON
            request = JSON.parse(line); // 解析 JSON 行
        }
        catch { // 解析失败时
            send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); // 返回 Parse error 错误响应
            continue; // 继续处理下一行
        }
        const id = request.id; // 取出请求 id
        const method = request.method ?? ''; // 取出方法名，缺省空字符串
        const params = request.params ?? {}; // 取出参数，缺省空对象
        try { // 开始按方法分发处理
            switch (method) { // 按方法名分发
                case 'initialize': { // 初始化握手
                    send({
                        jsonrpc: '2.0', id, // 协议版本与请求 id
                        result: {
                            protocolVersion: params.protocolVersion ?? '2024-11-05', // 协商协议版本
                            capabilities: { tools: {} }, // 声明支持 tools 能力
                            serverInfo: { name: CLIENT_NAME, version: CLIENT_VERSION }, // 服务器信息
                        },
                    });
                    break; // 结束本分支
                }
                case 'notifications/initialized': // 初始化完成通知
                case 'notifications/cancelled': // 取消通知
                    break; // 无需响应，直接结束
                case 'ping': // 心跳请求
                    send({ jsonrpc: '2.0', id, result: {} }); // 返回空结果
                    break; // 结束本分支
                case 'tools/list': { // 列出工具
                    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); // 返回工具列表
                    break; // 结束本分支
                }
                case 'tools/call': { // 调用工具
                    const name = typeof params.name === 'string' ? params.name : ''; // 取工具名，缺省空字符串
                    const toolArgs = (params.arguments ?? {}); // 取工具参数，缺省空对象
                    let text; // 声明返回文本变量
                    if (name === 'check_project')
                        text = await checkProject(toolArgs); // 调用项目检查工具
                    else if (name === 'detect_project')
                        text = await detectProject(toolArgs); // 调用项目识别工具
                    else
                        text = '未知工具: ' + name; // 未知工具返回提示
                    send({
                        jsonrpc: '2.0', id, // 协议版本与请求 id
                        result: { content: [{ type: 'text', text }], isError: text.startsWith('错误') }, // 结果内容与错误标记
                    });
                    break; // 结束本分支
                }
                default: { // 未知方法
                    if (id !== undefined) { // 仅当有请求 id 时才回复错误
                        send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } }); // 返回方法未找到错误
                    }
                }
            }
        }
        catch (error) { // 处理过程中的异常
            if (id !== undefined) { // 仅当有请求 id 时才回复
                send({
                    jsonrpc: '2.0', id, // 协议版本与请求 id
                    error: { code: -32603, message: 'Internal error: ' + (error instanceof Error ? error.message : String(error)) }, // 错误码与信息
                });
            }
        }
    }
}
//# sourceMappingURL=mcp.js.map