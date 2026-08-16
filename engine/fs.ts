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

/** 引入 Node 内置文件系统模块的 Promise 版 API（异步读写）。 */
import { promises as fsp } from 'node:fs'
/** 引入路径拼接、相对路径、扩展名、文件名等工具函数。 */
import { join, relative, extname, basename } from 'node:path'

/** 遍历时跳过的目录名集合 —— 依赖、构建产物、缓存、版本控制目录都属于“噪音”。 */
export const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target',
  'venv', '.venv', '__pycache__', '.next', '.nuxt', '.cache', 'coverage',
  '.pytest_cache', '.mypy_cache', '.idea', '.vscode', '.DS_Store',
  'playwright-report', 'test-results', '.artifacts', '.dsh-test',
])

/** 可采样的文本文件扩展名集合 —— 这些类型的文件内容会被读取用于关键词匹配。 */
const TEXT_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.svelte',
  '.py', '.rs', '.go', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.java', '.kt',
  '.rb', '.php', '.swift', '.scala', '.sh', '.ps1', '.bat', '.cmd', '.sql',
  '.json', '.yaml', '.yml', '.toml', '.md', '.txt', '.html', '.htm', '.css',
  '.scss', '.less', '.xml', '.gradle', '.lock', '.env', '.cfg', '.ini', '.conf',
])

/** 单个文件的描述条目。 */
export interface FileEntry {
  /** 相对项目根的路径（统一使用 '/' 分隔，便于跨平台比较）。 */
  rel: string
  /** 绝对路径。 */
  abs: string
  /** 文件大小（字节）。 */
  size: number
  /** 是否文本文件（决定是否参与采样）。 */
  text: boolean
}

/** 项目文件树的总视图：清单 + 相对路径集合 + 采样内容。 */
export interface ProjectFiles {
  /** 全部文件条目。 */
  files: FileEntry[]
  /** 相对路径集合（快速存在性检查用，统一小写）。 */
  relSet: Set<string>
  /** 各文件采样内容（受预算限制）。 */
  samples: Map<string, string>
  /** 采样是否因预算而截断（截断时结论可能不完整）。 */
  samplingTruncated: boolean
  /** 实际采样的字节数。 */
  sampledBytes: number
}

/** 递归遍历项目目录，收集所有文件（跳过噪音目录，限制文件数与深度防止失控）。 */
export async function scanProject(
  dir: string,                                        // 要遍历的根目录
  skipDirs: Set<string> = DEFAULT_SKIP_DIRS,          // 跳过的目录名集合（可覆盖）
  maxFiles = 20000,                                   // 文件数上限（防御超大仓库）
): Promise<FileEntry[]> {
  const out: FileEntry[] = []                          // 收集结果
  /** 内部递归函数：遍历 current 目录下所有条目。 */
  async function walk(current: string, depth: number): Promise<void> {
    if (out.length >= maxFiles || depth > 24) return   // 超限或过深则停止
    let entries                                        // 目录条目
    try {
      entries = await fsp.readdir(current, { withFileTypes: true }) // 读取目录
    } catch {
      return                                           // 目录不可读则跳过
    }
    for (const entry of entries) {                     // 逐个处理条目
      if (out.length >= maxFiles) return               // 超限即止
      const abs = join(current, entry.name)            // 拼接绝对路径
      if (entry.isDirectory()) {                       // 子目录：跳过噪音目录后递归
        if (skipDirs.has(entry.name)) continue
        await walk(abs, depth + 1)
      } else if (entry.isFile()) {                     // 文件：记录条目
        let size = 0                                   // 文件大小（不可读时为 0）
        try {
          size = (await fsp.stat(abs)).size            // 读取大小
        } catch {
          // 忽略不可读文件（stat 失败不致命）
        }
        out.push({                                     // 加入结果
          rel: relative(dir, abs).split('\\').join('/'), // 相对路径统一为 '/'
          abs,
          size,
          text: TEXT_EXTS.has(extname(entry.name).toLowerCase()), // 是否文本
        })
      }
    }
  }
  await walk(dir, 0)                                   // 从根目录开始遍历
  return out
}

/** 源码扩展名权重（真正代码排前，README/需求文档权重低但单独提升，见 sampleRank）。 */
const CODE_EXT_PRIORITY: Record<string, number> = {
  '.ts': 10, '.js': 10, '.mjs': 10, '.py': 10, '.rs': 10, '.go': 10,
  '.vue': 9, '.tsx': 9, '.jsx': 9, '.md': 1, '.txt': 1, '.json': 5,
}

/**
 * 采样排序权重：实现源码目录优先，生成/重复产物（lib 的编译副本）与测试/示例靠后。
 * 目的：字节预算有限时，把最可能“体现功能实现”的文件优先放进采样，
 * 避免 lib/ 等编译副本（或字母序靠前的目录）先耗尽预算，导致真正的实现源码
 * （如 src/tracker.ts）进不了分析样本，从而把已实现的功能误判为缺失。
 */
function sampleRank(rel: string): number {
  const lower = rel.toLowerCase() // 小写化路径
  const base = lower.split('/').pop() ?? '' // 取文件名
  // 根目录的关键文档/配置（package.json、README、需求.txt、tsconfig 等）——
  // 文件小、信息密度高，对第 2 步“需求核对”价值最大，给予最高优先级。
  if (!lower.includes('/')
    && /^(package\.json|readme[\w.-]*|需求[\w.-]*|requirements?[\w.-]*|tsconfig[\w.-]*|cordis\.[\w.-]+|dockerfile|compose\.[\w.-]+|\.env[\w.-]*)$/i.test(base)) {
    return 30
  }
  let rank = CODE_EXT_PRIORITY[extname(lower)] ?? 4 // 基础权重：扩展名
  // 实现源码目录加分（src/app 最高；engine/cli 及作为源码副本的 lib/src 次之）
  if (lower.startsWith('src/') || lower.startsWith('app/')) rank += 10
  else if (lower.startsWith('engine/') || lower.startsWith('cli/') || lower.startsWith('lib/src/')) rank += 6
  else if (lower.startsWith('lib/')) rank -= 6 // 其余 lib 内容多为编译副本，靠后
  // 测试与示例目录减分（仍有价值，但在实现源码之后）
  if (/(^|\/)(tests?|__tests__|try_it_out|examples|spec|fixtures)\//.test(lower)) rank -= 4
  return rank
}

/** 快速内容哈希（djb2）：用于跳过与已采样文件完全相同的重复副本（如 lib 编译产物）。 */
function contentHash(text: string): number {
  let hash = 5381 // djb2 初值
  for (let i = 0; i < text.length; i++) { // 逐字符滚动
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0 // hash * 33 + 字符码（取 32 位）
  }
  return hash >>> 0 // 无符号化
}

/** 在预算内采样文本文件内容（实现源码优先、重复副本去重，README/需求文档保留）。 */
export async function sampleFiles(
  files: FileEntry[],                                  // 待采样的文件清单
  maxFiles: number,                                    // 采样文件数上限
  maxBytes: number,                                    // 采样总字节上限
  maxSingleFile = 120_000,                             // 单文件采样上限
): Promise<ProjectFiles> {
  const textFiles = files.filter(f => f.text && f.size > 0) // 只采样非空文本文件
  /** 按“实现源码优先、重复副本去重、同名按路径”排序后的文件列表。 */
  const sorted = [...textFiles].sort((a, b) => {
    return sampleRank(b.rel) - sampleRank(a.rel) || a.rel.localeCompare(b.rel) // 权重降序，同权重按路径
  })
  const samples = new Map<string, string>()            // 采样结果：路径 → 内容
  const seenHashes = new Set<number>()                 // 已采样内容哈希（跳过内容完全相同的副本）
  let budget = maxBytes                                // 剩余字节预算
  for (const file of sorted.slice(0, maxFiles)) {      // 逐个采样（受文件数上限）
    if (budget <= 0) break                             // 预算耗尽即止
    try {
      const buf = await fsp.readFile(file.abs)         // 读取文件
      const text = buf.toString('utf8')                // 解码为 UTF-8
      const hash = contentHash(text)                   // 内容哈希
      if (seenHashes.has(hash)) continue               // 与已采样文件内容完全相同（编译副本）→ 跳过，省预算
      seenHashes.add(hash)                             // 记录哈希
      const chunk = text.length > maxSingleFile        // 超长文件截断
        ? text.slice(0, maxSingleFile) + '\n...[文件过长，已截断]'
        : text
      samples.set(file.rel, chunk)                     // 记录采样
      budget -= chunk.length                           // 扣减预算
    } catch {
      // 跳过不可读文件（不致命）
    }
  }
  return {
    files,
    relSet: new Set(files.map(f => f.rel.toLowerCase())), // 相对路径集合（小写）
    samples,
    samplingTruncated: budget <= 0,                    // 预算耗尽即视为截断（提示结论可能不完整）
    sampledBytes: maxBytes - Math.max(budget, 0),      // 实际采样字节
  }
}

/** 读取 README（大小写不敏感，覆盖常见命名）。 */
export async function readReadme(dir: string): Promise<string | undefined> {
  const names = ['README.md', 'readme.md', 'README.txt', 'readme.txt', 'README', 'README.zh.md', 'README_zh.md'] // 候选名
  for (const name of names) {                          // 逐个尝试
    try {
      const content = await fsp.readFile(join(dir, name), 'utf8') // 读取
      return content                                   // 命中即返回
    } catch {
      // 继续尝试下一个候选名
    }
  }
  return undefined                                     // 都没有则返回 undefined
}

/** 判断相对路径是否存在（忽略大小写，适配 Windows 文件系统）。 */
export function hasFile(relSet: Set<string>, rel: string): boolean {
  return relSet.has(rel.toLowerCase())                 // 集合里存的是小写
}

/** 判断一行是否“看起来像注释”（//、#、--、<!--、/*、* 开头）。 */
export function isCommentLine(line: string): boolean {
  const t = line.trimStart()                           // 去掉行首空白再判断
  return t.startsWith('//') || t.startsWith('#') || t.startsWith('--')
    || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')
}

/**
 * 去掉一行的“行尾注释”（// 或 # 之后的部分），但【跳过字符串字面量内的 // 或 #】——
 * 这样 http://… 之类的 URL 不会被误切。用于让“行尾注释里的词”不参与证据匹配。
 */
export function stripTrailingComment(line: string): string {
  let quote: string | null = null                      // 当前字符串引号（null=不在字符串内）
  let escaped = false                                  // 上一个字符是否为转义符 \
  for (let i = 0; i < line.length; i++) {              // 逐字符扫描
    const ch = line[i]                                 // 当前字符
    if (escaped) { escaped = false; continue }         // 转义后的字符按字面处理
    if (ch === '\\') { escaped = true; continue }       // 记录转义符
    if (quote !== null) {                              // 正在字符串内
      if (ch === quote) quote = null                   // 遇到配对引号则退出字符串
      continue                                        // 字符串内不识别注释
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue } // 进入字符串
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i) // 行尾注释开始，截断
    if (ch === '#') return line.slice(0, i)            // # 注释开始，截断
  }
  return line                                          // 无行尾注释则原样返回
}

/**
 * 在采样内容中搜索关键词（大小写不敏感）。
 * 注释行与行尾注释不参与匹配 —— 注释里提到某个词不能作为“功能已实现”的证据。
 */
export function searchSamples(samples: Map<string, string>, needle: string): { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [] // 命中列表
  const lower = needle.toLowerCase()                   // 小写化后的关键词
  if (!lower) return hits                              // 空关键词直接返回
  for (const [file, content] of samples) {             // 遍历每个采样文件
    const lines = content.split('\n')                  // 按行拆分
    for (let i = 0; i < lines.length; i++) {           // 逐行扫描
      const line = lines[i] ?? ''                      // 当前行
      if (isCommentLine(line)) continue                // 跳过纯注释行
      const searchable = stripTrailingComment(line)    // 去掉行尾注释后参与匹配
      if (searchable.toLowerCase().includes(lower)) {  // 命中关键词
        hits.push({ file, line: i + 1, text: line.trim().slice(0, 200) }) // 记录
        if (hits.length >= 20) return hits             // 命中数量封顶，防止刷屏
      }
    }
  }
  return hits
}

/** 项目文件名（展示用）—— 取目录的最后一段。 */
export function projectName(dir: string): string {
  return basename(dir)
}
