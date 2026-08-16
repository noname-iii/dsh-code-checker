/**
 * 文件作用：读取本包版本号（唯一事实来源是 package.json）。
 * 发布包内 package.json 与 lib/ 同目录层级，运行时定位可靠；
 * 读取失败时回退到 '0.0.0'（不影响功能，仅用于展示）。
 * @module dsh-code-checker/cli/version
 */
import { readFileSync } from 'node:fs'; // 从 Node 内置 fs 导入 readFileSync：同步读取文件
import { fileURLToPath } from 'node:url'; // 从 node:url 导入 fileURLToPath：把文件 URL 转成路径
/** 从本包 package.json 读取版本号（dev 源码与发布 lib 两种层级都兼容）。 */
export function readPackageVersion() {
    // 候选路径：发布包（lib/cli → ../../package.json）与源码开发（cli → ../package.json）
    const candidates = [new URL('../../package.json', import.meta.url), new URL('../package.json', import.meta.url)]; // 两种层级
    for (const url of candidates) { // 逐个尝试
        try { // 受保护的读取与解析
            const pkg = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')); // 解析 package.json
            if (pkg.name === 'dsh-code-checker' && typeof pkg.version === 'string' && pkg.version)
                return pkg.version; // 匹配本包名且版本号合法
        }
        catch {
            // 候选不存在或无法解析 → 尝试下一个
        }
    }
    return '0.0.0'; // 全部失败时回退版本号（仅影响展示文案）
}
//# sourceMappingURL=version.js.map