/**
 * 文件作用：引擎的“文件系统工具”文件。
 *
 * 提供检查引擎所需的全部文件操作能力：
 *   - scanProject()：递归遍历项目目录（跳过 node_modules 等噪音目录），得到文件清单；
 *   - sampleFiles()：在预算内采样文本文件内容（源码优先），供第 2 步关键词搜索使用；
 *   - readReadme()：读取项目的 README（第 3 步用户模拟的操作依据）；
 *   - hasFile() / searchSamples()：文件存在性判断与内容搜索（大小写不敏感）；
 *   - isCommentLine()：判断一行是否像注释 —— 注释行不参与“功能已实现”的证据匹配。
 *
 * @module dsh-code-checker/engine
 */
/** 遍历时跳过的目录名集合 —— 依赖、构建产物、缓存、版本控制目录都属于“噪音”。 */
export declare const DEFAULT_SKIP_DIRS: Set<string>;
/** 单个文件的描述条目。 */
export interface FileEntry {
    /** 相对项目根的路径（统一使用 '/' 分隔，便于跨平台比较）。 */
    rel: string;
    /** 绝对路径。 */
    abs: string;
    /** 文件大小（字节）。 */
    size: number;
    /** 是否文本文件（决定是否参与采样）。 */
    text: boolean;
}
/** 项目文件树的总视图：清单 + 相对路径集合 + 采样内容。 */
export interface ProjectFiles {
    /** 全部文件条目。 */
    files: FileEntry[];
    /** 相对路径集合（快速存在性检查用，统一小写）。 */
    relSet: Set<string>;
    /** 各文件采样内容（受预算限制）。 */
    samples: Map<string, string>;
    /** 采样是否因预算而截断（截断时结论可能不完整）。 */
    samplingTruncated: boolean;
    /** 实际采样的字节数。 */
    sampledBytes: number;
}
/** 递归遍历项目目录，收集所有文件（跳过噪音目录，限制文件数与深度防止失控）。 */
export declare function scanProject(dir: string, // 要遍历的根目录
skipDirs?: Set<string>, // 跳过的目录名集合（可覆盖）
maxFiles?: number): Promise<FileEntry[]>;
/** 在预算内采样文本文件内容（实现源码优先、重复副本去重，README/需求文档保留）。 */
export declare function sampleFiles(files: FileEntry[], // 待采样的文件清单
maxFiles: number, // 采样文件数上限
maxBytes: number, // 采样总字节上限
maxSingleFile?: number): Promise<ProjectFiles>;
/** 读取 README（大小写不敏感，覆盖常见命名）。 */
export declare function readReadme(dir: string): Promise<string | undefined>;
/** 判断相对路径是否存在（忽略大小写，适配 Windows 文件系统）。 */
export declare function hasFile(relSet: Set<string>, rel: string): boolean;
/** 判断一行是否“看起来像注释”（//、#、--、<!--、/*、* 开头）。 */
export declare function isCommentLine(line: string): boolean;
/**
 * 去掉一行的“行尾注释”（// 或 # 之后的部分），但【跳过字符串字面量内的 // 或 #】——
 * 这样 http://… 之类的 URL 不会被误切。用于让“行尾注释里的词”不参与证据匹配。
 */
export declare function stripTrailingComment(line: string): string;
/**
 * 在采样内容中搜索关键词（大小写不敏感）。
 * 注释行与行尾注释不参与匹配 —— 注释里提到某个词不能作为“功能已实现”的证据。
 */
export declare function searchSamples(samples: Map<string, string>, needle: string): {
    file: string;
    line: number;
    text: string;
}[];
/** 项目文件名（展示用）—— 取目录的最后一段。 */
export declare function projectName(dir: string): string;
