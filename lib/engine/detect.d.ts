/**
 * 项目类型检测：识别语言/框架，推导构建与运行命令。
 * @module dsh-code-checker/engine
 *
 * 文件作用：本文件负责识别项目使用的语言/框架（Node、Python、Rust、Go 等），
 * 并根据项目特征（package.json、锁文件、构建配置等）推导出构建命令与运行命令，
 * 供第 1 步的编译/运行检查使用。
 */
import type { EngineIo } from './types.js';
import type { ProjectFiles } from './fs.js';
export type ProjectKind = 'node' | 'node-web' | 'electron' | 'python' | 'rust' | 'go' | 'cpp' | 'java' | 'dotnet' | 'web-static' | 'desktop-exe' | 'unknown';
export interface ProjectInfo {
    kind: ProjectKind;
    name: string;
    packageJson?: {
        scripts?: Record<string, string>;
        main?: string;
        bin?: unknown;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        type?: string;
    };
    lockfile?: 'npm' | 'pnpm' | 'yarn' | 'bun';
    entryCandidates: string[];
    /** 构建命令（按顺序尝试，成功即止）。 */
    buildCommands: string[];
    /** 运行命令（按顺序尝试）。 */
    runCommands: string[];
    /** 自动化测试命令（第 3 步执行；Node 项目等价于 `pnpm test`，非 Node 项目用等价测试命令）。 */
    testCommands: string[];
    /** 项目内是否存在 TypeScript 配置。 */
    hasTsConfig: boolean;
    /** 项目是否带用户界面（GUI）—— 由项目类型与依赖推断（最终结论还需结合 guiEvidence 的源码证据）。 */
    hasGui?: boolean;
    readme?: string;
}
/** 检测项目类型并推导命令。 */
export declare function detectProject(dir: string, io: EngineIo): Promise<ProjectInfo>;
/** GUI 模拟类型：web（浏览器/面板）、desktop（桌面窗口 UIA）、none（无 GUI）。 */
export type GuiSimKind = 'web' | 'desktop' | 'none';
/**
 * GUI 检测（第 2 层）：结合项目类型/依赖（第 1 层，见 detectProject 的 hasGui）
 * 与文件清单/源码采样，判定项目是否带用户操作界面以及对应的模拟类型。
 * 规则：第 1、2 步都通过后，带 GUI 的项目第 3 步必须走 GUI 模拟
 * （DSH 插件面板等走 web 模拟，tkinter/PyQt 等桌面框架走 desktop 模拟）。
 */
export declare function guiSimKind(project: ProjectFiles, info: ProjectInfo): GuiSimKind;
/**
 * 提取 GUI 面板路径：从挂载 webServer 路由的源码里收集 path 字符串
 * （如 DSH 插件 gui.ts 中 webServer.register({ path: '/code-checker' })）。
 * 用于 web 模拟时直接访问面板页面，而不是只探测站点根路径。
 */
export declare function guiPanelPaths(project: ProjectFiles): string[];
/** 判断某相对路径对应的文件是否存在（对外快捷方法）。 */
export declare function has(relSet: Set<string>, rel: string): boolean;
