/**
 * 文件作用：注册 check_project 模型工具 —— AI 可主动请求检查项目并把报告作为工具结果返回。
 * check_project 模型工具：AI 可在任意时刻主动请求检查项目。
 * @module dsh-code-checker
 */
// 引入 defineTool 函数：用于定义模型工具
import { defineTool } from '@deepseek-ai/dsh-tools';
/** 注册 check_project 工具。 */
// 导出安装函数：注册 check_project 工具
export function installTool(ctx, deps) {
    // 在上下文中注册工具，工具定义由 defineTool 生成
    ctx.tools.register(defineTool({
        // 工具名
        name: 'check_project',
        // 工具描述
        description: '对当前项目执行三步全面检查：1) 编译与运行并收集报错；2) 核对用户需求是否全部实现；3) 模拟真实用户操作（键盘/鼠标）记录卡顿、无响应、报错。返回结构化报告；无问题时返回“没有问题”。',
        // 工具参数定义
        parameters: {
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
        // 工具输出定义
        output: {
            // 输出模式：字符串
            schema: { type: 'string' },
            // 输出渲染函数：忽略入参，返回文本块
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        // 工具执行超时时间（毫秒）
        timeoutMs: 900000,
        // 工具执行函数
        async execute(args, exec) {
            // 获取执行上下文中的 agent
            const agent = exec.agent;
            // project_dir 为字符串且去除空白后非空时，取去除空白后的值，否则为 undefined
            const projectDir = typeof args.project_dir === 'string' && args.project_dir.trim()
                ? args.project_dir.trim()
                : undefined;
            // requirements 为字符串且去除空白后非空时，取去除空白后的值，否则为 undefined
            const requirements = typeof args.requirements === 'string' && args.requirements.trim()
                ? args.requirements.trim()
                : undefined;
            // simulate 为布尔值时取其值，否则为 undefined
            const simulate = typeof args.simulate === 'boolean' ? args.simulate : undefined;
            // 用 try/catch 包裹执行，捕获失败
            try {
                // 调用依赖执行检查并返回文本
                return await deps.runCheckReturnText(agent, 'tool', { projectDir, extraRequirements: requirements, simulate });
            }
            catch (error) {
                // 提取错误消息文本
                const message = error instanceof Error ? error.message : String(error);
                // 记录失败日志
                deps.log('check_project 工具执行失败: ' + message);
                // 返回失败文本
                return '检查执行失败: ' + message;
            }
        },
    }));
}
//# sourceMappingURL=tool.js.map