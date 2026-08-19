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
import type { CheckOptions, EngineIo, StepResult } from './types.js';
import type { ProjectFiles } from './fs.js';
import type { ProjectInfo } from './detect.js';
/** 执行第 2 步。 */
export declare function runStep2(// 定义第 2 步主函数
requirements: string[], // 需求列表
project: ProjectFiles, // 项目文件
projectInfo: ProjectInfo, // 项目信息
opts: CheckOptions, // 检查配置
io: EngineIo): Promise<StepResult>;
