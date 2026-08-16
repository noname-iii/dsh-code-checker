/**
 * 文件作用：报告渲染 —— 把三步检查（编译运行、功能完整性、真实用户模拟）的结果，
 * 渲染成一段可直接回传给 AI 的纯文本报告（支持中文 / 英文两种语言）。
 *
 * 报告渲染：把三步结果渲染成可回传 AI 的文本报告。
 * @module dsh-code-checker/engine
 */
// 步骤状态对应的图标（用于报告中的可视化提示）
const STATUS_ICON = {
    passed: '✅', // 通过
    failed: '❌', // 未通过
    skipped: '⏭️', // 跳过
    partial: '⚠️', // 部分通过
};
// 步骤状态对应的中文文案
const STATUS_TEXT = {
    passed: '通过', // 通过
    failed: '未通过', // 未通过
    skipped: '跳过', // 跳过
    partial: '部分通过', // 部分通过
};
// 项目类型（kind）对应的中文名称映射表
const KIND_TEXT_ZH = {
    node: 'Node.js 项目', 'node-web': 'Node Web 项目', electron: 'Electron 桌面应用', // Node.js 项目、Node Web 项目、Electron 桌面应用
    python: 'Python 项目', rust: 'Rust 项目', go: 'Go 项目', cpp: 'C/C++ 项目', // Python、Rust、Go、C/C++ 项目
    java: 'Java 项目', dotnet: '.NET 项目', 'web-static': '静态 Web 项目', // Java、.NET、静态 Web 项目
    'desktop-exe': 'Windows 桌面程序', unknown: '未知类型项目', // Windows 桌面程序、未知类型项目
};
// 项目类型（kind）对应的英文名称映射表
const KIND_TEXT_EN = {
    node: 'Node.js project', 'node-web': 'Node web project', electron: 'Electron app', // Node.js 项目、Node Web 项目、Electron 应用
    python: 'Python project', rust: 'Rust project', go: 'Go project', cpp: 'C/C++ project', // Python、Rust、Go、C/C++ 项目
    java: 'Java project', dotnet: '.NET project', 'web-static': 'static web project', // Java、.NET、静态 Web 项目
    'desktop-exe': 'Windows desktop program', unknown: 'unknown project', // Windows 桌面程序、未知类型项目
};
// 英文报告中的步骤标题映射表（仅当报告语言为英文时使用）
const STEP_TITLE_EN = {
    1: 'Build & Run Check', // 第 1 步：编译与运行检查
    2: 'Feature Completeness', // 第 2 步：功能完整性核对
    3: 'Real User Simulation', // 第 3 步：真实用户模拟
};
/** 渲染单步结果。 */
function renderStep(step, lang) {
    // 根据语言选择步骤标题：中文用 step.title，英文用 STEP_TITLE_EN 映射（无映射时回退到 step.title）
    const title = lang === 'zh' ? step.title : (STEP_TITLE_EN[step.step] ?? step.title);
    const lines = []; // 用于累积该步骤的每一行输出
    // 输出步骤标题行：分隔线 + 步骤序号 + 标题 + 状态图标 + 状态文案
    lines.push('━━ 第 ' + String(step.step) + ' 步：' + title + ' ' + STATUS_ICON[step.status] + ' ' + STATUS_TEXT[step.status] + ' ━━');
    for (const line of step.detail)
        lines.push('  ' + line); // 逐条输出该步骤的详细说明（缩进两格）
    for (const finding of step.findings) { // 逐条输出该步骤发现的问题
        const levelText = lang === 'zh' // 根据语言把问题级别翻译成文案
            ? (finding.level === 'error' ? '错误' : finding.level === 'warning' ? '警告' : '信息')
            : finding.level; // 英文直接使用原始级别字段
        lines.push('  [' + levelText + '] ' + finding.where + '：' + finding.message); // 输出问题位置与消息
        if (finding.evidence)
            lines.push('    证据: ' + finding.evidence.split('\n').slice(0, 6).join('\n    ')); // 有证据时输出（最多前 6 行）
    }
    return lines.join('\n'); // 把该步骤所有行用换行拼接成一段文本
}
/** 渲染完整报告文本。 */
export function renderReport(report, opts) {
    const lang = opts.language; // 取出报告语言配置（'zh' 或 'en'）
    const kindTable = lang === 'zh' ? KIND_TEXT_ZH : KIND_TEXT_EN; // 根据语言选择项目类型名称表
    const lines = []; // 用于累积报告的每一行输出
    const header = lang === 'zh' // 报告标题（中文 / 英文）
        ? '【代码全面检查报告】'
        : '[Comprehensive Code Check Report]';
    lines.push(header); // 输出报告标题
    // 输出项目名称与类型行（类型名称查表，查不到则直接显示原始 kind）
    lines.push(lang === 'zh' ? '项目: ' + report.projectName + '（' + (kindTable[report.projectKind] ?? report.projectKind) + '）' : 'Project: ' + report.projectName + ' (' + (kindTable[report.projectKind] ?? report.projectKind) + ')');
    lines.push((lang === 'zh' ? '目录: ' : 'Directory: ') + report.projectDir); // 输出项目目录
    lines.push((lang === 'zh' ? '耗时: ' : 'Duration: ') + Math.round(report.durationMs / 1000) + 's'); // 输出总耗时（毫秒换算成秒）
    lines.push(''); // 空行分隔
    for (const step of report.steps) { // 逐步骤渲染
        lines.push(renderStep(step, lang)); // 渲染当前步骤
        lines.push(''); // 步骤之间空行分隔
    }
    lines.push(lang === 'zh' ? '结论：' : 'Conclusion: '); // 输出“结论”标题行
    lines.push(report.summary); // 输出结论正文
    return lines.join('\n'); // 把所有行用换行拼接成最终报告文本
}
//# sourceMappingURL=report.js.map