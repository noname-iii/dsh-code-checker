/**
 * 文件作用：实现“功能完整性核对”（第 2 步）——根据用户文字需求，检查项目功能是否全部实现。
 *   1. 启发式核对：从需求中提取关键词，在文件名与文件内容中搜索实现痕迹；
 *   2. 结构化核对：检查需求里提到的 npm/pnpm/yarn 脚本、文件名是否真实存在；
 *   3. LLM 深度核对：LLM 可用时逐条判断需求实现状态（失败则回退到启发式核对）；
 *   4. 行为验证：模拟用户真实打开项目（web 抓取页面文本 / CLI 跑 --help、--version），
 *      看“运行后所见”是否包含需求功能，作为运行时证据补充（能救回启发式误判的缺失）；
 *   若存在未实现/不完整的功能也不中断流程，全部检查完毕后一次性汇报所有缺失项。
 *
 * 第 2 步：根据用户文字，核对功能是否全部实现。
 * 即使发现功能缺失也不中断 —— 全部检查完毕后一次性汇报所有缺失项。
 * @module dsh-code-checker/engine
 */
import { isCommentLine, searchSamples, stripTrailingComment } from './fs.js'; // 引入注释行判断、内容采样搜索与行尾注释剥离工具
import { extractTerms } from './requirements.js'; // 引入需求关键词提取函数
import { request as httpRequest } from 'node:http'; // 引入 node:http 的 request（第 2 步行为验证：抓取运行后页面文本）
import { promises as fsp, existsSync } from 'node:fs'; // 引入 fs（写 Playwright 计划文件、定位 simulators 目录）
import { join, dirname } from 'node:path'; // 引入 path（拼接 simulators 目录路径）
import { fileURLToPath } from 'node:url'; // 引入 fileURLToPath（定位本模块目录）
import { randomUUID } from 'node:crypto'; // 引入 randomUUID（生成临时计划文件 id）
/**
 * 占位/未实现标记：只认“标记词位于行首”的注释行（真实 TODO 的写法），
 * 避免把“讨论未实现标记”的普通注释误判成占位。
 */
const PLACEHOLDER_MARKER_LINE_ASCII = /^(?:todo|fixme|xxx|hack|not implemented|notimplemented|unimplemented|todo!|placeholder)\b/i; // ASCII 占位标记（位于行首、忽略大小写）
const PLACEHOLDER_MARKER_LINE_CJK = /^(?:待办|待实现|未实现|暂未实现|空实现|敬请期待)/; // 中文占位标记（位于行首）
function isPlaceholderMarkerLine(body) {
    return PLACEHOLDER_MARKER_LINE_ASCII.test(body) || PLACEHOLDER_MARKER_LINE_CJK.test(body); // ASCII 或中文任一命中即视为占位
}
/** 代码里的硬性“未实现”标记（Rust todo!() / Python NotImplementedError / 显式 throw）。 */
const HARD_CODE_MARKERS = [
    /todo!\(/i, // Rust 的 todo!() 宏
    /unimplemented!\(/i, // Rust 的 unimplemented!() 宏
    /raise\s+NotImplementedError/i, // Python 抛出的 NotImplementedError
    /throw new Error\(['"](Not implemented|TODO)/i, // JS/TS 显式抛出的未实现异常
];
/** 剥掉注释前缀（//、#、--、<!--、/*、*）。 */
function commentBody(line) {
    return line.replace(/^\s*(?:\/\/+|#+|--+|<!--|\/\*+|\*+)?\s*/, ''); // 用正则删除行首空白与注释前缀
}
/** 需求文档类文件名（自身包含需求文本，不能作为“已实现”的证据）。 */
const REQUIREMENT_FILE_PATTERN = /^(requirements?(\.[a-z]{1,6})?|需求(\.txt|\.md)?|需求文档(\.txt|\.md)?)$/i; // 匹配需求文档文件名
function isRequirementFile(rel) {
    const base = rel.split('/').pop() ?? ''; // 取路径最后一段（即文件名）
    return REQUIREMENT_FILE_PATTERN.test(base); // 用正则判断是否为需求文档文件名
}
/** 单条需求的启发式核对。 */
function heuristicCheck(requirement, project) {
    const terms = extractTerms(requirement); // 从需求文本中提取关键词
    const matchedFiles = new Set(); // 记录匹配到的文件（自动去重）
    const placeholders = []; // 记录发现的占位标记
    const evidenceParts = []; // 记录判断依据片段
    if (terms.length === 0) { // 无法提取出关键词时
        return { status: 'unchecked', evidence: '无法从该需求中提取出可搜索的关键词', matchedFiles: [], placeholders: [] }; // 返回“无法核对”结果
    }
    for (const term of terms) { // 逐个关键词进行搜索
        // 1) 文件名匹配
        for (const rel of project.relSet) { // 遍历所有文件相对路径
            if (isRequirementFile(rel))
                continue; // 跳过需求文档自身
            if (rel.includes(term.toLowerCase())) { // 文件名包含关键词（忽略大小写）
                matchedFiles.add(rel); // 记录匹配文件
                evidenceParts.push('文件名匹配 “' + term + '” → ' + rel); // 记录依据
            }
        }
        // 2) 内容匹配
        for (const hit of searchSamples(project.samples, term)) { // 在采样内容中搜索关键词
            if (isRequirementFile(hit.file))
                continue; // 跳过需求文档自身
            matchedFiles.add(hit.file); // 记录匹配文件
            if (evidenceParts.length < 12) { // 依据片段数量上限控制
                evidenceParts.push(hit.file + ':' + String(hit.line) + ' 包含 “' + term + '”'); // 记录依据
            }
        }
    }
    // 占位符检查：注释行要求“标记词位于行首”；代码行只认硬性未实现标记
    for (const [file, content] of project.samples) { // 遍历所有采样文件
        for (const line of content.split('\n')) { // 逐行检查
            const hit = isCommentLine(line) // 判断是否为注释行
                ? isPlaceholderMarkerLine(commentBody(line)) // 注释行：检查行首占位标记
                : HARD_CODE_MARKERS.some(pattern => pattern.test(stripTrailingComment(line))); // 代码行：去掉行尾注释后检查硬性未实现标记
            if (hit) { // 命中占位/未实现标记时
                placeholders.push(file + ': ' + line.trim().slice(0, 160)); // 记录标记（截断到 160 字符）
                if (placeholders.length >= 8)
                    break; // 达到 8 条上限即停止当前文件
            }
        }
        if (placeholders.length >= 8)
            break; // 达到 8 条上限即停止全部检查
    }
    const matched = [...matchedFiles]; // 把去重后的匹配文件转成数组
    // 占位标记只与“本需求匹配到的文件”关联，避免一个无关 TODO 让所有需求都被判 partial
    const relevantPlaceholders = matched.length > 0 // 仅当存在匹配文件时才关联占位标记
        ? placeholders.filter(p => {
            const file = p.split(':')[0]; // 取占位标记所在文件名
            return file !== undefined && matchedFiles.has(file); // 判断该文件是否匹配
        })
        : []; // 无匹配文件时置空
    let status; // 声明核对状态变量
    if (matched.length === 0) { // 无任何匹配文件
        status = 'missing'; // 判为缺失
    }
    else if (relevantPlaceholders.length > 0) { // 有匹配文件但存在相关占位标记
        status = 'partial'; // 判为部分实现
    }
    else { // 有匹配文件且无占位标记
        status = 'implemented'; // 判为已实现
    }
    const evidence = evidenceParts.slice(0, 8).join('；') || '未在项目文件中找到相关实现痕迹'; // 拼接依据（最多 8 条，无则给提示）
    return { status, evidence, matchedFiles: matched.slice(0, 10), placeholders: relevantPlaceholders.slice(0, 6) }; // 返回核对结果（限制数量）
}
/** 结构化核对：需求中点名的脚本/文件是否存在。 */
function structuralCheck(requirement, project, projectInfo) {
    const notes = []; // 累积结构性问题说明
    const scriptRefs = [...requirement.matchAll(/npm\s+run\s+([a-zA-Z0-9:_-]+)|pnpm\s+([a-zA-Z0-9:_-]+)|yarn\s+([a-zA-Z0-9:_-]+)/gi)]; // 提取需求中提到的 npm/pnpm/yarn 脚本名
    const scripts = projectInfo.packageJson?.scripts ?? {}; // 取 package.json 的脚本表（无则空对象）
    for (const match of scriptRefs) { // 逐个检查被提到的脚本
        const name = match[1] ?? match[2] ?? match[3]; // 取三种包管理器对应捕获组的脚本名
        if (name && !(name in scripts)) { // 脚本名非空且 package.json 中缺失时
            notes.push('需求提到 npm 脚本 “' + name + '”，但 package.json 中不存在该脚本'); // 记录缺失脚本
        }
    }
    // 反引号文件名引用
    for (const match of requirement.matchAll(/`([^`]+)`/g)) { // 提取需求中反引号包裹的文件名引用
        const name = match[1]; // 取反引号内的文件名
        if (name && /\.[a-z0-9]{1,5}$/i.test(name) && !name.includes('/') && !name.includes('\\')) { // 形如“xxx.ext”的纯文件名
            const found = [...project.relSet].some(rel => rel.endsWith(name)); // 判断项目里是否存在以该文件名结尾的文件
            if (!found)
                notes.push('需求提到文件 “' + name + '”，但项目中不存在该文件'); // 不存在则记录缺失
        }
    }
    return notes.slice(0, 5); // 最多返回 5 条说明
}
/** 用 LLM 深度核对需求实现情况。 */
async function llmCheck(// 定义 LLM 深度核对函数
requirements, // 需求列表
project, // 项目文件
projectInfo, // 项目信息
opts, // 检查配置
io) {
    const analyzer = io.analyzer; // 取 LLM 分析器
    if (!analyzer || !opts.useLlm || requirements.length === 0)
        return undefined; // 无分析器/禁用 LLM/无需求时直接返回
    try {
        const fileList = project.files // 构造文件清单文本
            .filter(f => f.text) // 只保留有文本内容的文件
            .sort((a, b) => a.rel.localeCompare(b.rel)) // 按相对路径排序
            .slice(0, 400) // 最多 400 个文件
            .map(f => f.rel + (f.size > 1024 ? ' (' + String(Math.round(f.size / 1024)) + 'KB)' : '')) // 文件名 + 可选大小标注
            .join('\n'); // 用换行拼接
        const samples = [...project.samples.entries()] // 构造源码采样文本（已按实现源码优先排序、重复副本去重）
            .map(([file, content]) => '=== ' + file + ' ===\n' + content) // 每个文件加标题分隔
            .join('\n\n') // 文件之间空行分隔
            .slice(0, 80_000); // 截断到 80000 字符（采样排序保证最前面的正是实现源码）
        const system = '你是资深软件测试工程师。用户提出了若干功能需求，下面是一个已完成的项目的文件清单与源码片段（可能被截断）。请逐条判断每个需求是否已实现。只能输出 JSON。'; // 系统提示词
        const prompt = [
            '项目类型: ' + projectInfo.kind, // 项目类型
            '', // 空行
            '文件清单：', // 文件清单标题
            fileList.slice(0, 8000), // 文件清单（截断到 8000 字符）
            '', // 空行
            '源码采样：', // 源码采样标题
            samples, // 源码采样内容
            '', // 空行
            '需求列表（编号从 0 开始）：', // 需求列表标题
            ...requirements.map((r, i) => String(i) + '. ' + r), // 编号后的需求列表
            '', // 空行
            '请输出 JSON 数组，每个元素形如：', // 输出格式说明
            '{"index": 编号, "status": "implemented|partial|missing|not-requirement", "evidence": "判断依据（引用具体文件）", "suggestion": "缺失或部分实现时的修复建议（implemented/not-requirement 时可为空字符串）"}', // JSON 元素模板
            'status 说明：implemented=已实现；partial=部分实现；missing=缺失；not-requirement=该条不是功能需求（用户提问、闲聊、说明等），不参与实现判断，evidence 简述原因。', // 状态语义说明
            '务必覆盖全部 ' + String(requirements.length) + ' 条需求；不要输出 JSON 以外的任何内容。', // 要求覆盖全部需求
        ].join('\n'); // 用换行拼接提示词
        io.log('[第2步] 调用 LLM 深度核对需求实现情况…'); // 输出日志
        const raw = await analyzer({ system, prompt, maxTokens: 8000 }, io.signal); // 调用 LLM 分析器
        const jsonStart = raw.indexOf('['); // 找 JSON 数组起始位置
        const jsonEnd = raw.lastIndexOf(']'); // 找 JSON 数组结束位置
        if (jsonStart < 0 || jsonEnd <= jsonStart) { // 未找到有效 JSON 数组时
            io.log('[第2步] LLM 输出无法解析为 JSON，回退到启发式核对'); // 输出日志
            return undefined; // 回退到启发式
        }
        const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)); // 解析 JSON 数组
        if (!Array.isArray(parsed))
            return undefined; // 解析结果不是数组则回退
        const verdicts = []; // 累积解析出的核对结论
        for (const item of parsed) { // 逐个元素解析
            if (typeof item !== 'object' || item === null)
                continue; // 跳过非对象元素
            const rec = item; // 转成记录类型
            const index = typeof rec.index === 'number' ? rec.index : -1; // 取编号（非数字则为 -1）
            const status = rec.status; // 取状态字段
            if (index < 0 || index >= requirements.length)
                continue; // 编号越界则跳过
            if (status !== 'implemented' && status !== 'partial' && status !== 'missing' && status !== 'not-requirement')
                continue; // 状态非法则跳过
            // not-requirement（用户提问/闲聊等非功能条目）归一化为 implemented：
            // 不产生缺失告警，也不阻塞第 3 步；evidence 注明其“非需求”性质，保持报告可解释。
            const normalized = status === 'not-requirement' ? 'implemented' : status; // 归一化状态
            const evidence = status === 'not-requirement' // 非需求条目时前置说明
                ? '（该条不是功能需求，不参与核对）' + (typeof rec.evidence === 'string' ? rec.evidence.slice(0, 500) : '')
                : (typeof rec.evidence === 'string' ? rec.evidence.slice(0, 500) : '');
            verdicts.push({
                index, // 需求编号
                text: requirements[index] ?? '', // 需求文本
                status: normalized, // 状态（not-requirement 归一化为 implemented）
                evidence, // 依据（截断 500）
                suggestion: typeof rec.suggestion === 'string' ? rec.suggestion.slice(0, 500) : undefined, // 建议（截断 500）
            });
        }
        return verdicts.length === 0 ? undefined : verdicts; // 无有效结论则回退，否则返回
    }
    catch (error) { // 捕获 LLM 调用或解析异常
        io.log('[第2步] LLM 核对失败，回退到启发式核对: ' + (error instanceof Error ? error.message : String(error))); // 输出日志
        return undefined; // 回退到启发式
    }
}
/** 去掉 HTML 标签与脚本，得到“用户可见”的纯文本（第 2 步行为验证用）。 */
function stripHtml(html) {
    return html // 返回处理后的文本
        .replace(/<script[\s\S]*?<\/script>/gi, ' ') // 去脚本块
        .replace(/<style[\s\S]*?<\/style>/gi, ' ') // 去样式块
        .replace(/<!--[\s\S]*?-->/g, ' ') // 去注释
        .replace(/<[^>]+>/g, ' ') // 去所有标签
        .replace(/&nbsp;/gi, ' ') // nbsp → 空格
        .replace(/&amp;/gi, '&') // 解码 &amp;
        .replace(/&lt;/gi, '<') // 解码 &lt;
        .replace(/&gt;/gi, '>') // 解码 &gt;
        .replace(/&#\d+;/g, ' ') // 数字实体 → 空格
        .replace(/\s+/g, ' ') // 合并空白
        .trim(); // 去首尾空白
}
/** HTTP GET 页面并返回可见文本（超时/失败返回空串，绝不抛错）。 */
function fetchPageText(url, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let settled = false; // 是否已结束
        const done = (s) => { if (!settled) {
            settled = true;
            resolve(s);
        } }; // 结束并返回文本
        const req = httpRequest(url, { method: 'GET', headers: { connection: 'close' }, timeout: timeoutMs }, (res) => {
            let body = ''; // 累积响应体
            res.setEncoding('utf8'); // 按 utf8 解码
            res.on('data', (c) => { body += c; if (body.length > 200000)
                req.destroy(); }); // 累积（超 200KB 截断）
            res.on('end', () => done(stripHtml(body))); // 结束时返回可见文本
            res.on('error', () => done('')); // 流异常返回空
        });
        req.on('timeout', () => { req.destroy(); done(''); }); // 超时返回空
        req.on('error', () => done('')); // 请求异常返回空
        req.end(); // 发送
    });
}
/** 行为验证候选端口（不含 3080——那是 DSH 面板本身，避免误抓宿主页面）。 */
const BEHAVIOR_PORTS = [5173, 3000, 8080, 4173, 5000, 8000]; // web dev server 常见端口
const moduleDir = dirname(fileURLToPath(import.meta.url)); // 本模块所在目录
/** 定位 simulators 目录（兼容 lib/engine 编译产物与源码直跑两种层级）。 */
function findSimulatorsDir() {
    let dir = moduleDir; // 从当前模块目录开始
    for (let i = 0; i < 4; i++) { // 最多向上 4 层
        const candidate = join(dir, 'simulators'); // 当前层的 simulators 候选路径
        if (existsSync(candidate))
            return candidate; // 存在即返回
        const parent = dirname(dir); // 上一层
        if (parent === dir)
            break; // 到根目录则停止
        dir = parent; // 继续向上
    }
    return join(moduleDir, '..', 'simulators'); // 兜底
}
const SIMULATORS_DIR = findSimulatorsDir(); // simulators 目录
/** 用 Playwright 渲染页面拿到“用户可见”文本（SPA 也能拿到真实渲染内容）；不可用/失败返回空串。 */
async function renderWebText(baseUrl, opts, io) {
    const script = join(SIMULATORS_DIR, 'web-playwright.mjs'); // Playwright 脚本路径
    const artifacts = process.env.TEMP ?? '/tmp'; // 产物目录（临时）
    const planFile = join(artifacts, 'dsh-cc-beh-' + randomUUID() + '.json'); // 临时计划文件
    try { // 写最小计划并执行
        await fsp.writeFile(planFile, JSON.stringify({ baseUrl, interactions: [{ action: 'goto', target: '/' }, { action: 'wait', value: '1200' }], artifacts }), 'utf8'); // 最小计划：打开首页并等待渲染
        const node = process.execPath; // Node 可执行文件
        const command = '"' + node.replace(/"/g, '') + '" "' + script.replace(/"/g, '') + '" "' + planFile.replace(/"/g, '') + '"'; // 组装命令
        const res = await io.exec({ command, cwd: opts.projectDir, timeoutMs: 60_000 }); // 执行 Playwright
        const jsonLine = (res.stdout || '').trim().split(/\r?\n/).find(l => l.startsWith('RESULT:'))?.slice('RESULT:'.length); // 找结果行
        if (jsonLine) { // 有结果
            const result = JSON.parse(jsonLine); // 解析
            if (result.playwright && result.pageText) {
                io.log('[第2步] 行为验证：Playwright 渲染页面拿到可见文本（' + String(result.pageText.length) + ' 字符）。');
                return result.pageText;
            } // 成功
        }
    }
    catch { /* 忽略 Playwright 失败 */ }
    finally { // 清理临时计划文件
        await fsp.unlink(planFile).catch(() => { }); // 忽略删除失败
    }
    return ''; // Playwright 不可用或失败
}
/** 探测一个 baseUrl：先 HTTP 看是否有服务，再优先 Playwright 拿渲染文本，回退原始 HTML。 */
async function probeWebText(baseUrl, opts, io) {
    const raw = await fetchPageText(baseUrl + '/'); // 先 HTTP 抓取（若端口无服务则返回空，避免无谓地跑 Playwright）
    if (!raw)
        return ''; // 无服务
    return (await renderWebText(baseUrl, opts, io)) || raw; // 优先渲染文本，回退原始 HTML
}
/**
 * 行为验证：模拟用户真实打开项目，拿到“运行后所见”的文本。
 *   - web 项目：探测/启动 dev server 后（优先 Playwright）抓取渲染后可见文本；
 *   - CLI 项目：跑 --help、--version 并收集输出。
 * 失败/超时返回空串，绝不抛错（行为验证是“补充证据”，不影响主流程）。
 */
async function behavioralText(projectInfo, opts, io) {
    const isWeb = projectInfo.kind === 'web-static' || projectInfo.kind === 'node-web'; // 明确 web 项目
    // ── web：先探测已有服务，再按需启动 dev server ──
    if (isWeb) { // web 项目
        for (const port of BEHAVIOR_PORTS) { // 逐个候选端口探测已有服务
            const text = await probeWebText('http://127.0.0.1:' + String(port), opts, io); // 探测并抓取页面可见文本
            if (text) {
                io.log('[第2步] 行为验证：在端口 ' + String(port) + ' 探测到页面（' + String(text.length) + ' 字符可见文本）。');
                return text;
            } // 命中即返回
        }
        if (io.start && projectInfo.runCommands[0]) { // 无已有服务且可后台启动时，启动 dev server 再抓取
            let server; // 服务器句柄
            try { // 启动并轮询
                io.log('[第2步] 行为验证：启动开发服务器抓取页面: ' + projectInfo.runCommands[0]); // 日志
                server = await io.start({ command: projectInfo.runCommands[0], cwd: opts.projectDir }); // 启动
                for (let i = 0; i < 20; i++) { // 最多 10 秒轮询
                    for (const port of BEHAVIOR_PORTS) { // 逐个端口探测
                        const text = await probeWebText('http://127.0.0.1:' + String(port), opts, io); // 探测并抓取页面可见文本
                        if (text) {
                            io.log('[第2步] 行为验证：启动后从端口 ' + String(port) + ' 抓取到页面文本。');
                            return text;
                        } // 命中即返回
                    }
                    await new Promise(resolve => setTimeout(resolve, 500)); // 等 500ms 再试
                }
            }
            catch { /* 忽略启动/抓取失败 */ }
            finally { // 无论如何停止服务器
                if (server) {
                    try {
                        await server.stop();
                    }
                    catch { /* 忽略停止失败 */ }
                }
            }
        }
        return ''; // 无法取得页面文本
    }
    // ── CLI：跑 --help / --version 看输出 ──
    const parts = []; // 累积命令输出
    const base = projectInfo.runCommands[0]; // 首个运行命令
    if (base) { // 有运行命令
        for (const arg of ['--help', '--version']) { // 两个探针参数
            const command = base + ' ' + arg; // 拼接命令
            try { // 执行命令
                const res = await io.exec({ command, cwd: opts.projectDir, timeoutMs: Math.min(opts.runProbeMs * 2, 20_000) }); // 执行
                const out = (res.stdout + '\n' + res.stderr).trim(); // 合并输出
                if (out)
                    parts.push(out.slice(0, 4000)); // 截断后加入
            }
            catch { /* 忽略执行失败 */ }
        }
    }
    return parts.join('\n'); // 返回合并文本
}
/** 执行第 2 步。 */
export async function runStep2(// 定义第 2 步主函数
requirements, // 需求列表
project, // 项目文件
projectInfo, // 项目信息
opts, // 检查配置
io) {
    const started = Date.now(); // 记录开始时间
    const detail = []; // 累积详细说明
    const findings = []; // 累积问题
    const verdicts = []; // 累积需求核对结论
    detail.push('提取到 ' + String(requirements.length) + ' 条需求。'); // 记录需求条数
    if (requirements.length === 0) { // 无需求时
        detail.push('没有可用需求文本，第 2 步跳过（可在 /check 时附带需求，或由用户消息自动提取）。'); // 说明跳过原因
        return { step: 2, title: '功能完整性核对', status: 'skipped', detail, findings, verdicts, durationMs: Date.now() - started }; // 返回跳过结果
    }
    const llmVerdicts = await llmCheck(requirements, project, projectInfo, opts, io); // 先尝试 LLM 深度核对
    // 行为验证：模拟用户真实打开项目，拿“运行后所见”文本作为运行时证据（失败返回空串）。
    const renderedText = await behavioralText(projectInfo, opts, io); // 运行后可见文本
    if (renderedText)
        detail.push('已模拟打开项目进行行为验证（可见文本 ' + String(renderedText.length) + ' 字符）。'); // 记录行为验证
    for (let i = 0; i < requirements.length; i++) { // 逐条需求核对
        const requirement = requirements[i]; // 当前需求
        if (!requirement)
            continue; // 跳过空需求
        const hv = heuristicCheck(requirement, project); // 启发式核对
        const llm = llmVerdicts?.find(v => v.index === i); // 找该需求对应的 LLM 结论
        const structural = structuralCheck(requirement, project, projectInfo); // 结构化核对
        let status; // 声明状态变量
        let evidence; // 声明依据变量
        let suggestion; // 声明建议变量
        if (llm) { // 有 LLM 结论时优先采用
            status = llm.status; // 用 LLM 状态
            evidence = llm.evidence || hv.evidence; // 依据优先 LLM，空则回退启发式
            suggestion = llm.suggestion; // 用 LLM 建议
        }
        else { // 无 LLM 结论时用启发式
            status = hv.status; // 用启发式状态
            evidence = hv.evidence + '（启发式核对）'; // 标注为启发式依据
        }
        if (structural.length > 0 && status === 'implemented') { // 存在结构性问题且当前判为已实现时
            status = 'partial'; // 降级为部分实现
            evidence = structural.join('；') + '；' + evidence; // 前置结构性说明
        }
        if (hv.placeholders.length > 0 && status === 'implemented' && !llm) { // 有占位标记且无 LLM 结论且判为已实现时
            status = 'partial'; // 降级为部分实现
            evidence = '发现占位/未完成标记：' + hv.placeholders.join('；') + '；' + evidence; // 前置占位标记说明
        }
        // 行为验证：需求关键词是否出现在“运行后所见”文本里（模拟用户真实打开项目看到的界面/输出）。
        if (renderedText) { // 有行为验证文本
            const behavioralTerms = extractTerms(requirement); // 提取该需求的关键词
            const hit = behavioralTerms.some(term => renderedText.toLowerCase().includes(term.toLowerCase())); // 是否命中
            if (hit) { // 运行时可见该功能痕迹
                const behavioralNote = '运行时可见（模拟打开项目后看到该功能）'; // 行为验证证据
                if (status === 'missing') {
                    status = 'implemented';
                    evidence = behavioralNote + '；' + evidence;
                } // 缺失 → 救回为已实现
                else {
                    evidence = behavioralNote + '；' + evidence;
                } // 其它状态追加行为证据
            }
        }
        verdicts.push({ index: i, text: requirement, status, evidence, suggestion }); // 记录该需求结论
        if (status === 'missing' || status === 'partial') { // 缺失或不完整时
            findings.push({
                level: status === 'missing' ? 'error' : 'warning', // 缺失为 error，不完整为 warning
                where: '需求 #' + String(i + 1), // 定位到需求编号
                message: (status === 'missing' ? '功能未实现：' : '功能不完整：') + requirement, // 问题消息
                evidence, // 依据
            });
        }
    }
    const missing = verdicts.filter(v => v.status === 'missing' || v.status === 'partial'); // 统计缺失/不完整需求
    const implemented = verdicts.filter(v => v.status === 'implemented').length; // 统计已实现需求数
    detail.push('需求实现情况：已实现 ' + String(implemented) + ' 条，未实现/不完整 ' + String(missing.length) + ' 条，无法核对 ' + String(verdicts.filter(v => v.status === 'unchecked').length) + ' 条。'); // 汇总实现情况
    if (missing.length > 0) { // 存在缺失时
        detail.push('以下需求未实现或不完整（已全部列出）：'); // 标题说明
        for (const m of missing) { // 逐条列出
            detail.push('  - [#' + String(m.index + 1) + '] ' + m.text + ' → ' + (m.status === 'missing' ? '缺失' : '部分实现')); // 需求编号、文本与状态
            if (m.evidence)
                detail.push('      依据: ' + m.evidence.slice(0, 200)); // 有依据则列出（截断 200）
            if (m.suggestion)
                detail.push('      建议: ' + m.suggestion.slice(0, 200)); // 有建议则列出（截断 200）
        }
    }
    else { // 无缺失时
        detail.push('所有需求均已找到实现痕迹。'); // 说明全部实现
    }
    if (project.samplingTruncated)
        detail.push('（注意：源码采样受预算限制，结论可能不完整）'); // 采样被截断时提示
    const status = missing.length > 0 ? 'failed' : (verdicts.some(v => v.status === 'unchecked') ? 'partial' : 'passed'); // 汇总状态：有缺失 failed，有无法核对 partial，否则 passed
    return { step: 2, title: '功能完整性核对', status, detail, findings, verdicts, durationMs: Date.now() - started }; // 返回步骤结果
}
//# sourceMappingURL=step2.js.map