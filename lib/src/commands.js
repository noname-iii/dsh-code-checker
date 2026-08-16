/**
 * 文件作用：注册 /check 斜杠命令 —— 手动触发全面检查（人机命令面，不产生模型消息）。
 * /check 斜杠命令：手动触发全面检查（人机命令面，不产生模型消息）。
 * @module dsh-code-checker
 */
/** 注册 /check 命令。 */
// 导出安装函数：注册 /check 命令
export function installCommand(ctx, deps) {
    // 在上下文中注册命令
    ctx.commands.register({
        // 命令名
        name: 'check',
        // 命令描述
        description: '全面检查当前项目：编译运行、功能完整性核对、真实用户模拟',
        // 输入提示
        input: { hint: '[项目目录] [附加需求文本…]' },
        // 命令处理函数
        async handler(invocation) {
            // 获取触发命令的 agent
            const agent = invocation.agent;
            // 声明附加需求文本变量（默认未定义）
            let extraRequirements;
            // 获取并去除首尾空白的原始输入
            const raw = invocation.rawInput.trim();
            // 原始输入非空时才解析参数
            if (raw) {
                // 第一个词若是已存在的目录则视为项目目录参数，其余为附加需求文本。
                // 查找第一个空白字符位置
                const firstSpace = raw.search(/\s/);
                // 取出第一个词（无空白时取整段）
                const first = firstSpace < 0 ? raw : raw.slice(0, firstSpace);
                // 取出剩余部分（无空白时为空串）
                const rest = firstSpace < 0 ? '' : raw.slice(firstSpace).trim();
                // 判断首词是否形如路径（盘符、点、波浪号或斜杠开头）
                const pathLike = /^[a-zA-Z]:[\\/]/.test(first) || /^[.~/]/.test(first);
                // 首词像路径且存在剩余文本时，剩余文本作为附加需求
                if (pathLike && rest)
                    extraRequirements = rest;
                // 首词不像路径时，整段输入作为附加需求
                else if (!pathLike)
                    extraRequirements = raw;
            }
            // 用 try/catch 包裹执行，捕获失败
            try {
                // 对 agent 执行一次命令触发的检查
                await deps.runCheckForAgent(agent, 'command', extraRequirements);
                // 获取该会话最近一次报告文本
                const summary = deps.lastReportText(String(agent.id));
                // 返回成功结果，附上报告摘要
                return { kind: 'success', text: summary ? '检查完成：\n' + summary : '检查完成' };
            }
            catch (error) {
                // 记录失败日志
                deps.log('手动检查失败: ' + (error instanceof Error ? error.message : String(error)));
                // 返回错误结果
                return { kind: 'error', text: '检查失败: ' + (error instanceof Error ? error.message : String(error)) };
            }
        },
    });
}
//# sourceMappingURL=commands.js.map