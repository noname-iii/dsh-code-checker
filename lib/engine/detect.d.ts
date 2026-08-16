/**
 * 项目类型检测：识别语言/框架，推导构建与运行命令。
 * @module dsh-code-checker/engine
 *
 * 文件作用：本文件负责识别项目使用的语言/框架（Node、Python、Rust、Go 等），
 * 并根据项目特征（package.json、锁文件、构建配置等）推导出构建命令与运行命令，
 * 供第 1 步的编译/运行检查使用。
 */
import type { EngineIo } from './types.js';
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
    /** 项目内是否存在 TypeScript 配置。 */
    hasTsConfig: boolean;
    readme?: string;
}
/** 检测项目类型并推导命令。 */
export declare function detectProject(dir: string, io: EngineIo): Promise<ProjectInfo>;
/** 判断某相对路径对应的文件是否存在（对外快捷方法）。 */
export declare function has(relSet: Set<string>, rel: string): boolean;
