// 文件作用：try_it_out 的“构建失败”示例的第二处错误 —— lint 脚本同样抛错，
// 用于验证插件第 1 步能一次性汇报多个错误（build 与 lint 都会失败）。
throw new Error('Lint failed: line 42 - 缺少分号 semicolon expected')
