# try_it_out —— 用户测试区

下载插件后，用这里的 5 个示例项目快速验证插件工作正常。
无需任何安装、无需 API key（全部使用启发式检查）。

## 一键运行

| 平台 | 命令 |
|---|---|
| Windows (PowerShell) | `powershell -ExecutionPolicy Bypass -File try_it_out/run-tests.ps1` |
| macOS / Linux | `bash try_it_out/run-tests.sh` |

也可以手动逐个运行（先 `npm install` 或 pnpm 安装依赖到插件根，再执行）：

```sh
# 1. 健康项目 —— 预期输出“……没有问题”，退出码 0
node lib/cli/index.js check try_it_out/healthy-cli --no-install --no-llm

# 2. 构建失败项目（build 与 lint 两处错误）—— 预期第 1 步报错并一次性返回全部错误
#    （含“文件:行号”定位），跳过第 2/3 步，退出码 1
node lib/cli/index.js check try_it_out/broken-build --no-install --no-llm

# 3. 功能缺失项目 —— 预期第 2 步一次性汇报“登录、导出”两项缺失，第 3 步跳过，退出码 1
node lib/cli/index.js check try_it_out/missing-feature --no-install --no-llm

# 4. 第 3 步模拟出错项目 —— 编译、运行、功能都正常，只有 --version 命令有操作层 bug，
#    预期第 1、2 步通过、第 3 步真实模拟报错并汇报，退出码 1
node lib/cli/index.js check try_it_out/broken-cli --no-install --no-llm

# 5. 静态网页项目 —— 预期第 3 步模拟通过（装了 Playwright 会有真实浏览器操作，
#    没装则自动回退 HTTP 探针），输出“没有问题”，退出码 0
node lib/cli/index.js check try_it_out/web-static --no-install --no-llm
```

## 5 个示例项目说明

| 目录 | 内容 | 预期检查结果 |
|---|---|---|
| `healthy-cli` | 一个功能完整的 Node CLI（greet/--help/--version 都已实现），附 `需求.txt` | 三步全部通过 → **没有问题** |
| `broken-build` | 构建脚本故意抛错的 Node 项目（build 与 lint **两处**错误） | 第 1 步发现编译报错 → **一次性返回全部报错（含文件:行号定位）**，跳过后续步骤 |
| `missing-feature` | 只实现了 greet、缺少登录与导出功能的项目 | 第 2 步 **一次性列出全部未实现功能**，跳过第 3 步 |
| `broken-cli` | 编译、运行、功能都正常，但 `--version` 命令有用户操作层面的 bug（打印错误并退出） | 第 1、2 步通过，**第 3 步真实模拟发现“CLI 命令报错”**并汇报 → 退出码 1 |
| `web-static` | 一个带问候按钮与输入框的静态网页，附 README.md | 第 3 步按 README 模拟用户操作 → **没有问题** |

每个项目的 `需求.txt`（或 `README.md`）就是“用户需求”，你可以修改它们来观察检查结果的变化 —— 这正是第 2 步“功能完整性核对”的工作方式。

## 用你自己项目测试

```sh
node lib/cli/index.js check <你的项目目录> --no-install
# 不加 --no-llm 时，可通过环境变量接入 OpenAI 兼容接口做深度分析：
#   CODE_CHECK_LLM_BASE_URL / CODE_CHECK_LLM_API_KEY / CODE_CHECK_LLM_MODEL
```
