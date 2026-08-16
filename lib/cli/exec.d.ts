/**
 * 文件作用：独立 CLI 的进程适配器 —— 用 child_process 实现引擎的 exec/start。
 * 独立 CLI 的进程适配器（child_process）。
 * @module dsh-code-checker/cli
 */
import type { ExecFn, StartFn } from '../engine/types.js';
/** 前台执行适配器（shell: true，超时用 taskkill 杀进程树）。 */
export declare function makeExec(platform: 'win32' | 'posix'): ExecFn;
/** 后台启动适配器。 */
export declare function makeStart(platform: 'win32' | 'posix'): StartFn;
