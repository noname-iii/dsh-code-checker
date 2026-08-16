/**
 * 文件作用：报告渲染 —— 把三步检查（编译运行、功能完整性、真实用户模拟）的结果，
 * 渲染成一段可直接回传给 AI 的纯文本报告（支持中文 / 英文两种语言）。
 *
 * 报告渲染：把三步结果渲染成可回传 AI 的文本报告。
 * @module dsh-code-checker/engine
 */
import type { CheckOptions, CheckReport } from './types.js';
/** 渲染完整报告文本。 */
export declare function renderReport(report: CheckReport, opts: Pick<CheckOptions, 'language' | 'cleanMessage'>): string;
