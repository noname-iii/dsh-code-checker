/**
 * 文件作用：会话跟踪器 —— 统计编码活动并在 turn-stopping 检查点自动触发检查。
 * 会话跟踪器：
 *   - 监听 session/event，统计每轮编码活动（文件写入/shell/终端等工具调用）、
 *     记录用户消息（提取需求 + 重置防循环计数）；
 *   - 在 agent/turn-stopping（轮次真正关闭前、被机器 await 的串行检查点）内
 *     同步执行自动检查并 steer 报告 —— 这样报告一定在本轮关闭前送到 AI，
 *     对 headless 一次性会话同样生效；
 *   - 防循环：每用户提示最多 maxAutoChecksPerPrompt 次，同一轮只检查一次。
 * @module dsh-code-checker
 */
// 导入内容转文本与需求提取函数
import { contentText, extractRequirements } from '../engine/requirements.js';
/** 从会话历史提取用户需求文本。 */
export function userRequirementsFromSession(session, maxMessages = 30) {
    const userMessages = []; // 用于收集用户消息文本的数组
    for (const event of [...session.events].reverse()) { // 倒序遍历会话事件（从新到旧）
        if (userMessages.length >= maxMessages)
            break; // 达到消息数上限则停止遍历
        if (event.type !== 'user/message')
            continue; // 跳过非用户消息事件
        const source = event.data.source; // 取事件数据中的来源信息
        if (source.kind !== 'user')
            continue; // 跳过非真实用户来源
        const text = contentText(event.data.content); // 将消息内容转为纯文本
        if (text)
            userMessages.unshift(text); // 非空文本则插入数组头部（保持时间正序）
    }
    const text = userMessages.join('\n'); // 用换行符拼接所有用户消息
    return { text, requirements: extractRequirements(text) }; // 返回拼接文本与提取出的需求列表
}
/** 安装会话跟踪器。 */
export function installTracker(ctx, deps) {
    const states = new Map(); // 按会话 id 存储跟踪状态的映射
    const stateOf = (sessionId) => {
        let state = states.get(sessionId); // 从映射中取该会话的状态
        if (!state) { // 若该会话还没有状态
            state = { lastUserSeq: -1, autoChecksSinceUser: 0, codingCallsInTurn: 0, checkedTurns: new Set(), running: false }; // 用初始值创建新的状态对象
            states.set(sessionId, state); // 将新状态写入映射
        }
        return state; // 返回该会话的状态
    };
    ctx.on('session/event', (session, event) => {
        const sessionId = String(session.id); // 取会话 id 的字符串形式
        const state = stateOf(sessionId); // 取该会话的跟踪状态
        switch (event.type) { // 按事件类型分发处理
            case 'user/message': { // 用户消息事件
                if (event.data.source.kind !== 'user')
                    break; // 非真实用户来源则忽略该事件
                state.lastUserSeq = event.seq; // 记录最后一个用户消息的序列号
                state.autoChecksSinceUser = 0; // 重置自动检查计数
                break; // 结束该分支
            }
            case 'turn/start': { // 轮次开始事件
                state.codingCallsInTurn = 0; // 重置本轮编码活动调用计数
                break; // 结束该分支
            }
            case 'tool/call': { // 工具调用事件
                if (deps.config.codingTools.includes(event.data.name)) { // 若调用的是编码活动工具
                    state.codingCallsInTurn += 1; // 本轮编码活动调用计数加一
                }
                break; // 结束该分支
            }
            default: // 其他事件类型
                break; // 忽略
        }
    });
    // 在轮次关闭前同步检查：报告（或“没有问题”）在本轮边界提交前送到 AI
    ctx.on('agent/turn-stopping', async (payload) => {
        const agent = payload.agent; // 取触发事件的 agent
        if (!deps.config.autoCheck)
            return; // 未开启自动检查则直接返回
        if (!deps.isRoot(agent))
            return; // 非根 agent 则跳过
        const state = stateOf(String(agent.id)); // 取该 agent 的跟踪状态
        if (state.codingCallsInTurn < deps.config.minCodingCalls)
            return; // 编码活动次数不足则不触发检查
        if (state.checkedTurns.has(payload.turn))
            return; // 本轮已经检查过则跳过
        if (state.autoChecksSinceUser >= deps.config.maxAutoChecksPerPrompt) { // 若已达到自动检查次数上限
            deps.log('自动检查已达上限（' + String(deps.config.maxAutoChecksPerPrompt) + ' 次/用户提示），等待新的用户输入。'); // 记录已达上限日志
            return; // 直接返回，等待新的用户输入
        }
        if (state.running)
            return; // 已有检查在进行则跳过（防重入）
        state.running = true; // 标记正在执行检查
        state.checkedTurns.add(payload.turn); // 记录本轮已执行检查
        try { // 开始受保护的检查执行块
            deps.log('检测到编码轮次（工具调用 ' + String(state.codingCallsInTurn) + ' 次），执行自动检查…'); // 记录开始自动检查日志
            await deps.runCheckForAgent(agent, 'auto', undefined, payload.signal); // 等待执行一次自动检查
            state.autoChecksSinceUser += 1; // 自动检查计数加一
        }
        catch (error) { // 捕获检查过程中的异常
            deps.log('自动检查失败: ' + (error instanceof Error ? error.message : String(error))); // 记录失败信息
        }
        finally { // 无论成功或失败都会执行
            state.running = false; // 清除运行标记
        }
    });
    // 清理：会话销毁时移除状态
    ctx.on('session/disposed', (session) => {
        states.delete(String(session.id)); // 删除该会话的跟踪状态
    });
}
//# sourceMappingURL=tracker.js.map