/**
 * 文件作用：独立 CLI 的进程适配器 —— 用 child_process 实现引擎的 exec/start。
 * 独立 CLI 的进程适配器（child_process）。
 * @module dsh-code-checker/cli
 */

import { spawn } from 'node:child_process'  // 从 Node 内置 child_process 模块导入 spawn：用于启动子进程
import type { ExecFn, ExecOptions, ExecResult, RunningProcess, StartFn } from '../engine/types.js'  // 从引擎导入类型（仅类型，编译后不产生运行时代码）

function isWin(platform: string): boolean {  // 判断给定平台字符串是否为 Windows
  return platform === 'win32'  // 平台为 win32 时返回 true
}

/** 前台执行适配器（shell: true，超时用 taskkill 杀进程树）。 */
export function makeExec(platform: 'win32' | 'posix'): ExecFn {  // 导出前台执行适配器工厂函数，返回符合 ExecFn 签名的执行函数
  return async (opts: ExecOptions): Promise<ExecResult> => {  // 返回一个异步执行函数，接收执行选项
    const started = Date.now()  // 记录开始时间戳（毫秒）
    const timeoutMs = opts.timeoutMs ?? 120_000  // 超时时间，缺省 120 秒
    return await new Promise<ExecResult>((resolve) => {  // 用 Promise 包装子进程生命周期，完成时 resolve 结果
      const child = spawn(opts.command, {  // 启动子进程
        cwd: opts.cwd,  // 子进程工作目录
        shell: true,  // 通过 shell 执行命令
        env: { ...process.env, ...opts.env },  // 合并环境变量（opts.env 覆盖默认值）
        stdio: ['pipe', 'pipe', 'pipe'],  // 标准输入/输出/错误都用管道
        windowsHide: true,  // Windows 下隐藏窗口
      })
      let stdout = ''  // 累积标准输出内容
      let stderr = ''  // 累积标准错误内容
      let timedOut = false  // 是否已超时
      let aborted = false  // 是否已被中止
      let settled = false  // 是否已经结束并 resolve
      const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {  // finish：结束 Promise 并返回执行结果
        if (settled) return  // 已结束时直接返回，避免重复 resolve
        settled = true  // 标记为已结束
        clearTimeout(timer)  // 清除超时定时器
        resolve({ exitCode, signal, timedOut, aborted, stdout, stderr, durationMs: Date.now() - started })  // 返回执行结果（含耗时）
      }
      const kill = (): void => {  // kill：根据平台杀掉子进程（及其进程树）
        if (isWin(platform)) {  // Windows 平台
          try {  // 尝试执行杀进程
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })  // 用 taskkill 强杀进程树
          } catch { /* 忽略 */ }  // 忽略杀进程失败
        } else {  // POSIX 平台
          try { child.kill('SIGKILL') } catch { /* 忽略 */ }  // 发送 SIGKILL 强杀子进程
        }
      }
      const timer = setTimeout(() => {  // 设置超时定时器：超时后标记并杀进程
        timedOut = true  // 标记为超时
        kill()  // 杀掉子进程
      }, timeoutMs)  // 以超时时间为间隔
      child.stdout?.on('data', (chunk: Buffer) => {  // 监听标准输出数据
        stdout += chunk.toString('utf8')  // 追加解码后的输出
        if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000)  // 超过 2MB 时只保留末尾 1MB，防止内存膨胀
      })
      child.stderr?.on('data', (chunk: Buffer) => {  // 监听标准错误数据
        stderr += chunk.toString('utf8')  // 追加解码后的错误输出
        if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000)  // 超过 2MB 时只保留末尾 1MB
      })
      child.on('error', (error) => {  // 监听子进程启动/运行错误
        stderr += String(error)  // 将错误信息并入 stderr
        finish(1, null)  // 以退出码 1 结束
      })
      child.on('close', (code, signal) => {  // 监听子进程关闭事件
        finish(code, signal)  // 以实际退出码与信号结束
      })
      if (opts.stdin !== undefined) {  // 提供了标准输入内容时
        child.stdin?.write(opts.stdin)  // 写入子进程标准输入
      }
      child.stdin?.end()  // 关闭标准输入流
    })
  }
}

/** 后台启动适配器。 */
export function makeStart(platform: 'win32' | 'posix'): StartFn {  // 导出后台启动适配器工厂函数，返回符合 StartFn 签名的启动函数
  return async (opts: ExecOptions): Promise<RunningProcess> => {  // 返回一个异步启动函数，接收执行选项
    const child = spawn(opts.command, {  // 启动后台子进程
      cwd: opts.cwd,  // 子进程工作目录
      shell: true,  // 通过 shell 执行命令
      env: { ...process.env, ...opts.env },  // 合并环境变量
      stdio: ['ignore', 'pipe', 'pipe'],  // 忽略标准输入，标准输出/错误用管道
      windowsHide: true,  // Windows 下隐藏窗口
      ...isWin(platform) ? {} : { detached: true },  // 非 Windows 平台时脱离父进程
    })
    let output = ''  // 累积子进程输出（stdout + stderr）
    let exitCode: number | null = null  // 退出码，初始为 null（表示仍在运行）
    child.stdout?.on('data', (chunk: Buffer) => {  // 监听标准输出数据
      output += chunk.toString('utf8')  // 追加解码后的输出
      if (output.length > 2_000_000) output = output.slice(-1_000_000)  // 超过 2MB 时只保留末尾 1MB
    })
    child.stderr?.on('data', (chunk: Buffer) => {  // 监听标准错误数据
      output += chunk.toString('utf8')  // 追加解码后的错误输出
      if (output.length > 2_000_000) output = output.slice(-1_000_000)  // 超过 2MB 时只保留末尾 1MB
    })
    const done = new Promise<void>((resolve) => {  // done：在子进程关闭或出错时 resolve，供 stop 等待进程真正结束
      child.on('close', (code) => {  // 监听关闭事件
        exitCode = code  // 记录退出码
        resolve()  // 完成 done Promise
      })
      child.on('error', () => resolve())  // 出错时也完成 done Promise
    })
    return {  // 返回 RunningProcess 对象
      async stop(): Promise<void> {  // stop：停止后台进程
        if (exitCode !== null) return  // 已退出则无需停止
        if (isWin(platform)) {  // Windows 平台
          try {  // 尝试执行杀进程
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })  // 用 taskkill 强杀进程树
          } catch { /* 忽略 */ }  // 忽略杀进程失败
        } else {  // POSIX 平台
          try { process.kill(-(child.pid ?? 0), 'SIGKILL') } catch { /* 忽略 */ }  // 对进程组发送 SIGKILL（负 pid 表示进程组）
        }
        await done  // 等待进程真正关闭
      },
      output(): string {  // output：返回累积的输出内容
        return output  // 返回输出字符串
      },
      alive(): boolean {  // alive：判断进程是否仍在运行
        return exitCode === null  // 退出码仍为 null 表示存活
      },
    }
  }
}
