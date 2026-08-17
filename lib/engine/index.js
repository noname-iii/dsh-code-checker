/**
 * 文件作用：dsh-code-checker 引擎入口 —— 组织并串联“三步流水线”检查：
 *   1. 编译运行检查 —— 有报错直接返回报错信息；
 *   2. 功能完整性核对 —— 全部缺失项一次性汇报；
 *   3. 真实用户模拟 —— 记录卡顿/无响应/报错，无问题返回“没有问题”；
 *      第 3 步在第 1、2 步都通过后执行；项目带 GUI（用户操作界面，含
 *      DeepSeek Harness 插件面板）时必须走 GUI 模拟（web/桌面），CLI 项目走命令模拟。
 * 同时对外导出配置缺省值、配置合并函数、各子步骤函数、类型与工具函数。
 *
 * dsh-code-checker 引擎入口：三步流水线
 *   1. 编译运行检查 —— 有报错直接返回报错信息
 *   2. 功能完整性核对 —— 全部缺失项一次性汇报
 *   3. 真实用户模拟 —— 第 1、2 步通过后执行；有 GUI 的项目必须走 GUI 模拟
 * @module dsh-code-checker/engine
 */
// 引入文件扫描、采样、README 读取等工具函数
import { scanProject, sampleFiles, readReadme } from './fs.js';
import { detectProject } from './detect.js'; // 引入项目类型检测函数
import { runStep1 } from './step1.js'; // 引入第 1 步：编译运行检查
import { runStep2 } from './step2.js'; // 引入第 2 步：功能完整性核对
import { runStep3 } from './step3.js'; // 引入第 3 步：真实用户模拟
import { renderReport } from './report.js'; // 引入报告渲染函数
import { extractRequirements } from './requirements.js'; // 引入需求提取函数
// 以下为对外再导出：把各子模块的公开接口透传给使用方
export * from './types.js'; // 再导出全部类型定义
export * from './fs.js'; // 再导出文件相关工具函数
export * from './detect.js'; // 再导出项目检测函数
export * from './requirements.js'; // 再导出需求提取函数
export { runStep1 } from './step1.js'; // 显式导出第 1 步
export { runStep2 } from './step2.js'; // 显式导出第 2 步
export { runStep3 } from './step3.js'; // 显式导出第 3 步
export { renderReport } from './report.js'; // 显式导出报告渲染函数
/** 配置缺省值。 */
export const DEFAULTS = {
    installDeps: true, // 默认自动安装依赖
    buildTimeoutMs: 180_000, // 构建超时时间（毫秒，180 秒）
    runProbeMs: 8_000, // 运行探针超时时间（毫秒，8 秒）
    simulate: true, // 默认开启真实用户模拟
    runAllSteps: false, // 默认第 1 步失败时不继续执行后续步骤
    useLlm: true, // 默认允许使用 LLM 辅助判断
    maxSampleFiles: 400, // 源码采样文件数上限
    maxSampleBytes: 250_000, // 源码采样字节数上限
    language: 'zh', // 默认报告语言为中文
    cleanMessage: '没有问题', // 无问题时的默认结论文案
};
/** 合并默认配置。 */
export function resolveOptions(partial) {
    return {
        ...DEFAULTS, // 先铺默认值
        requirements: [], // 默认无需求列表（若调用方未提供）
        ...partial, // 再用调用方传入的配置覆盖
    };
}
/** 汇总报告结论。 */
function summarize(report, opts) {
    const errors = report.issues.filter(i => i.level === 'error'); // 统计所有错误级问题
    const warnings = report.issues.filter(i => i.level === 'warning'); // 统计所有警告级问题
    const missing = report.missingFeatures; // 取缺失/不完整的需求列表
    const anomalies = report.anomalies.filter(a => a.kind !== 'warning'); // 取非警告类的模拟异常
    const zh = opts.language === 'zh'; // 判断是否输出中文
    if (errors.length === 0 && missing.length === 0 && anomalies.length === 0) { // 无错误、无缺失、无非警告异常时
        if (warnings.length > 0) { // 存在警告时：整体通过但需知悉警告
            return {
                ok: true, // 结论为通过
                summary: zh // 中文/英文两种文案
                    ? '整体没有发现错误：编译运行正常，功能完整，用户模拟无异常。存在 ' + String(warnings.length) + ' 条警告（见上方详情），请知悉。 ' + opts.cleanMessage
                    : 'No errors found: builds and runs, all features implemented, no anomalies during simulation. ' + String(warnings.length) + ' warning(s) listed above. ' + opts.cleanMessage,
            };
        }
        return {
            ok: true, // 结论为通过
            summary: zh // 中文/英文两种文案
                ? '编译运行正常，所有需求均已实现，用户模拟未发现卡顿、无响应或报错。' + opts.cleanMessage
                : 'Builds and runs, all requirements implemented, simulation found no freeze/unresponsive/error. ' + opts.cleanMessage,
        };
    }
    const parts = []; // 用于累积各类问题的中文/英文描述片段
    // 按步骤统计错误，避免把第 2 步的缺失功能误报成第 1 步的编译错误
    const stepErrorCount = (step) => report.steps // 统计某一步的错误级发现数量
        .find(s => s.step === step)?.findings.filter(f => f.level === 'error').length ?? 0;
    const [errors1, errors2, errors3] = [stepErrorCount(1), stepErrorCount(2), stepErrorCount(3)]; // 三步各自的错误数
    if (errors1 > 0)
        parts.push(zh ? '第 1 步（编译/运行）发现 ' + String(errors1) + ' 处报错' : 'Step 1 (build/run): ' + String(errors1) + ' error(s)'); // 第 1 步报错
    if (missing.length > 0)
        parts.push(zh ? '有 ' + String(missing.length) + ' 条需求未实现或不完整' : String(missing.length) + ' requirement(s) missing/partial'); // 功能缺失
    if (errors2 > missing.length)
        parts.push(zh ? '第 2 步（功能核对）另发现 ' + String(errors2 - missing.length) + ' 处错误' : 'Step 2 (completeness): ' + String(errors2 - missing.length) + ' other error(s)'); // 第 2 步除缺失外的其他错误
    if (errors3 > 0)
        parts.push(zh ? '第 3 步（用户模拟）发现 ' + String(errors3) + ' 处报错' : 'Step 3 (simulation): ' + String(errors3) + ' error(s)'); // 第 3 步报错
    else if (anomalies.length > 0)
        parts.push(zh ? '用户模拟发现 ' + String(anomalies.length) + ' 处异常' : String(anomalies.length) + ' anomaly(ies) in simulation'); // 模拟异常
    return {
        ok: false, // 存在问题时结论为未通过
        summary: (zh ? '发现以下问题：' : 'Issues found: ') + parts.join('；') + (zh ? '。请修复后重新检查。' : '. Please fix and re-check.'), // 拼接所有问题描述
    };
}
/**
 * 执行完整三步检查。
 * @param opts - 检查配置（projectDir 必填）
 * @param io - IO 适配器（exec / start / analyzer / log / platform）
 */
export async function runCheck(opts, io) {
    const startedAt = new Date().toISOString(); // 记录检查开始的 ISO 时间戳
    const overallStarted = Date.now(); // 记录检查开始的时间戳（用于计算总耗时）
    io.log('开始全面检查: ' + opts.projectDir); // 输出开始检查的日志
    const projectInfo = await detectProject(opts.projectDir, io); // 检测项目类型与运行方式
    const files = await scanProject(opts.projectDir); // 扫描项目文件
    const project = await sampleFiles(files, opts.maxSampleFiles, opts.maxSampleBytes); // 按预算对文件内容采样
    const readme = opts.readme ?? projectInfo.readme ?? await readReadme(opts.projectDir); // 读取 README（优先用配置，其次检测结果，最后实际读取）
    const requirementText = opts.requirementText ?? opts.requirements.join('\n'); // 需求文本：优先配置文本，否则拼接需求列表
    const requirements = opts.requirements.length > 0 ? opts.requirements : extractRequirements(requirementText); // 需求列表：已有则直接用，否则从文本提取
    const steps = []; // 累积每一步的结果
    const issues = []; // 累积所有步骤发现的问题
    const allVerdicts = []; // 累积第 2 步的需求核对结论
    // ── 第 1 步：编译运行 ──
    const step1 = await runStep1(opts, io); // 执行第 1 步
    steps.push(step1); // 记录第 1 步结果
    for (const f of step1.findings)
        issues.push(f); // 把第 1 步的问题并入总问题列表
    const step1Failed = step1.status === 'failed'; // 判断第 1 步是否失败
    // ── 第 2 步：功能完整性（第 1 步失败时按用户流程直接返回）──
    let step2; // 第 2 步结果（可能不执行）
    let step3; // 第 3 步结果（可能不执行）
    const canProceed = !step1Failed || opts.runAllSteps; // 是否继续执行后续步骤（第 1 步未失败，或配置要求全跑）
    if (canProceed) { // 可以继续时执行第 2 步
        step2 = await runStep2(requirements, project, projectInfo, opts, io); // 执行第 2 步
        steps.push(step2); // 记录第 2 步结果
        allVerdicts.push(...(step2.verdicts ?? [])); // 收集第 2 步的需求核对结论
        for (const f of step2.findings)
            issues.push(f); // 把第 2 步的问题并入总问题列表
    }
    else { // 第 1 步失败且不允许全跑时，跳过第 2 步
        step2 = {
            step: 2, title: '功能完整性核对', status: 'skipped', // 跳过状态
            detail: ['第 1 步发现编译/运行报错，按流程直接返回报错信息，跳过本步。'], // 说明跳过原因
            findings: [], durationMs: 0, // 无问题、耗时 0
        };
        steps.push(step2); // 记录跳过的第 2 步结果
    }
    // ── 第 3 步：真实用户模拟（第 1、2 步都通过后执行；有 GUI 的项目在 step3 内强制走 GUI 模拟）──
    const step2Clean = !step2 || step2.status !== 'failed'; // 第 2 步是否“干净”（未失败或未执行）
    if (canProceed && step2Clean) { // 可继续且第 2 步干净时执行第 3 步
        step3 = await runStep3(requirementText + '\n\n' + (readme ?? ''), projectInfo, opts, io, project); // 执行第 3 步（传入需求文本 + README + 项目采样，供 GUI 判定）
        steps.push(step3); // 记录第 3 步结果
        for (const f of step3.findings)
            issues.push(f); // 把第 3 步的问题并入总问题列表
    }
    else if (canProceed && step2 && !step2Clean) { // 第 2 步有未实现/不完整功能时跳过第 3 步
        step3 = {
            step: 3, title: '真实用户模拟', status: 'skipped', // 跳过状态
            detail: ['存在未实现/不完整的功能，按流程先汇报缺失功能，跳过本步。'], // 说明跳过原因
            findings: [], durationMs: 0, // 无问题、耗时 0
        };
        steps.push(step3); // 记录跳过的第 3 步结果
    }
    else { // 第 1 步失败导致跳过第 3 步
        step3 = {
            step: 3, title: '真实用户模拟', status: 'skipped', // 跳过状态
            detail: ['第 1 步发现编译/运行报错，按流程直接返回报错信息，跳过本步。'], // 说明跳过原因
            findings: [], durationMs: 0, // 无问题、耗时 0
        };
        steps.push(step3); // 记录跳过的第 3 步结果
    }
    const missingFeatures = allVerdicts.filter(v => v.status === 'missing' || v.status === 'partial'); // 汇总所有缺失/不完整需求
    const anomalies = (step3?.anomalies ?? []); // 取第 3 步的异常列表（未执行则为空）
    const report = {
        ok: false, // 先占位 false，后续由 summarize 覆写
        projectDir: opts.projectDir, // 项目目录
        projectKind: projectInfo.kind, // 项目类型
        projectName: projectInfo.name, // 项目名称
        startedAt, // 开始时间
        durationMs: Date.now() - overallStarted, // 总耗时
        steps, // 各步骤结果
        issues, // 全部问题
        verdicts: allVerdicts, // 需求核对结论
        missingFeatures, // 缺失/不完整需求
        anomalies, // 模拟异常
        summary: '', // 占位，后续由 summarize 覆写
        rendered: '', // 占位，后续由 renderReport 覆写
    };
    const conclusion = summarize(report, opts); // 汇总结论（ok 与 summary）
    report.ok = conclusion.ok; // 回填 ok
    report.summary = conclusion.summary; // 回填 summary
    report.rendered = renderReport(report, opts); // 渲染报告文本
    io.log('检查完成: ' + (report.ok ? '没有问题' : '发现问题 ' + String(report.issues.filter(i => i.level === 'error').length) + ' 处错误')); // 输出完成日志
    return report; // 返回完整报告
}
//# sourceMappingURL=index.js.map