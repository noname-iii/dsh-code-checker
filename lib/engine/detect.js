/**
 * 项目类型检测：识别语言/框架，推导构建与运行命令。
 * @module dsh-code-checker/engine
 *
 * 文件作用：本文件负责识别项目使用的语言/框架（Node、Python、Rust、Go 等），
 * 并根据项目特征（package.json、锁文件、构建配置等）推导出构建命令与运行命令，
 * 供第 1 步的编译/运行检查使用。
 */
import { promises as fsp } from 'node:fs'; // 引入 node:fs 的 promise 版本接口，用于异步读取文件
import { join } from 'node:path'; // 引入 path.join，用于拼接文件路径
import { hasFile, readReadme, scanProject } from './fs.js'; // 引入文件检测、README 读取、项目扫描辅助函数
async function readJson(dir, name) {
    try { // 尝试读取并解析 JSON
        return JSON.parse(await fsp.readFile(join(dir, name), 'utf8')); // 读取文件内容并解析为对象后返回
    }
    catch { // 读取或解析失败时
        return undefined; // 返回 undefined 表示文件不存在或格式错误
    }
}
async function exists(dir, name) {
    try { // 尝试访问该文件
        await fsp.access(join(dir, name)); // 用 access 检查文件是否可访问
        return true; // 可访问则文件存在，返回 true
    }
    catch { // 访问失败（文件不存在）
        return false; // 返回 false
    }
}
/** 检测项目类型并推导命令。 */
export async function detectProject(dir, io) {
    const pkg = (await readJson(dir, 'package.json')); // 读取 package.json（可能为 undefined）
    const readme = await readReadme(dir); // 读取项目 README 内容
    const base = {
        kind: 'unknown', // 类型默认未知
        name: dir.split(/[\\/]/).filter(Boolean).pop() ?? 'project', // 从目录路径取最后一段作为项目名，取不到则用 'project'
        entryCandidates: [], // 入口候选初始为空数组
        buildCommands: [], // 构建命令初始为空数组
        runCommands: [], // 运行命令初始为空数组
        hasTsConfig: await exists(dir, 'tsconfig.json'), // 检查是否存在 tsconfig.json
        readme, // 保存 README 内容
    };
    const win = io.platform === 'win32'; // 判断是否为 Windows 平台
    const nodeBin = 'node'; // node 可执行文件名
    const pyBin = win ? 'python' : 'python3'; // 按平台选择 Python 命令名
    if (pkg) { // 若存在 package.json
        base.packageJson = pkg; // 保存 package.json 内容
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }; // 合并 dependencies 与 devDependencies 到统一依赖表
        const isElectron = 'electron' in deps; // 判断依赖中是否含 electron
        const scripts = pkg.scripts ?? {}; // 取 scripts（默认为空对象）
        const hasWebFramework = ['vite', 'react', 'vue', 'next', 'nuxt', 'svelte', 'astro', '@angular/core', 'webpack', 'parcel'] // 常见 Web 框架/打包器依赖名列表
            .some(dep => dep in deps); // 判断依赖中是否命中任一 Web 框架/打包器
        const lockfiles = []; // 初始化锁文件类型列表
        if (await exists(dir, 'package-lock.json'))
            lockfiles.push('npm'); // 存在 package-lock.json 则记为 npm
        if (await exists(dir, 'pnpm-lock.yaml'))
            lockfiles.push('pnpm'); // 存在 pnpm-lock.yaml 则记为 pnpm
        if (await exists(dir, 'yarn.lock'))
            lockfiles.push('yarn'); // 存在 yarn.lock 则记为 yarn
        if (await exists(dir, 'bun.lockb'))
            lockfiles.push('bun'); // 存在 bun.lockb 则记为 bun
        base.lockfile = lockfiles[0]; // 取第一个检测到的锁文件类型
        base.kind = isElectron ? 'electron' : (hasWebFramework ? 'node-web' : 'node'); // 类型判定：electron > node-web > node
        // 入口候选
        if (typeof pkg.main === 'string' && pkg.main)
            base.entryCandidates.push(pkg.main); // main 字段为非空字符串则加入入口候选
        if (pkg.bin !== null && pkg.bin !== undefined && typeof pkg.bin === 'object') { // 若 bin 字段是对象
            for (const v of Object.values(pkg.bin)) { // 遍历 bin 对象的每个值
                if (typeof v === 'string' && v)
                    base.entryCandidates.push(v); // 非空字符串值加入入口候选
            }
        }
        for (const name of ['index.js', 'index.mjs', 'src/index.js', 'src/index.ts', 'main.js', 'app.js', 'server.js', 'src/main.js', 'src/app.js']) { // 遍历常见入口文件名列表
            if (await exists(dir, name))
                base.entryCandidates.push(name); // 存在的文件名加入入口候选
        }
        // 构建命令
        if (scripts.build)
            base.buildCommands.push(win ? 'npm run build' : 'npm run build'); // 有 build 脚本则加入构建命令
        else if (base.hasTsConfig)
            base.buildCommands.push(win ? 'npx tsc --noEmit' : 'npx tsc --noEmit'); // 否则若有 tsconfig 则加入 tsc 类型检查命令
        if (scripts.lint)
            base.buildCommands.push(win ? 'npm run lint' : 'npm run lint'); // 有 lint 脚本则加入 lint 命令
        // 运行命令（.ts/.tsx 源文件无法被 node 直接运行，跳过）
        if (scripts.dev)
            base.runCommands.push(win ? 'npm run dev' : 'npm run dev'); // 有 dev 脚本则加入运行命令
        if (scripts.start)
            base.runCommands.push(win ? 'npm start' : 'npm start'); // 有 start 脚本则加入运行命令
        for (const entry of base.entryCandidates.filter(e => !/\.(ts|tsx)$/i.test(e)).slice(0, 3)) { // 取非 .ts/.tsx 的入口候选前 3 个
            base.runCommands.push(win ? nodeBin + ' "' + entry + '"' : nodeBin + " '" + entry + "'"); // 为每个入口生成 node 运行命令（按平台加引号）
        }
    }
    else if (await exists(dir, 'Cargo.toml')) { // 否则若存在 Cargo.toml
        base.kind = 'rust'; // 类型为 rust
        base.buildCommands.push('cargo check'); // 加入 cargo check 构建命令
        base.runCommands.push('cargo run'); // 加入 cargo run 运行命令
    }
    else if (await exists(dir, 'go.mod')) { // 否则若存在 go.mod
        base.kind = 'go'; // 类型为 go
        base.buildCommands.push('go build ./...'); // 加入 go build 构建命令
        base.runCommands.push('go run .'); // 加入 go run 运行命令
    }
    else if (await exists(dir, 'requirements.txt') || await exists(dir, 'pyproject.toml') || await exists(dir, 'setup.py') || await exists(dir, 'Pipfile')) { // 否则若存在任一 Python 项目特征文件
        base.kind = 'python'; // 类型为 python
        base.buildCommands.push(pyBin + ' -m compileall -q .'); // 加入 Python 编译检查命令
        for (const name of ['main.py', 'app.py', 'run.py', 'manage.py', 'src/main.py']) { // 遍历常见 Python 入口文件名
            if (await exists(dir, name)) { // 若文件存在
                base.entryCandidates.push(name); // 加入入口候选
                base.runCommands.push(pyBin + ' "' + name + '"'); // 加入 Python 运行命令
            }
        }
    }
    else if (await exists(dir, 'CMakeLists.txt') || await exists(dir, 'Makefile')) { // 否则若存在 C/C++ 构建文件
        base.kind = 'cpp'; // 类型为 cpp
        if (await exists(dir, 'CMakeLists.txt')) { // 若是 CMake 项目
            base.buildCommands.push('cmake -B build && cmake --build build'); // 加入 cmake 配置并构建命令
        }
        else { // 否则是 Makefile 项目
            base.buildCommands.push('make'); // 加入 make 构建命令
        }
        for (const name of ['app', 'app.exe', 'main', 'main.exe', 'a.out']) { // 遍历常见 C/C++ 产物文件名
            if (await exists(dir, name)) { // 若产物存在
                base.entryCandidates.push(name); // 加入入口候选
                base.runCommands.push(win ? '.\\' + name : './' + name); // 加入按平台前缀的运行命令
            }
        }
    }
    else if (await exists(dir, 'pom.xml') || await exists(dir, 'build.gradle') || await exists(dir, 'build.gradle.kts')) { // 否则若存在 Java 构建文件
        base.kind = 'java'; // 类型为 java
        base.buildCommands.push('mvn -q compile'); // 加入 mvn 编译命令
        base.runCommands.push('mvn -q exec:java'); // 加入 mvn 运行命令
    }
    else if (await exists(dir, 'index.html')) { // 否则若存在 index.html
        base.kind = 'web-static'; // 类型为静态网页
        base.entryCandidates.push('index.html'); // 加入 index.html 入口
    }
    else { // 否则按桌面程序处理
        // 桌面程序：根目录或常见输出目录里的 exe
        const files = await scanProject(dir); // 扫描项目文件列表
        const exes = files.filter(f => /\.exe$/i.test(f.rel)).map(f => f.rel).slice(0, 5); // 过滤 .exe 文件并取相对路径，最多 5 个
        if (exes.length > 0) { // 若存在 exe 文件
            base.kind = 'desktop-exe'; // 类型为桌面程序
            base.entryCandidates.push(...exes); // 将所有 exe 加入入口候选
            base.runCommands.push(...exes.map(e => win ? '.\\' + e : './' + e)); // 为每个 exe 生成按平台的运行命令
        }
    }
    // dotnet 补充判断
    const dotnetFiles = await Promise.all([exists(dir, 'Program.cs'), exists(dir, 'Startup.cs')]); // 并发检查 Program.cs 与 Startup.cs 是否存在
    const sln = (await fsp.readdir(dir).catch(() => [])).some(n => n.endsWith('.sln')); // 读取目录并判断是否存在 .sln 解决方案文件
    if (dotnetFiles.some(Boolean) || sln) { // 若存在 .NET 特征文件
        base.kind = 'dotnet'; // 类型为 dotnet
        base.buildCommands.push('dotnet build'); // 加入 dotnet build 命令
        base.runCommands.push('dotnet run'); // 加入 dotnet run 命令
    }
    // GUI 推断（第 1 层）：项目类型 + 依赖特征。
    // 规则：只要有 GUI（用户操作界面），第 3 步“真实用户模拟”就必须执行，
    // 即使第 2 步发现功能缺失也不跳过。
    const guiDeps = [
        'react', 'react-dom', 'vue', 'svelte', '@angular/core', 'electron', 'vite', // 前端框架与打包器
        'next', 'nuxt', 'astro', 'gradio', 'streamlit', 'nicegui', 'flet', 'eel', // 应用框架 / Python Web-UI 框架
        'pywebview', 'tauri', 'dsh-host-webserver', '@deepseek-ai/dsh-host-webserver', // WebView / DSH 插件 Web 面板
    ];
    const hasGuiDep = pkg ? guiDeps.some(dep => dep in { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }) : false; // 依赖中是否命中 GUI 库
    base.hasGui = ['web-static', 'electron', 'desktop-exe'].includes(base.kind) || hasGuiDep; // 类型自带界面，或依赖命中 GUI 库
    if (base.runCommands.length === 0 && base.kind === 'unknown') { // 若类型未知且没有运行命令
        io.log('未识别出项目类型；第 1 步仅执行通用静态检查。'); // 记录提示日志
    }
    // 去重并清理
    base.entryCandidates = [...new Set(base.entryCandidates)]; // 入口候选去重
    base.buildCommands = [...new Set(base.buildCommands)]; // 构建命令去重
    base.runCommands = [...new Set(base.runCommands)]; // 运行命令去重
    return base; // 返回项目信息
}
/**
 * GUI 检测（第 2 层）：结合项目类型/依赖（第 1 层，见 detectProject 的 hasGui）
 * 与文件清单/源码采样，判定项目是否带用户操作界面以及对应的模拟类型。
 * 规则：第 1、2 步都通过后，带 GUI 的项目第 3 步必须走 GUI 模拟
 * （DSH 插件面板等走 web 模拟，tkinter/PyQt 等桌面框架走 desktop 模拟）。
 */
export function guiSimKind(project, info) {
    // 第 1 层：项目类型与依赖
    if (info.hasGui) { // 类型/依赖已判定有 GUI
        if (info.kind === 'desktop-exe' || info.kind === 'electron')
            return 'desktop'; // 桌面程序
        return 'web'; // 其余（web-static / node-web / GUI 依赖）按 web 模拟
    }
    // 证据：前端界面文件（网页/组件）
    if (project.files.some(f => /\.(vue|jsx|tsx|svelte|html?)$/i.test(f.rel)))
        return 'web'; // 前端源码 → web 模拟
    const content = [...project.samples.values()].join('\n').toLowerCase(); // 全部采样内容合并并小写
    // 证据：DeepSeek Harness 插件面板 / Web UI 框架痕迹
    const webMarkers = [
        'webServer.register', 'ctx.webServer', 'registerFallback', 'installGui', // DSH 插件面板挂载
        'import gradio', 'import streamlit', 'import nicegui', // Python Web-UI 框架
    ];
    if (webMarkers.some(marker => content.includes(marker.toLowerCase())))
        return 'web'; // 命中 web 标记
    // 证据：桌面 GUI 框架痕迹
    const desktopMarkers = [
        'import tkinter', 'from tkinter import', 'PyQt5', 'PySide2', 'PySide6', 'import wx', // Python 桌面框架
        'import kivy', 'import flet', 'pywebview', 'import eel', // Python 桌面/WebView 框架
        'System.Windows.Forms', 'System.Windows', 'Avalonia', 'MAUI', // C# / .NET UI
        'javax.swing', 'javafx', // Java UI
        'egui', 'iced', 'tauri', 'slint', // Rust UI
        'fyne', 'gioui', // Go UI
    ];
    if (desktopMarkers.some(marker => content.includes(marker.toLowerCase())))
        return 'desktop'; // 命中桌面标记
    return 'none'; // 无 GUI 证据
}
/**
 * 提取 GUI 面板路径：从挂载 webServer 路由的源码里收集 path 字符串
 * （如 DSH 插件 gui.ts 中 webServer.register({ path: '/code-checker' })）。
 * 用于 web 模拟时直接访问面板页面，而不是只探测站点根路径。
 */
export function guiPanelPaths(project) {
    const paths = []; // 累积路径
    for (const content of project.samples.values()) { // 遍历采样内容
        if (!content.includes('webServer.register') && !content.includes('installGui'))
            continue; // 非面板挂载文件跳过
        const re = /path\s*:\s*['"]([^'"]+)['"]/g; // 匹配 path: '...' 字面量
        let match; // 单次匹配结果
        while ((match = re.exec(content)) !== null) { // 逐个匹配
            const p = match[1]; // 捕获的路径
            if (p && /^\/[A-Za-z0-9\-_./]*$/.test(p) && !paths.includes(p))
                paths.push(p); // 合法路径且不重复才收集
            if (paths.length >= 4)
                return paths; // 最多 4 个
        }
    }
    return paths; // 返回收集结果
}
/** 判断某相对路径对应的文件是否存在（对外快捷方法）。 */
export function has(relSet, rel) {
    return hasFile(relSet, rel); // 委托 hasFile 辅助函数判断
}
//# sourceMappingURL=detect.js.map