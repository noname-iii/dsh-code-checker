/**
 * 文件作用：系统级桌面通知 —— 当某个会话需要用户操作（审批/决策是否运行命令）时，
 * 在 Windows/macOS/Linux 系统层面弹出通知，通知包含：哪个会话、具体命令信息、可选项。
 *
 * 实现要点：
 *   - 零外部依赖：直接调用操作系统内置命令（macOS: osascript；Windows: PowerShell 托盘气泡；
 *     Linux: notify-send），通过 child_process.spawn 以【参数数组】方式调用（不走 shell），
 *     因此通知内容不会被当作命令注入；
 *   - 只“观察”审批请求，绝不劫持用户决策：approval/request 是 waterfall 事件，
 *     本模块发完通知后原样调用 next()，把决定权交还给 Harness 的审批应答链；
 *   - 通知是 fire-and-forget（detached + unref），不阻塞审批流程。
 * @module dsh-code-checker/notify
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
/** 发送系统通知（按平台选择命令；fire-and-forget）。 */
export declare function sendSystemNotification(platform: NodeJS.Platform, title: string, body: string): void;
/** 从会话事件日志里按 callId 反查该次工具调用的“具体命令/参数”。 */
export declare function toolArgumentsFromSession(session: Session, callId?: unknown): string | undefined;
/** 取会话的可读标识：优先会话标题（session/title 事件），其次 cwd 目录名，最后会话 id 前 8 位。 */
export declare function sessionLabel(session: Session): string;
/** 审批通知配置子集。 */
export interface NotifyConfig {
    enabled: boolean;
}
/** 组装审批通知正文（纯函数，便于测试）：会话 + 工具 + 具体信息 + 选项。 */
export declare function buildApprovalBody(label: string, toolName: string, info: string): string;
/** 审批通知标题。 */
export declare const APPROVAL_NOTICE_TITLE = "dsh-code-checker\uFF1A\u9700\u8981\u7528\u6237\u64CD\u4F5C";
/**
 * 安装“审批请求 → 系统通知”观察器。
 * 监听 approval/request（waterfall），发系统通知后原样 next()，不改变审批结果。
 */
export declare function installApprovalNotifier(ctx: Context, config: NotifyConfig, log: (line: string) => void): void;
