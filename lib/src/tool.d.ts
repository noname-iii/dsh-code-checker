/**
 * 文件作用：注册 check_project 模型工具 —— AI 可主动请求检查项目并把报告作为工具结果返回。
 *
 * 说明（重要）：本文件【不】依赖 @deepseek-ai/dsh-tools。
 * 插件束通过 `dsh plugin add <目录>`（pnpm link）安装时，被链接目录可能没有
 * node_modules，运行时 import 外部包会解析失败导致插件整行加载失败。
 * ctx.tools.register() 接受一个普通 ToolDefinition 对象（原始 JSON Schema 参数 +
 * output 渲染 + execute），因此这里手工构造定义即可，零外部依赖。
 * @module dsh-code-checker
 */
import type { Context } from '@deepseek-ai/cordis';
/** 依赖注入接口。 */
export interface ToolDeps {
    /** 对指定 agent 执行检查（返回渲染文本）。 */
    runCheckReturnText(agent: import('@deepseek-ai/dsh-agent').Agent | undefined, reason: 'auto' | 'command' | 'tool', options: {
        projectDir?: string;
        extraRequirements?: string;
        simulate?: boolean;
    }): Promise<string>;
    log(line: string): void;
}
/**
 * 注册 check_project 工具（零依赖：手工构造 ToolDefinition）。
 * parameters 使用原始 JSON Schema（与 dsh-tools 的 defineTool 编译产物一致：
 * 隐式开放的对象根、无 required 字段、所有属性可选）。
 */
export declare function installTool(ctx: Context, deps: ToolDeps): void;
