# dsh-code-checker · 代码全面检查插件

适用于 **DeepSeek Harness** 的插件：当 AI 写完代码/项目后，自动对项目执行**三步全面检查**，把发现的问题直接回传给 AI 让它修复，直到返回 **“没有问题”**。可选 GUI 检查面板；并提供独立 CLI / MCP 服务，可接入 **Trae、Qoder、Cursor、Claude Desktop** 等任何平台。

[English](README.md) | [中文](README.zh.md)

---

## 目录

1. [它能做什么](#它能做什么)
2. [安装前准备（Node.js / pnpm / git / DeepSeek Harness）](#安装前准备nodejs--pnpm--git--deepseek-harness)
3. [下载插件](#下载插件)
4. [安装到 DeepSeek Harness](#安装到-deepseek-harness)
5. [验证安装是否成功](#验证安装是否成功)
6. [使用方式](#使用方式)
7. [配置项](#配置项)
8. [其他平台（Trae / Qoder / Cursor …）](#其他平台trae--qoder--cursor-)
9. [try_it_out：下载后的快速自测](#try_it_out下载后的快速自测)
10. [项目架构（每个文件的作用）](#项目架构每个文件的作用)
11. [开发者指南（从源码构建）](#开发者指南从源码构建)
12. [自检与测试](#自检与测试)
13. [常见 Q&A](#常见-qa)
14. [已知边界](#已知边界)
15. [安全说明](#安全说明)

---

## 它能做什么

### 三步检查流水线

| 步骤 | 内容 | 结果处理 |
|---|---|---|
| **第 1 步 编译与运行检查** | 识别项目类型（Node/Python/Rust/Go/C++/Java/.NET/静态 Web/Electron/桌面 exe），安装依赖、逐条执行**所有**构建命令、启动运行探针，收集所有报错 | 有报错 → **直接把具体报错信息返回给 AI**（含出错位置“文件:行号”、错误原因），并**一次性列出本步收集到的全部错误**，不再进行后续步骤 |
| **第 2 步 功能完整性核对** | 读取用户提示词/上下文中的**全部**需求，逐条核对是否实现（启发式关键词/文件结构检查 + 可选 LLM 深度分析 + **行为验证：模拟用户真实打开项目——web 用 Playwright 抓取渲染后页面文本、CLI 跑 --help/--version，看“运行后所见”是否包含该功能**） | 有缺失 → 继续检查到底，**一次性汇报所有未实现/不完整的功能**；全部实现才进入第 3 步 |
| **第 3 步 真实用户模拟** | **先运行项目自动化测试**（Node 项目跑 `pnpm test`；非 Node 项目跑等价测试命令，如 `cargo test`/`go test ./...`/`pytest`/`mvn test`/`dotnet test`），测试失败即记录报错；再按用户描述的功能（或 README.md）模拟真实用户：Web 用 Playwright 点击/输入/拖拽/按键，并**自动逐页审计**（对访问到的每个页面检查是否一直卡在某个页面、或卡在“加载中”等加载指示）与**遍历点击页面上所有按钮**（逐个点击并记录每个按钮点击后的状态/异样）；Windows 桌面程序用 UIA 真实鼠标键盘 + 卡死检测 + 截图；CLI 用命令驱动；记录**卡顿、无响应、报错、崩溃**。**第 1、2 步都通过后执行；只要项目带 GUI（用户界面，如 DSH 插件面板/网页/桌面窗口），第 3 步必须走 GUI 模拟，绝不退化成 CLI 模拟** | 有异常 → 全部记录并汇报给 AI；无异常 → 返回 **“没有问题”** 并让 AI 继续工作 |

### 触发方式（Harness 内）—— 双保险，两种方式同时生效

- **方式一：追加系统提示词（只追加、绝不删除任何既有提示词）**。插件通过 systemPrompt.section 在系统提示词的“工具引导带”内追加一段说明（order 180，位于工具声明之后）：告诉 AI **“写完代码/项目后请主动调用 check_project 工具做全面检查，并依据报告修复所有问题，直到返回没有问题”**。这段文字是纯追加式注册，不修改、不覆盖任何原有提示词；随插件卸载自动移除。可通过配置 promptSection: false 关闭、promptSectionText 自定义文案。
- **方式二：轮次关闭自动检查 + 自动修复闭环（兜底）**：即使 AI 忘了调用 check_project，插件也会在 AI 每轮编码（写文件/跑命令）结束的轮次关闭检查点（agent/turn-stopping，被机器 await 的串行检查点）**主动**执行三步检查并把报告 steer 回 AI（报告保证在本轮边界提交前送达，并附带“修复后再调用 check_project 验证”的指令）。AI 修复会产生新的编码活动，于是**下一次轮次关闭检查点会再次自动检查** —— 自动形成“检查 → 报告 → 修复 → 再检查”闭环，直到返回“没有问题”或达到每用户提示的上限（默认 6 次，防死循环，可配置）。
- **/check 斜杠命令**：随时手动检查（可附加项目目录与需求文本）。
- **check_project 模型工具**：AI 可主动调用，结果直接作为工具结果返回。
- **GUI 面板**：浏览器打开 http://127.0.0.1:3080/code-checker/，顶部有“状态 / 画面”两个视图——**状态**显示历史检查报告（与旧版一致）；**画面**左侧列出工作区中所有正在被 AI 修改的项目，右侧分为**命令行 / GUI / log** 三栏：命令行显示测试时输入的命令与运行结果，GUI 显示测试时的真实操作（web 项目会模拟浏览器真实用户操作并在此展示，无界面则显示“无”），log 显示测试时的日志（与 Web GUI 同源，无需额外端口）。
- **审批系统通知**：当某个会话需要用户操作（例如让用户决策是否运行某条命令）时，在 Windows/macOS/Linux **系统层面弹桌面通知**，通知含“哪个会话 + 具体命令 + 运行/不运行选项”，并原样把决定权交还给 Harness（绝不替你自动放行）。可用 `notifyApprovals: false` 关闭。

---

## 安装前准备（Node.js / pnpm / git / DeepSeek Harness）

本插件是 **DeepSeek Harness（`dsh`）** 的插件。安装插件之前，请**按顺序**准备好下面四样东西；
每一步都给了 **Windows / macOS / Linux** 的做法，**任选其一即可**，不需要三样都装。

### ① Node.js（必须）

- **版本要求**：Node **22 LTS**（≥ 22.19.0）或 **24 及以上**。
  - 原因：DeepSeek Harness 主机要求 `^22.19.0 || >=24.0.0`，本插件要求 `>=20`，两者取交集 → **装 22 LTS 最稳妥**。
- **先确认是否已装好**：打开终端执行 `node -v` 与 `npm -v`，能打印出 `v22.x` / `v10.x` 这种版本号就是已装好，可跳到第 ② 步。

| 系统 | 安装方法（任选其一） |
|---|---|
| **Windows** | ① 官网图形安装：打开 <https://nodejs.org/zh-cn/> → 下载 **LTS** 版 `.msi` → 双击 → 一路「下一步」（保持默认勾选 *Add to PATH*）→ **关闭后重新打开终端** → 执行 `node -v`。<br>② 命令行（winget）：`winget install OpenJS.NodeJS.LTS` |
| **macOS** | ① 官网图形安装：打开 <https://nodejs.org/> → 下载 **LTS** 版 `.pkg` → 双击安装。<br>② Homebrew：`brew install node@22`（装完按 brew 提示可能要把 node 加入 PATH，之后执行 `node -v`） |
| **Linux（Debian/Ubuntu）** | ① NodeSource 仓库：`curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt-get install -y nodejs`。<br>② nvm（通用，见下方说明） |

> **nvm 通用装法**（Windows/macOS/Linux 都能用，方便以后切换 Node 版本）：
>
> ```bash
> curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
> # 关闭并重新打开终端，然后：
> nvm install 22
> nvm use 22
> node -v        # 应打印 v22.x
> ```
>
> （nvm 的版本号 `v0.40.1` 可随时去 <https://github.com/nvm-sh/nvm> 查最新；Windows 用户也可用
> [nvm-windows](https://github.com/coreybutler/nvm-windows) 代替。）

### ② pnpm（必须，`dsh plugin add` 内部要用）

- **为什么必须装**：`dsh plugin --profile web add/remove/update ...` 这条命令的底层，是 dsh 把参数**原样转发给 pnpm** 在 profile 目录里执行（见 DeepSeek Harness 官方 CLI 文档）。所以 **pnpm 必须能在终端直接调用（即在 PATH 上）**，否则装插件会报「pnpm not found」。
- **安装**（装好 Node 之后，任选其一）：

```bash
npm install -g pnpm
# 或者用 Node 自带的 corepack：
corepack enable && corepack prepare pnpm@latest --activate
```

- **确认**：执行 `pnpm -v`，能打印版本号即成功。

### ③ git（仅「git 克隆 / GitHub 直装」两种下载方式需要）

- 如果你打算只用「npm 包直装」或「release 离线 tarball」，**这一步可以跳过**。
- **安装**：

| 系统 | 命令 / 操作 |
|---|---|
| **Windows** | 打开 <https://git-scm.com/download/win> → 下载安装程序 → 一路默认安装 |
| **macOS** | `brew install git`（或 `xcode-select --install`，Xcode 命令行工具自带 git） |
| **Linux（Debian/Ubuntu）** | `sudo apt install git` |
| **Linux（Fedora）** | `sudo dnf install git` |

- **确认**：执行 `git --version`。

### ④ DeepSeek Harness（`dsh` 命令）

- **这是插件的宿主**，后面所有 `dsh web` / `dsh plugin ...` 命令都由它提供。
- **三种装法任选其一**：

```bash
# 方式 A（推荐）：全局安装，装完终端里就有 `dsh` 命令
npm install -g @deepseek-ai/dsh
dsh web          # 启动 Web UI，默认地址 http://127.0.0.1:3080

# 方式 B（不想装全局）：用 npx，每条命令前加 npx @deepseek-ai/dsh
npx @deepseek-ai/dsh web
npx @deepseek-ai/dsh plugin --profile web add ...

# 方式 C（从源码跑，开发者用）：
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

> 说明：`web` / `headless` 两个 profile 在**首次使用时会自动初始化**（`web` = base + web-app 模板），
> 所以第一次执行 `dsh plugin --profile web add ...` 前无需手动创建 profile。
> 另外，启动 `dsh web` 后，请先在网页 **设置 → 模型** 填入你的 API Key 并保存（否则 AI 会话无法运行）。

---

## 下载插件

> **最新 release：v0.5.0**（已发布于 GitHub Releases，含离线 tarball 附件
> `dsh-code-checker-0.5.0.tgz`）。下载地址：
> <https://github.com/noname-iii/dsh-code-checker/releases/latest>
> 已装过旧版本？见下方 [FAQ](#常见-qa) 第 15 条（无需重新克隆，重装/更新即可）。

下面 **四种方式任选其一**。注意：方式 2 / 3 / 4 依赖上面的 `dsh` 与 `pnpm`；方式 1 只依赖 `git`。**方式 2（npm）是首选**——无需 git、无需 SSH key、无需本地路径。

> ⚠️ **本地目录安装的坑（务必先看）**：给 `dsh plugin add` 传**本地路径**时，要写**完整绝对路径**
> （如 `/Users/yang/dsh-code-checker`），**不要写 `~` 简写**——尤其不要写带引号的 `"~/xxx"`，因为引号里的 `~`
> 不会被终端展开；pnpm 收到“含 `/` 却又不是真实路径”的字符串时，会把它当成
> `git+ssh://git@github.com/...` 去 clone，于是报 `Permission denied (publickey)`。
> 想省事就用 `$HOME/xxx`，或不加引号让 `~` 自己展开；**最省事的是直接用方式 2（npm 直装）**。

### 方式 1：git 克隆（想看源码 / 改代码 / 本地调试，推荐）

```bash
git clone https://github.com/noname-iii/dsh-code-checker dsh-code-checker
cd dsh-code-checker
```

> 克隆下来的项目**已附带构建好的 `lib/` 产物**，无需 `npm install`、无需 TypeScript，
> 放到任何目录都能直接用。完成后直接看下一节「安装到 DeepSeek Harness」。

### 方式 2：npm 包直装（首选 · 最简单，无需 git、无需 SSH、无需本地路径）

```bash
dsh plugin --profile web add dsh-code-checker
```

### 方式 3：GitHub 直装（免 clone，pnpm 会自动拉取仓库）

```bash
dsh plugin --profile web add github:noname-iii/dsh-code-checker
```

> 首次用 git / github 直装时，pnpm ≥10 会要求**允许运行 `prepare` 构建脚本**：
> 按提示把包名加入 profile 目录下 `pnpm-workspace.yaml` 的 `allowBuilds` 后重装即可。
> 本项目 `prepare` 是安全的：只在 `lib/` 缺失或过旧时才调用 TypeScript 重建（详见开发者指南）。

### 方式 4：release 离线 tarball（无法访问 GitHub / npm 的机器）

1. 到 <https://github.com/noname-iii/dsh-code-checker/releases/latest> 下载附件 `dsh-code-checker-0.5.0.tgz`。
2. 在终端 `cd` 到该文件所在目录，执行：

```bash
dsh plugin --profile web add ./dsh-code-checker-0.5.0.tgz
```

> 想自己打 tarball 也可以（效果等价于方式 4）：在插件目录里执行
>
> ```bash
> pnpm pack    # 生成 dsh-code-checker-0.5.0.tgz
> dsh plugin --profile web add ./dsh-code-checker-0.5.0.tgz
> ```

---

## 安装到 DeepSeek Harness

> 前提：已完成「安装前准备」并至少完成「下载插件」中的一种方式。
> **关键提醒**：bundle 安装 / 更新后，**必须重启 `dsh web` 才生效** —— 插件行列表只在启动时读取，
> 运行中的实例不会热加载新安装的 bundle。

### 方式 A：安装为插件束（推荐，一次安装处处可用）

```bash
# 若你用的是「git 克隆」（下载方式 1），从本地目录安装：
# ⚠️ 路径写「完整绝对路径」，别写 ~ 简写（尤其别加引号），否则会被当成 GitHub SSH 地址报 Permission denied。
dsh plugin --profile web add "<插件目录>"
#   Windows 例：     dsh plugin --profile web add "D:\tools\dsh-code-checker"
#   macOS/Linux 例： dsh plugin --profile web add "$HOME/dsh-code-checker"
#                    dsh plugin --profile web add /Users/yang/dsh-code-checker

# 若你用的是 npm / github / tarball 直装（下载方式 2/3/4），其实上面已经装好了，直接启动：
dsh web
```

> **`~/xxx` 为什么会报 `Permission denied (publickey)`？** 因为 `"~/xxx"` 里的 `~` 不展开，pnpm 把
> 这段“含 `/` 却非真实路径”的字符串解析成 `git+ssh://git@github.com/~/xxx.git`，走 SSH 去 clone。
> 对策：写完整路径 `/Users/yang/...`，或 `$HOME/...`，或不加引号的 `~/...`；也可以直接用方式 2（npm）。

- 安装完成后**无需任何额外配置**，插件自动生效。
- 启动后控制台应出现 `[dsh-code-checker] dsh-code-checker 已加载…`；浏览器打开
  <http://127.0.0.1:3080/code-checker/> 应能看到检查面板。

### 方式 B：--patch 覆盖层（免安装，适合临时试用）

用任意文本编辑器打开 `examples/web-overlay.yml`，把其中的 `<插件绝对路径>` 替换为本插件目录的绝对路径：

- **Windows** 必须用 `file:///` 形式（loader 直接 import 非相对名字时要求合法 URL）：

  ```yaml
  name: 'file:///D:/你的目录/dsh-code-checker/lib/src/index.js'
  ```

- **macOS / Linux** 用普通绝对路径：

  ```yaml
  name: '/home/你/dsh-code-checker/lib/src/index.js'
  ```

然后：

```bash
# 已全局安装 dsh：
dsh web --patch "<插件目录>/examples/web-overlay.yml"
# 从源码跑 Harness（开发者）：
pnpm dsh web --patch "<插件目录>/examples/web-overlay.yml"
```

---

## 验证安装是否成功

装好后，用下面**任一种**方式确认插件真的能工作（这些自测都**不需要 API Key**）：

```bash
# 方式 1（推荐，一步到位）：跑 try_it_out 自测，5 个示例项目逐个验证
powershell -ExecutionPolicy Bypass -File try_it_out/run-tests.ps1   # Windows
bash try_it_out/run-tests.sh                                        # macOS / Linux

# 方式 2：验证「下载到任意目录都能用 + 无本机路径/密钥残留」（可移植性检查）
node scripts/portable-check.mjs

# 方式 3：直接用 CLI 检查一个健康示例，应输出「没有问题」且退出码为 0
node lib/cli/index.js check try_it_out/healthy-cli --no-install --no-llm
```

- 预期：健康项目返回 **「没有问题」**，构建失败项目返回报错，功能缺失项目一次性列出全部缺失功能。
- 自测全部通过，就说明插件在当前机器上**下载、解压、运行全部正常**，可以放心使用。

---

## 使用方式

| 方式 | 操作 | 说明 |
|---|---|---|
| 自动 | 无需操作 | 在会话里让 AI 写代码/跑命令，本轮结束时自动检查并回传报告 |
| 斜杠命令 | 输入 /check | 手动检查当前项目；可加参数：/check <目录> <附加需求文本> |
| 模型工具 | 让 AI 调用 check_project | AI 可随时自检，报告直接作为工具结果返回 |
| GUI | 打开 http://127.0.0.1:3080/code-checker/ | 顶部“状态/画面”两栏：状态=历史报告与详情；画面=各项目 + 命令行/GUI/log 测试画面 |

---

## 配置项

在 profile 的 cordis.patch.yml（或安装 bundle 时在用户层）按行 id 覆写。全部有默认值（见 src/config.ts）：

    - id: code-checker
      config:
        enabled: true               # 是否启用插件
        autoCheck: true             # 编码轮次后自动检查
        maxAutoChecksPerPrompt: 6   # 每用户提示的自动检查上限（修复-检查闭环的上限，防死循环）
        minCodingCalls: 1           # 触发检查所需的最小编码工具调用数
        codingTools: [write, edit, str-replace, run_code, bash, pwsh, terminal, workflow, subagent, subagent_fork]
        installDeps: true           # 有锁文件且缺 node_modules 时安装依赖
        buildTimeoutMs: 180000      # 构建超时（毫秒）
        runProbeMs: 8000            # 运行探针时长（毫秒）
        simulate: true              # 是否执行第 3 步用户模拟
        useLlm: true                # 第 2/3 步是否用 LLM 深度分析（走会话模型）
        reportToAi: steer           # 报告回传 AI 方式：steer | inject | none
        gui: true                   # 是否挂载 /code-checker/ 面板
        language: zh                # 报告语言：zh | en
        cleanMessage: 没有问题      # 检查干净时回传 AI 的文案
        maxReportChars: 20000       # 回传报告长度上限（超长截断）
        maxStoredReports: 100       # GUI 保存的报告份数
        maxSampleBytes: 250000      # 源码采样字节预算
        maxSampleFiles: 400         # 源码采样文件数上限
        artifactDir: ''             # 模拟产物目录（空=系统临时目录）
        defaultDir: ''              # 会话无 cwd 时的默认检查目录（空=进程目录）
        promptSection: true         # 是否追加“写完代码后主动调用 check_project”提示词段（只追加不删除）
        notifyApprovals: true       # 会话需要用户操作时在系统层面发桌面通知（含会话/命令/选项）
        promptSectionText: 你完成代码/项目的编写或修改后，请主动调用 check_project 工具对当前项目做一次全面检查；收到检查报告后，请修复报告中的所有问题（编译错误、缺失功能、卡顿/报错等），修复后再调用一次 check_project 直到返回“没有问题”。 # 提示词段内容

---

## 其他平台（Trae / Qoder / Cursor …）

插件核心引擎（lib/engine）与 Harness 完全解耦，附带两个独立入口：

### 1) 独立 CLI（任何 IDE 的钩子都能调用）

    node <插件目录>/lib/cli/index.js check <项目目录>       --requirements 需求.txt --no-install --json
    # 退出码：0 = 没有问题；1 = 发现问题；2 = 用法错误

未指定 --requirements 时自动读取项目内的 需求.txt / requirements.txt / REQUIREMENTS.md。
完整选项：node lib/cli/index.js（打印用法）。

### 2) MCP 服务（原生接入 IDE）

在 Trae / Qoder / Cursor / Claude Desktop 的 MCP 配置中加入（把 <插件目录> 换成实际路径）：

    {
      "mcpServers": {
        "code-checker": {
          "command": "node",
          "args": ["<插件目录>/lib/cli/index.js", "mcp"],
          "env": {
            "CODE_CHECK_LLM_BASE_URL": "https://api.deepseek.com/v1",
            "CODE_CHECK_LLM_API_KEY": "你的 key",
            "CODE_CHECK_LLM_MODEL": "deepseek-chat"
          }
        }
      }
    }

暴露工具：check_project、detect_project。（LLM 环境变量可选；不配则用启发式分析。）

---

## try_it_out：下载后的快速自测

下载插件后，用 try_it_out/ 里的 5 个示例项目验证插件工作正常（无需任何安装、无需 API key）：

    # Windows (PowerShell)
    powershell -ExecutionPolicy Bypass -File try_it_out/run-tests.ps1
    # macOS / Linux
    bash try_it_out/run-tests.sh

详细说明与逐个手动运行的方法见 try_it_out/README.md。

---

## 项目架构（每个文件的作用）

    <插件根目录>/
    ├─ cordis.patch.yml         插件束配置层：声明把本插件插入 dsh 配置树（bundle 安装时生效）
    ├─ package.json             npm 清单：exports（. / ./engine / ./cli）、bin、dsh.bundle 声明、
    │                           files 白名单（决定发布哪些文件）、scripts（build/test/selfcheck/prepare）
    ├─ 需求.txt                 本插件自己的“用户需求”文档 —— 自检第 2 步的依据（吃自己的狗粮）
    ├─ tsconfig.json            TypeScript 类型检查配置（开发用；extends 本机生成的 paths 文件）
    ├─ tsconfig.build.json      构建配置（产出 lib/，带声明与 sourcemap）
    ├─ tsconfig.paths.json      本机 @deepseek-ai/* 类型路径映射（由 gen-tsconfig 生成；仓库内为空版本）
    │
    ├─ src/                     ── Harness 插件层（与 deepseek-harness 交互）──
    │  ├─ index.ts              插件入口 apply()：装配配置、跟踪器、命令、工具、GUI 与检查执行
    │  ├─ config.ts             插件配置 Schema（schemastery）+ 默认值（DEFAULT_CONFIG）
    │  ├─ tracker.ts            会话跟踪器：统计编码活动、在 turn-stopping 检查点自动触发检查并支持“检查→修复→再检查”闭环（防循环上限）
    │  ├─ runner.ts             IO 适配器：把 ctx.shell / ctx.llm 适配成引擎的 exec/start/analyzer
    │  ├─ feedback.ts           报告回传：把报告文本以插件上下文消息 steer/inject 给 AI
    │  ├─ commands.ts           /check 斜杠命令（人机命令面，结果不进模型历史）
    │  ├─ tool.ts               check_project 模型工具（AI 可主动调用）
    │  └─ gui.ts                GUI：/code-checker/ 面板（顶部“状态/画面”两视图；状态=报告列表，画面=项目列表 + 命令行/GUI/log 三面板）
    │
    ├─ engine/                  ── 检查引擎（与框架无关，仅依赖 Node 内置模块）──
    │  ├─ types.ts              全部核心数据类型（ExecResult/EngineIo/CheckOptions/CheckReport…）
    │  ├─ fs.ts                 文件系统工具：遍历、采样、README 读取、注释行判断、内容搜索
    │  ├─ detect.ts             项目类型识别（8 种）与构建/运行命令推导
    │  ├─ requirements.ts       需求提取：从用户文字中解析需求条目与可搜索关键词
    │  ├─ step1.ts              第 1 步：装依赖 → 构建 → 运行探针，收集报错
    │  ├─ step2.ts              第 2 步：逐条需求核对（启发式 + 可选 LLM + 行为验证：模拟打开项目抓取运行后所见），一次性汇报全部缺失
    │  ├─ step3.ts              第 3 步：生成模拟计划并执行（web/desktop/cli），记录卡顿/无响应/报错
    │  ├─ report.ts             报告渲染：三步结果 → 可回传 AI 的中文/英文报告文本
    │  └─ index.ts              引擎入口 runCheck()：按“报错即返 / 全量汇报 / 干净才模拟”编排三步
    │
    ├─ cli/                     ── 独立 CLI + MCP（供 Trae / Qoder 等任何平台）──
    │  ├─ index.ts              CLI 入口：check / detect / mcp 子命令与参数解析
    │  ├─ exec.ts               进程适配器：child_process 版 exec/start（超时杀进程树）
    │  ├─ llm.ts                OpenAI 兼容接口的 LLM 分析器（无 Harness 环境用）
    │  └─ mcp.ts                MCP stdio 服务器（tools/list、tools/call：check_project、detect_project）
    │
    ├─ simulators/              ── 第 3 步用户模拟的执行器（在目标机器上运行）──
    │  ├─ web-playwright.mjs    Web 模拟：Playwright 驱动点击/输入/按键/拖拽；并逐页审计（每个页面检测是否卡在“加载中”等加载指示）+ 遍历点击页面上所有按钮，收集控制台错误与截图
    │  ├─ windows-uia.ps1       Windows 桌面模拟：UIA 枚举控件 + 真实鼠标键盘 + 卡死检测 + 截图
    │  └─ static-server.mjs     内置静态文件服务器（无依赖，托管 web-static 项目）
    │
    ├─ scripts/                 ── 开发与运维脚本 ──
    │  ├─ build.mjs             构建/类型检查：lib 新鲜时跳过（发布包无需 TypeScript）
    │  ├─ gen-tsconfig.mjs      生成本机 tsconfig.paths.json（定位本机 deepseek-harness 检出一）
    │  └─ selfcheck.mjs         自检：类型检查+构建 → 单元测试+对照需求.txt 自检 → 示例项目模拟
    │
    ├─ tests/                   ── 单元测试 ──
    │  ├─ engine.test.mjs       引擎测试：需求提取/健康/构建失败/功能缺失/静态 Web/异常上报
    │  └─ harness.test.mjs      插件层测试：跟踪器自动触发与防循环、GUI 路由真实渲染
    │
    ├─ try_it_out/              ── 用户测试区（发布）──
    │  ├─ README.md             测试说明与逐个手动运行方法
    │  ├─ run-tests.ps1         Windows 一键测试脚本
    │  ├─ run-tests.sh          macOS/Linux 一键测试脚本
    │  ├─ healthy-cli/          健康项目示例（预期：没有问题）
    │  ├─ broken-build/         构建失败示例（预期：第 1 步报错即返）
    │  ├─ missing-feature/      功能缺失示例（预期：一次性汇报全部缺失）
    │  └─ web-static/           静态网页示例（预期：第 3 步模拟通过）
    │
    └─ examples/                ── 配置模板 ──
       ├─ web-overlay.yml       web 配置树 --patch 覆盖层模板（免安装挂载）
       └─ headless-overlay.yml  headless 一次性会话的 --patch 覆盖层模板

> lib/ 是 src/、engine/、cli/ 构建后的 JS 产物（随仓库发布）；node_modules/ 是本地开发用的依赖（git 忽略）。

---

## 开发者指南（从源码构建）

普通用户**不需要**本节 —— 发布包已附带 lib/。只有要改源码的开发者需要：

    # 0) 前置：本机有一份 deepseek-harness 检出一（用于解析 @deepseek-ai/* 类型），
    #    并安装 TypeScript（npm i -D typescript @types/node 或准备 tsc.js 路径）

    # 1) 生成本机类型映射（自动定位检出一，或用环境变量指定）
    node scripts/gen-tsconfig.mjs
    #    或：$env:DSH_HARNESS_DIR="<deepseek-harness 检出一目录>"; node scripts/gen-tsconfig.mjs

    # 2) 类型检查 + 构建
    node scripts/build.mjs --typecheck
    node scripts/build.mjs            # lib 新鲜时自动跳过；--force 强制重建

    # 3) 全量自检（类型检查+构建+单元测试+对照需求.txt 自检+示例项目模拟）
    node scripts/selfcheck.mjs

    # 4) 附加验证（可选）：MCP 协议冒烟 + 发布包可移植性检查
    node scripts/mcp-smoke.mjs        # 模拟 IDE 完成 MCP 握手与工具调用
    node scripts/portable-check.mjs   # 复制到临时目录验证“下载到哪都能用”且无本机路径/密钥

> 注意：tsconfig.paths.json 由第 1 步生成本机路径，**请勿提交到仓库**（仓库内提交的是空映射版本）。

---

## 自检与测试

本插件按用户要求“用插件检查插件本身”：

- 第 1 步：tsc 全量类型检查 + 构建（通过）；
- 第 2 步：对照 需求.txt 逐条核对功能实现（全部实现）；
- 第 3 步：对 try_it_out 示例项目执行真实模拟 + 在真实 Harness（headless 会话）中跑通
  “AI 写代码 → 自动检查 → 报告回传”闭环（会话日志可见 user/message 来源为
  plugin: dsh-code-checker、内容为“没有问题”）。

自检入口：node scripts/selfcheck.mjs。

---

## 这里说的 LLM 是什么？需要 API key 吗？

插件第 2、3 步有两个分析层次，LLM 只用于“深度分析”层：

| 用途 | 有 LLM（深度分析） | 无 LLM（启发式） |
|---|---|---|
| 第 2 步 功能完整性 | 模型逐条判断每条需求“已实现/部分实现/缺失”，并给出证据与修复建议（更准确） | 关键词匹配 + 文件结构检查（快速筛查，结论较粗） |
| 第 3 步 模拟计划 | 模型根据需求/README 生成操作计划（点哪个按钮、输入什么、期望看到什么） | 内置默认计划：先执行计划中的交互，再**自动逐页审计**（每个页面检测是否卡在“加载中”等）+ **遍历点击页面上所有按钮**并记录每个按钮点击后的状态 |

**第 1 步（编译运行）与第 3 步的执行本身（Playwright/UIA/CLI 驱动）完全不需要 LLM。**

**按使用场景看是否需要 API key：**

1. **在 DeepSeek Harness 里用（插件形态）—— 不需要任何额外 key**。插件通过 ctx.llm 复用你当前会话正在用的那个模型与凭据（agent 的 provider/model，找不到就用系统默认模型），零配置。
2. **独立 CLI / MCP（Trae、Qoder 等）—— key 可选**。不配 key 也开箱即用（纯启发式，三步全跑）；想启用深度分析时才配置三个环境变量：CODE_CHECK_LLM_BASE_URL / CODE_CHECK_LLM_API_KEY / CODE_CHECK_LLM_MODEL（任意 OpenAI 兼容接口）。
3. **想完全不用 LLM**：Harness 里把 useLlm 设为 false，或 CLI 加 --no-llm —— 零 token 消耗、零 key。

> 注意：useLlm 开启（默认）时，每次自动检查会消耗少量会话模型的 token（一次需求核对请求 + 可能一次计划生成请求）。介意成本就关掉它，第 1/3 步质量不受影响。

---

## 常见 Q&A

**Q1. 安装后 AI 写代码了，为什么没有自动检查？**
先确认插件真的被加载：**bundle 安装/更新后必须重启 dsh web**（插件行列表只在启动时读取，运行中的实例不会热加载新 bundle）。重启后控制台应出现 `[dsh-code-checker] dsh-code-checker 已加载…` 日志，浏览器打开 http://127.0.0.1:3080/code-checker/ 应看到检查面板。之后触发条件全部满足才检查：① 本轮有“编码工具调用”（write/edit/bash/pwsh/run_code 等，见 codingTools 配置）且次数 ≥ minCodingCalls；② 该会话是顶层（根）agent；③ autoCheck 为 true；④ 自上一次用户消息以来的自动检查次数未超过 maxAutoChecksPerPrompt。排查：dsh --profile web --dump-config 确认 code-checker 行存在。

**Q2. 检查一次要多久？会不会卡住对话？**
第 1 步受 buildTimeoutMs（默认 3 分钟）与 runProbeMs（默认 8 秒）约束；第 3 步每类模拟都有超时上限。自动检查在轮次关闭检查点（agent/turn-stopping）内同步执行，因此会延长“本轮结束”的边界一小段时间（通常数秒到 1 分钟）；若想完全不阻塞，可把 reportToAi 设为 inject 并手动触发。

**Q3. 会不会陷入“检查-修复-再检查”死循环？**
不会，双重防护：① 只有“自上次检查之后产生了新的编码活动”才会再次自动检查（AI 修复代码 → 再检查一次；AI 只说话不写代码 → 不重复检查，避免空转）；② 每个用户提示最多自动检查 maxAutoChecksPerPrompt（默认 6）次，之后必须等新的用户消息才会恢复。AI 主动调用 check_project 工具不受此上限限制。

**Q4. 检查报告在哪里能看到？**
① 直接回传给 AI（steer，AI 会收到并处理）；② GUI 面板 http://127.0.0.1:3080/code-checker/（“状态”页看历史报告/完整详情，“画面”页看各项目的命令行/GUI/log 测试画面与截图）；③ 控制台 [dsh-code-checker] 日志。

**Q5. 机器上没装 Playwright 会怎样？**
Web 模拟自动回退为 HTTP 探针（检测首页响应时间与状态码），其余两步不受影响；装好后（npm i playwright 或 npx playwright install chromium）自动升级为完整浏览器自动化。

**Q6. 桌面程序模拟支持哪些平台？**
当前仅 Windows（UIA 枚举控件 + 真实鼠标键盘 + IsHungAppWindow 卡死检测 + 截图）；其他平台跳过该步并说明原因。

**Q7. 识别不出项目类型会怎样？**
执行通用静态检查并在报告中注明“未识别出项目类型”；支持自动识别的类型：Node/Python/Rust/Go/C++/Java/.NET/静态 Web/Electron/桌面 exe。

**Q8. 检查会消耗我的模型 token 吗？**
仅 useLlm 开启时消耗少量 token（见“LLM 是什么”一节）；第 1 步与模拟执行不消耗。用 useLlm: false 或 --no-llm 可做到零消耗。

**Q9. 怎么彻底停用或卸载？**
停用：用户层把该行 config 设为 enabled: false（或从配置树删除该行）。卸载 bundle：dsh plugin --profile web remove dsh-code-checker。临时关掉自动检查：autoCheck: false（/check 与 check_project 仍可用）。

**Q10. 安装后不生效怎么排查？**
① dsh --profile web --dump-config | findstr code-checker —— 应看到 id: code-checker 的行；② 重启 dsh web 让新行生效；③ 控制台查找 [dsh-code-checker] 开头的日志；④ 确认会话工作目录就是你要检查的项目目录（检查目标 = 会话 cwd）。

**Q11. 怎么快速验证我的安装是否正确？**
跑 try_it_out 一键脚本（见“下载后的快速自测”一节）：健康项目应返回“没有问题”，构建失败项目应返回报错，功能缺失项目应一次性列出全部缺失功能。

**Q12. Web 模拟会占用端口、跟我的服务冲突吗？**
不会：只对本地回环的常见端口（5173/3000/8080/4173 等）做探测，不绑定端口；若已有服务在运行则直接复用。

**Q13. 第 1 步“运行探针”能证明程序完全正常吗？**
它只证明“能启动并在探针时长内保持存活/正常退出”；长时间运行的正确性请结合第 3 步模拟与第 2 步需求核对综合判断。

**Q14. 启发式判断和 LLM 判断以谁为准？**
LLM 可用且 useLlm 开启时以 LLM 结论为准（启发式作为旁证与回退）；纯启发式模式下结论偏保守，可能把“在注释/字符串里被提及但未真正实现”的功能误判为已实现 —— 这是启发式的固有权衡。

**Q15. 我已经安装过这个插件，还需要重新下载吗？**
通常不需要重新下载：本插件**零外部运行时依赖**，已安装的目录可以直接用 `git pull`（克隆安装）或重新执行 `dsh plugin add` 指向最新版本来更新。只有当你想用 GitHub release 附带的离线 tarball（适合无法访问 GitHub 的机器）时才需要下载 `dsh-code-checker-<版本>.tgz` 并重装。更新后**重启 dsh web** 生效（插件行列表只在启动时读取）。本地与最新 release 是否一致，可对比目录里 `package.json` 的 `version` 与 https://github.com/noname-iii/dsh-code-checker/releases/latest 的版本号。

**Q16. 我用 `dsh plugin add "~/dsh-code-checker"` 报 `Permission denied (publickey)` / 被当成 GitHub 地址，怎么办？**
这是路径写法的坑：带引号的 `"~/xxx"` 里 `~` 不会展开，pnpm 会把“含 `/` 但非真实路径”的字符串解析成 `git+ssh://git@github.com/...` 去走 SSH，自然报 publickey。三种正确写法任选：① 完整绝对路径 `dsh plugin add "$HOME/dsh-code-checker"` 或 `/Users/你的名字/dsh-code-checker`；② 不加引号 `dsh plugin add ~/dsh-code-checker`（让终端展开 `~`）；③ 干脆用 npm 直装 `dsh plugin add dsh-code-checker`（无需本地路径、无需 git、无需 SSH）。

## 已知边界

- 第 2 步启发式结论是“痕迹级”证据（关键词/文件名匹配），适合快速筛查；深度判定请保持 useLlm 开启。
- 桌面模拟仅 Windows；Web 模拟依赖 Playwright（缺省回退 HTTP 探针）。
- 报告回传走会话的插件上下文消息（steer/inject），不会以“用户”身份污染对话记录。
- 审批系统通知是**只读旁观**：它只通知你“有会话需要你决策”，不代你选择“运行/不运行”——最终决定仍在 Harness 的审批界面里由你做出。

## 安全说明

- **零外部运行时依赖**：插件运行时代码只 import `node:*` 内置模块，不引入第三方库，供应链攻击面最小。
- **不联网、不上传**：插件的检查都在本地完成；报告只回传给当前会话的 AI，不发往任何外部服务（第 2/3 步可选 LLM 分析走的是**你当前会话已有的模型**，不会额外泄露数据）。
- **不劫持审批**：审批通知观察器在 `approval/request` waterfall 里发完通知后原样 `next()`，把决定权交还 Harness，绝不自动放行任何命令。
- **命令无 shell 注入**：引擎执行构建/运行命令、通知调用系统命令时，一律用参数数组方式调用（不经过 shell 拼接）；通知文本只作为参数传递并做了转义/截断。
- **权限边界**：插件只读项目文件、运行项目声明的构建/运行命令（这是它作为代码检查器的本职）；不做任何与检查无关的系统级写操作。

## License

MIT
