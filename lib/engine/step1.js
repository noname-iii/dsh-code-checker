/**
 * 第 1 步：编译 / 运行检查。
 * 有报错 → 直接返回报错信息（后续步骤跳过），且一次性汇报本步收集到的所有错误。
 * @module dsh-code-checker/engine
 *
 * 文件作用：本文件实现检查流程的第 1 步，即对项目执行依赖安装、构建与运行探针，
 * 从命令输出中提取错误（含具体的 文件:行号 定位）并生成检查发现（Finding），
 * 有报错则直接返回报错信息。
 */
import { existsSync } from 'node:fs'; // 引入 existsSync，用于同步判断路径是否存在
import { join } from 'node:path'; // 引入 path.join，用于拼接路径
import { detectProject } from './detect.js'; // 引入项目类型检测函数
/** 错误模式：输出中出现即视为报错。 */
const ERROR_PATTERNS = [
    /\berror\b[^\n]{0,300}/gi, // 匹配“error”及其后最多 300 个非换行字符（忽略大小写）
    /Traceback \(most recent call last\)/i, // 匹配 Python 的 Traceback 起始行
    /Uncaught [A-Za-z]+Error/i, // 匹配“Uncaught XxxError”
    /TypeError:|ReferenceError:|SyntaxError:|RangeError:|AggregateError:/, // 匹配常见 JS 异常类型名后接冒号
    /panic!/i, // 匹配 Rust 的 panic!
    /Compilation failed/i, // 匹配“Compilation failed”
    /Build failed/i, // 匹配“Build failed”
    /ERR_/, // 匹配 Node 的 ERR_ 错误码前缀
    /Segmentation fault/i, // 匹配段错误
    /Command failed with exit code/i, // 匹配“命令失败及退出码”
    /\u672a\u5b9a\u4e49\u7684\u53d8\u91cf|\u8bed\u6cd5\u9519\u8bef|\u7f16\u8bd1\u5931\u8d25/i, // 匹配“未定义的变量 / 语法错误 / 编译失败”
];
/** 常见“文件:行号(:列号)”定位模式（JS 栈、Python Traceback、Rust/Go/C 编译器输出等）。 */
const LOCATION_PATTERNS = [
    /\bat\s+\S+\s+\(([^()\s]+):(\d+)(?::(\d+))?\)/i, // JS 栈帧：at fn (file:line:col)
    /\bat\s+([^()\s]+):(\d+)(?::(\d+))?/i, // JS 栈帧（无括号形式）：at file:line:col
    /File\s+"([^"]+)",\s+line\s+(\d+)/i, // Python：File "x.py", line N
    /-->\s+([^\s:]+):(\d+)(?::(\d+))?/i, // Rust：--> file:line:col
    /([A-Za-z0-9._/\\-]+\.(?:ts|tsx|js|mjs|cjs|jsx|py|rs|go|c|cpp|h|hpp|java|cs|rb|php|vue|svelte)):(\d+)(?::(\d+))?/i, // 编译器输出：file.ext:line(:col)
];
/** 从一行错误文本中解析“文件/行号/列号”定位。 */
function locateError(line) {
    for (const pattern of LOCATION_PATTERNS) { // 逐个尝试定位模式
        const match = pattern.exec(line); // 执行匹配
        if (match) { // 命中
            const file = match[1]; // 文件路径
            const line = match[2] !== undefined ? Number(match[2]) : undefined; // 行号
            const column = match[3] !== undefined ? Number(match[3]) : undefined; // 列号
            if (file && line !== undefined && Number.isFinite(line)) { // 定位有效才返回
                return { file, line, ...column !== undefined && Number.isFinite(column) ? { column } : {} }; // 返回定位
            }
        }
    }
    return {}; // 无法定位
}
/** 把一条定位信息格式化为可读文本（“文件:行号”）。 */
export function formatErrorLocation(error) {
    return error.file !== undefined && error.line !== undefined
        ? error.file + ':' + String(error.line) + (error.column !== undefined ? ':' + String(error.column) : '') // file:line(:col)
        : '(无法定位)';
}
/** 提炼输出中最多 N 条错误片段（含文件:行号定位）。 */
export function extractErrors(stdout, stderr, max = 8) {
    const combined = [stderr, stdout].filter(Boolean).join('\n'); // 将 stderr 与 stdout 去空后合并为一个文本
    const lines = combined.split(/\r?\n/); // 按换行符拆分为行数组
    const errors = []; // 初始化错误结果数组
    for (let i = 0; i < lines.length; i++) { // 遍历每一行
        if (errors.length >= max)
            break; // 达到上限则停止提取
        const line = lines[i] ?? ''; // 当前行
        const match = ERROR_PATTERNS.find(p => p.test(line)); // 查找匹配该行的错误模式
        if (match) { // 若命中某模式
            const text = line.trim().slice(0, 500); // 修剪空白并截取前 500 字符
            if (!text)
                continue; // 空文本跳过
            // 若当前行已含定位直接用；否则看下一行（栈帧往往紧跟错误行）
            const own = locateError(line); // 当前行的定位
            const nextLine = (lines[i + 1] ?? '').trim(); // 下一行（用于补充定位）
            const next = own.file === undefined ? locateError(nextLine) : {}; // 下一行定位（当前行没有时才用）
            const error = {
                text, // 错误文本
                ...own.file !== undefined ? { file: own.file, line: own.line, column: own.column } : {}, // 当前行定位
                ...own.file === undefined && next.file !== undefined ? { file: next.file, line: next.line, column: next.column } : {}, // 补充定位
            };
            const dup = errors.find(e => e.text === text); // 去重检查
            if (!dup)
                errors.push(error); // 非重复才加入
        }
    }
    return errors; // 返回结构化错误数组
}
/** 把结构化错误数组渲染成可读的“文本（文件:行号）”列表。 */
function renderErrors(errors, maxItems = 4) {
    return errors.slice(0, maxItems) // 最多 maxItems 条
        .map(e => e.text + (e.file !== undefined && e.line !== undefined ? '（' + formatErrorLocation(e) + '）' : '')) // 每条加定位
        .join(' | '); // 用 | 分隔
}
/** 执行安装依赖（仅当配置允许且 lockfile 存在、node_modules 缺失时）。 */
async function installDeps(project, opts, io) {
    const findings = []; // 初始化发现数组
    if (!opts.installDeps)
        return findings; // 配置不允许安装则直接返回空
    if (!project.packageJson || !project.lockfile)
        return findings; // 无 package.json 或锁文件则不安装
    if (existsSync(join(opts.projectDir, 'node_modules')))
        return findings; // 已存在 node_modules 则跳过安装
    const npm = io.platform === 'win32' ? 'npm.cmd' : 'npm'; // 根据平台选择 npm 命令名
    let command = npm + ' install --no-audit --no-fund'; // 默认安装命令
    if (project.lockfile === 'npm')
        command = npm + ' ci --no-audit --no-fund'; // npm 锁文件用 ci 精确安装
    if (project.lockfile === 'pnpm')
        command = 'pnpm install --frozen-lockfile'; // pnpm 用 frozen-lockfile 安装
    if (project.lockfile === 'yarn')
        command = 'yarn install --frozen-lockfile'; // yarn 用 frozen-lockfile 安装
    io.log('[第1步] 安装依赖: ' + command); // 记录安装命令日志
    const res = await io.exec({ command, cwd: opts.projectDir, timeoutMs: opts.buildTimeoutMs }); // 执行安装命令
    if (res.exitCode !== 0) { // 若退出码非 0 表示安装失败
        const errors = extractErrors(res.stdout, res.stderr); // 提取结构化错误
        findings.push({
            level: 'error', // 级别为 error
            where: '依赖安装', // 定位到依赖安装阶段
            message: '依赖安装失败（退出码 ' + String(res.exitCode) + '）' + (errors.length > 0 ? '：' + renderErrors(errors, 3) : ''), // 错误消息（含定位）
            evidence: (res.stderr || res.stdout).slice(0, 3000), // 取证为 stderr/stdout 前 3000 字符
        });
    }
    else { // 安装成功
        io.log('[第1步] 依赖安装完成'); // 记录完成日志
    }
    return findings; // 返回发现数组
}
/** 运行一条命令并生成发现。 */
async function runOnce(// 定义执行单条命令的辅助函数
command, // 参数：要执行的命令
cwd, // 参数：执行工作目录
timeoutMs, // 参数：超时时间（毫秒）
stage, // 参数：阶段名称（如“构建”）
io) {
    io.log('[第1步] ' + stage + ': ' + command); // 记录执行日志
    const started = Date.now(); // 记录开始时间
    let res; // 声明执行结果变量
    try { // 尝试执行命令
        res = await io.exec({ command, cwd, timeoutMs }); // 调用 IO 执行命令
    }
    catch (error) { // 执行抛出异常
        const message = error instanceof Error ? error.message : String(error); // 提取异常消息
        return {
            res: { exitCode: -1, signal: null, timedOut: false, aborted: false, stdout: '', stderr: message, durationMs: Date.now() - started }, // 构造异常执行结果
            findings: [{ level: 'error', where: stage, message: '命令执行失败: ' + message }], // 返回错误发现
        };
    }
    if (res.aborted) { // 若命令被取消
        return { res, findings: [{ level: 'info', where: stage, message: '命令被取消' }] }; // 返回信息级发现
    }
    if (res.timedOut) { // 若命令超时
        return {
            res, // 原执行结果
            findings: [{
                    level: 'warning', // 级别为 warning
                    where: stage, // 阶段
                    message: '命令超时（> ' + String(timeoutMs) + 'ms），可能存在卡顿或无响应', // 超时消息
                    evidence: (res.stdout + '\n' + res.stderr).slice(0, 2000), // 取证为输出前 2000 字符
                }], // 发现数组结束
        }; // 返回对象结束
    } // if 结束
    if (res.exitCode !== 0 && res.exitCode !== null) { // 若退出码非 0 且非 null
        const errors = extractErrors(res.stdout, res.stderr, 8); // 提取结构化错误（最多 8 条）
        return {
            res, // 原执行结果
            findings: [{
                    level: 'error', // 级别为 error
                    where: stage, // 阶段
                    message: stage + '失败（退出码 ' + String(res.exitCode) + '）' + (errors.length > 0 ? '：' + renderErrors(errors, 4) : ''), // 失败消息（含最多 4 条错误与文件:行号定位）
                    evidence: (res.stderr || res.stdout).slice(0, 3000), // 取证为 stderr/stdout 前 3000 字符
                }], // 发现数组结束
        }; // 返回对象结束
    } // if 结束
    // 退出码 0 但输出里有错误痕迹
    const errors = extractErrors(res.stdout, res.stderr, 4); // 退出码 0 时再提取最多 4 条错误痕迹
    if (errors.length > 0) { // 若仍有错误痕迹
        return {
            res, // 原执行结果
            findings: [{
                    level: 'warning', // 级别为 warning
                    where: stage, // 阶段
                    message: stage + '完成但输出中包含错误痕迹：' + renderErrors(errors, 3), // 警告消息（含定位）
                    evidence: errors.map(e => e.text).join('\n').slice(0, 2000), // 取证为错误文本拼接前 2000 字符
                }], // 发现数组结束
        }; // 返回对象结束
    } // if 结束
    return { res, findings: [] }; // 无异常则返回空发现
}
/** 运行探针：程序保持存活 runProbeMs 即视为可运行。 */
async function runProbe(// 定义运行探针辅助函数
command, // 参数：要探测的运行命令
opts, // 参数：检查选项
io) {
    const { res, findings } = await runOnce(command, opts.projectDir, opts.runProbeMs, '运行探针', io); // 执行运行探针并解构结果
    const detail = []; // 初始化详情数组
    if (res.timedOut && !res.aborted) { // 若在探针时长内超时且未被取消
        // 探针时长内保持存活 = 能运行
        const tail = (res.stdout + '\n' + res.stderr).trim(); // 合并输出并修剪空白
        detail.push('程序在 ' + String(opts.runProbeMs) + 'ms 探针期间保持运行（视为可运行）'); // 记录保持运行详情
        if (tail)
            detail.push('运行输出（截断）：\n' + tail.slice(-1500)); // 有输出则追加截断后的输出
        return { findings, detail }; // 返回发现与详情
    }
    if (res.exitCode === 0) { // 若退出码为 0
        detail.push('程序正常启动并自行退出（退出码 0）'); // 记录正常退出详情
        const tail = (res.stdout + '\n' + res.stderr).trim(); // 合并输出并修剪空白
        if (tail)
            detail.push('运行输出（截断）：\n' + tail.slice(-1500)); // 有输出则追加截断后的输出
        return { findings, detail }; // 返回发现与详情
    }
    detail.push('程序提前退出（退出码 ' + String(res.exitCode) + '），疑似运行时报错/崩溃'); // 记录提前退出详情
    const tail = (res.stdout + '\n' + res.stderr).trim(); // 合并输出并修剪空白
    if (tail)
        detail.push('运行输出（截断）：\n' + tail.slice(-3000)); // 有输出则追加截断后的输出
    return { findings, detail }; // 返回发现与详情
}
/**
 * 执行第 1 步。
 */
export async function runStep1(opts, io) {
    const started = Date.now(); // 记录开始时间
    const detail = []; // 初始化详情数组
    const findings = []; // 初始化发现数组
    const project = await detectProject(opts.projectDir, io); // 检测项目类型与命令
    detail.push('项目类型: ' + project.kind); // 记录项目类型
    if (project.name)
        detail.push('项目名: ' + project.name); // 有项目名则记录
    if (project.readme)
        detail.push('检测到 README，将在第 3 步作为操作依据。'); // 有 README 则记录提示
    if (io.signal?.aborted) { // 若检查已被取消
        return { step: 1, title: '编译与运行检查', status: 'skipped', detail: ['检查被取消'], findings: [], durationMs: Date.now() - started }; // 返回跳过状态结果
    }
    // 0) 依赖安装
    findings.push(...await installDeps(project, opts, io)); // 执行依赖安装并将发现合并
    // 1) 构建（逐条执行所有构建命令，一次性收集全部错误）
    if (project.buildCommands.length === 0) { // 若没有构建命令
        detail.push('未检测到构建命令（静态/无需构建项目）'); // 记录提示
    }
    for (const command of project.buildCommands) { // 遍历每个构建命令（不再因单条失败而中断）
        const { findings: found } = await runOnce(command, opts.projectDir, opts.buildTimeoutMs, '构建', io); // 执行构建命令
        findings.push(...found); // 合并构建发现
    }
    // 2) 运行探针（构建无 error 才运行；若运行失败同样收集全部探针的错误）
    let ran = false; // 是否已运行探针标记
    if (findings.filter(f => f.level === 'error').length === 0) { // 构建无 error 才运行探针
        if (project.runCommands.length === 0) { // 若无运行命令
            detail.push('未检测到运行命令（纯静态项目）'); // 记录提示
        }
        for (const command of project.runCommands.slice(0, 2)) { // 最多取前 2 条运行命令
            const { findings: found, detail: runDetail } = await runProbe(command, opts, io); // 执行运行探针
            findings.push(...found); // 合并探针发现
            detail.push(...runDetail); // 合并探针详情
            ran = true; // 标记已运行
        }
        if (ran)
            detail.push('运行探针时长: ' + String(opts.runProbeMs) + 'ms'); // 记录探针时长
    }
    const errors = findings.filter(f => f.level === 'error'); // 过滤出 error 级发现
    const status = errors.length > 0 ? 'failed' : (findings.length > 0 ? 'partial' : 'passed'); // 计算步骤状态
    if (status === 'passed')
        detail.push('未发现编译/运行报错。'); // 通过则记录提示
    else if (status === 'failed')
        detail.push('共发现 ' + String(errors.length) + ' 处报错（已全部列出）。'); // 失败时注明已全部列出
    return {
        step: 1, // 步骤编号
        title: '编译与运行检查', // 步骤标题
        status, // 状态
        detail, // 详情
        findings, // 发现
        durationMs: Date.now() - started, // 耗时
    };
}
//# sourceMappingURL=step1.js.map