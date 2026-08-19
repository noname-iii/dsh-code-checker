/**
 * 文件作用：可选 GUI —— 内置 Web 检查面板（报告仓库 + /code-checker/ 路由）。
 * 可选 GUI：内置 Web 检查面板。
 * 通过 ctx.webServer 挂载 /code-checker/ 路由（与 Web GUI 同源，无需额外端口）：
 *   GET /code-checker/             —— 面板页面
 *   GET /code-checker/api/reports  —— 报告列表 JSON
 *   GET /code-checker/api/reports/:id —— 单份报告 JSON（不含 trace）
 *   GET /code-checker/api/reports/:id/trace —— 单份报告的追踪数据（“画面”视图）
 *   GET /code-checker/api/projects —— 项目列表（当前正在修改的项目 + 有报告的项目）
 * 面板顶部有“状态 / 画面”两个视图：
 *   - “状态”：原有的检查报告列表（保持不变）；
 *   - “画面”：左侧项目列表 + 右侧“命令行 / GUI / log”三个面板，展示测试时的命令、真实操作与日志。
 * @module dsh-code-checker
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CheckReport } from '../engine/types.js';
/** 存储的单份报告。 */
export interface StoredReport {
    id: string;
    time: string;
    /** 触发检查的会话 id（手动/工具触发的检查无会话）。 */
    sessionId?: string;
    report: CheckReport;
}
/** 一个正在被 AI 修改的项目（来自根 agent 的会话 cwd）。 */
export interface ActiveProject {
    dir: string;
    name: string;
    sessionId: string;
}
/** 报告仓库（环形缓冲）。 */
export declare class ReportStore {
    private readonly max;
    private readonly items;
    constructor(max: number);
    add(report: CheckReport, sessionId?: string): StoredReport;
    list(): StoredReport[];
    get(id: string): StoredReport | undefined;
    /** 某会话最近一份报告。 */
    lastFor(sessionId: string): StoredReport | undefined;
}
/** 挂载 GUI 路由。 */
export declare function installGui(webServer: {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}, store: ReportStore, listProjects?: () => ActiveProject[]): void;
