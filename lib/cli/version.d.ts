/**
 * 文件作用：读取本包版本号（唯一事实来源是 package.json）。
 * 发布包内 package.json 与 lib/ 同目录层级，运行时定位可靠；
 * 读取失败时回退到 '0.0.0'（不影响功能，仅用于展示）。
 * @module dsh-code-checker/cli/version
 */
/** 从本包 package.json 读取版本号（dev 源码与发布 lib 两种层级都兼容）。 */
export declare function readPackageVersion(): string;
