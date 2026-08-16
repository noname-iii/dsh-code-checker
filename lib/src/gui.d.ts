/**
 * 文件作用：可选 GUI —— 内置 Web 检查面板（报告仓库 + /code-checker/ 路由）。
 * 可选 GUI：内置 Web 检查面板。
 * 通过 ctx.webServer 挂载 /code-checker/ 路由（与 Web GUI 同源，无需额外端口）：
 *   GET /code-checker/             —— 面板页面
 *   GET /code-checker/api/reports  —— 报告列表 JSON
 *   GET /code-checker/api/reports/:id —— 单份报告 JSON
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
}, store: ReportStore): void;
