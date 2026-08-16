# Windows 桌面程序用户模拟器（UIA + 真实鼠标键盘事件）。
# 文件作用：启动一个 Windows 桌面程序，通过 UIA 枚举控件，依次执行点击、输入、按键、等待、截图等交互，
#           并探测窗口是否找到、程序是否无响应或崩溃，最后输出一行 RESULT:{...} JSON。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File windows-uia.ps1 -PlanFile <plan.json>
# plan.json: { exe, workDir, artifacts, probeMs, interactions: [{action,target,value}] }
# 输出: 最后一行 RESULT:{...} JSON。
param(                                               # 定义脚本参数块
  [Parameter(Mandatory = $true)]                     # 标记该参数为必填
  [string]$PlanFile                                  # 计划文件路径参数
)

$ErrorActionPreference = 'Stop'                      # 遇错即停（抛出终止性错误）
$plan = Get-Content $PlanFile -Raw | ConvertFrom-Json   # 读取计划文件全部内容并解析为 JSON 对象
$exe = [string]$plan.exe                             # 取要启动的程序路径
$workDir = [string]$plan.workDir                     # 取程序工作目录
$artifacts = [string]$plan.artifacts                 # 取截图等产物输出目录
$probeMs = [int]$plan.probeMs                        # 取探测等待毫秒数
if ($probeMs -le 0) { $probeMs = 15000 }             # 探测时间非正数时使用默认 15000ms
$interactions = @($plan.interactions)                # 取交互动作数组（确保为数组）

New-Item -ItemType Directory -Force -Path $artifacts | Out-Null   # 确保产物目录存在（已存在则忽略）

$actions = @()                                       # 收集交互动作执行结果的数组
$screenshots = @()                                   # 收集截图路径的数组
$windowFound = $false                                # 主窗口是否找到
$hangDetected = $false                               # 是否检测到程序无响应
$crashed = $false                                    # 程序是否崩溃退出
$crashInfo = ''                                      # 崩溃信息文本
$note = ''                                           # 备注信息文本

function Add-Win32 {                                 # 定义函数：注册 Win32 API 声明供脚本调用
  # 通过 C# 源码定义 DshUi 静态类（封装 user32.dll 的窗口、鼠标、截图相关 API）并编译
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshUi {
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
}

function Take-Screenshot([IntPtr]$handle, [string]$path) {   # 定义函数：对指定窗口句柄截图并保存到 path
  try {                                                      # 捕获截图过程中的异常
    Add-Type -AssemblyName System.Drawing                    # 加载 System.Drawing 程序集（GDI+ 绘图）
    $rect = New-Object 'DshUi+RECT'                          # 创建用于接收窗口矩形的 RECT 结构
    [DshUi]::GetWindowRect($handle, [ref]$rect) | Out-Null   # 获取窗口矩形坐标
    $w = $rect.Right - $rect.Left                            # 计算窗口宽度
    $h = $rect.Bottom - $rect.Top                            # 计算窗口高度
    if ($w -le 0 -or $h -le 0) { return }                    # 尺寸无效则直接返回
    $bmp = New-Object System.Drawing.Bitmap($w, $h)          # 创建指定尺寸的位图
    $g = [System.Drawing.Graphics]::FromImage($bmp)          # 从位图创建绘图上下文
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)   # 将屏幕指定区域复制到位图
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)   # 以 PNG 格式保存截图
    $g.Dispose()                                             # 释放绘图上下文
    $bmp.Dispose()                                           # 释放位图对象
    $screenshots += $path                                    # 记录截图路径到数组
  } catch {
    # 截图失败不致命
  }
}

function Wait-ForMainWindow($proc, [int]$timeoutMs) {        # 定义函数：轮询等待进程主窗口出现，超时返回零句柄
  $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)   # 计算等待截止时间
  while ([DateTime]::UtcNow -lt $deadline) {                 # 在截止时间前循环
    try {
      $proc.Refresh()                                        # 刷新进程状态
      if ($proc.MainWindowHandle -ne 0) {                    # 若主窗口句柄已出现
        # 等待窗口完全可用
        Start-Sleep -Milliseconds 800                        # 再等待 800ms 确保窗口可用
        $proc.Refresh()                                      # 再次刷新进程状态
        return $proc.MainWindowHandle                        # 返回主窗口句柄
      }
      if ($proc.HasExited) { return [IntPtr]::Zero }         # 若进程已退出则返回零句柄
    } catch {
      return [IntPtr]::Zero                                  # 异常时返回零句柄
    }
    Start-Sleep -Milliseconds 150                            # 轮询间隔 150ms
  }
  return [IntPtr]::Zero                                      # 超时返回零句柄
}

# ── 启动程序 ──
Add-Win32                                                    # 调用函数注册 Win32 API
$proc = Start-Process -FilePath $exe -WorkingDirectory $workDir -PassThru -ErrorAction SilentlyContinue   # 启动目标程序并返回进程对象
if (-not $proc) {                                            # 若启动失败（未取得进程对象）
  $note = '无法启动程序: ' + $exe                            # 记录无法启动的备注
  $payload = @{ windowFound = $false; hangDetected = $false; crashed = $false; crashInfo = ''; controls = 0; actions = $actions; screenshots = $screenshots; note = $note } | ConvertTo-Json -Compress -Depth 5   # 构造失败结果并转 JSON
  Write-Output ('RESULT:' + $payload)                        # 输出结果
  exit 0                                                     # 正常退出（结果已上报）
}
Start-Sleep -Milliseconds 600                                # 等待 600ms 让进程初始化
$handle = Wait-ForMainWindow $proc 15000                     # 等待主窗口出现（最多 15 秒）
if ($handle -eq [IntPtr]::Zero) {                            # 若未取得有效窗口句柄
  $proc.Refresh()                                            # 刷新进程状态
  if ($proc.HasExited) {                                     # 若进程已退出
    $crashed = $true                                         # 标记为崩溃
    $crashInfo = '程序在等待主窗口期间退出（ExitCode=' + $proc.ExitCode + '）'   # 记录崩溃信息（含退出码）
  } else {                                                   # 进程仍在但无主窗口
    $note = '启动后 15 秒内未检测到主窗口（可能是后台/托盘程序）'   # 记录备注
  }
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }   # 若进程仍存活则强制结束
  $payload = @{ windowFound = $false; hangDetected = $hangDetected; crashed = $crashed; crashInfo = $crashInfo; controls = 0; actions = $actions; screenshots = $screenshots; note = $note } | ConvertTo-Json -Compress -Depth 5   # 构造失败结果并转 JSON
  Write-Output ('RESULT:' + $payload)                        # 输出结果
  exit 0                                                     # 正常退出
}
$windowFound = $true                                         # 标记已找到主窗口
[DshUi]::ShowWindow($handle, 5) | Out-Null   # SW_SHOW（显示窗口，5 为 SW_SHOW）
[DshUi]::SetForegroundWindow($handle) | Out-Null             # 将窗口置为前台
Start-Sleep -Milliseconds 600                                # 等待 600ms
Take-Screenshot $handle (Join-Path $artifacts 'desktop-0.png')   # 截取初始桌面截图

# ── UIA 枚举控件 ──
$controls = 0                                                # 控件总数
$firstButton = $null                                         # 第一个按钮控件
$firstEdit = $null                                           # 第一个输入框控件
try {
  Add-Type -AssemblyName UIAutomationClient                  # 加载 UIAutomationClient 程序集
  Add-Type -AssemblyName UIAutomationTypes                   # 加载 UIAutomationTypes 程序集
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)   # 从窗口句柄获取 UIA 根元素
  $btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)   # 定义“按钮控件”筛选条件
  $editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)   # 定义“输入框控件”筛选条件
  $allCond = [System.Windows.Automation.Condition]::TrueCondition   # 定义“全部控件”筛选条件
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)   # 查找所有按钮控件
  $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)     # 查找所有输入框控件
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $allCond)        # 查找所有后代控件
  $controls = $all.Count                                     # 记录控件总数
  if ($buttons.Count -gt 0) { $firstButton = $buttons.Item(0) }   # 取第一个按钮
  if ($edits.Count -gt 0) { $firstEdit = $edits.Item(0) }         # 取第一个输入框
} catch {
  # UIA 不可用时仅做窗口级探测
}

function Click-UiaElement($element) {                        # 定义函数：点击一个 UIA 元素（优先真实鼠标点击，失败回退 Invoke 模式）
  try {
    $pt = $element.GetClickablePoint()                       # 获取元素可点击的中心点坐标
    [DshUi]::SetCursorPos([int]$pt.X, [int]$pt.Y) | Out-Null   # 将鼠标移动到该坐标
    [DshUi]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN（鼠标左键按下）
    Start-Sleep -Milliseconds 60                             # 间隔 60ms
    [DshUi]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP（鼠标左键抬起）
    return $true                                             # 返回点击成功
  } catch {
    try {
      $invoke = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)   # 获取 Invoke 模式
      $invoke.Invoke()                                       # 通过 Invoke 模式触发控件
      return $true                                           # 返回点击成功
    } catch {
      return $false                                          # 返回点击失败
    }
  }
}

# ── 执行交互 ──
foreach ($interaction in $interactions) {                    # 遍历每个交互动作
  $record = @{ action = [string]$interaction.action; target = [string]$interaction.target; ok = $true; error = '' }   # 初始化动作结果记录
  try {
    switch ([string]$interaction.action) {                   # 按动作类型分发
      'click' {                                              # 点击动作
        $target = [string]$interaction.target                # 取点击目标
        if ($firstButton -and ($target -eq 'firstButton' -or $target -eq '' -or $target -eq 'button')) {   # 目标为“第一个按钮/空/button”时使用已找到的第一个按钮
          if (-not (Click-UiaElement $firstButton)) { throw '按钮无法点击' }   # 点击失败则抛错
        } elseif ($target) {                                 # 否则按名字查找控件
          # 按名字查找
          $nameCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $target)   # 定义“名称等于 target”的筛选条件
          $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nameCond)   # 查找第一个名称匹配的控件
          if ($null -eq $el) { throw ('找不到控件: ' + $target) }   # 未找到则抛错
          if (-not (Click-UiaElement $el)) { throw ('控件无法点击: ' + $target) }   # 点击失败则抛错
        } else {                                             # 既没有默认按钮也没有指定目标
          throw '没有可点击的按钮'                           # 抛错
        }
      }
      'type' {                                               # 输入动作
        $target = [string]$interaction.target                # 取输入目标
        $el = $null                                          # 初始化目标控件为 null
        if ($firstEdit -and ($target -eq 'firstEdit' -or $target -eq '' -or $target -eq 'edit')) { $el = $firstEdit }   # 目标为“第一个输入框/空/edit”时使用第一个输入框
        elseif ($target) {                                   # 否则按名字查找
          $nameCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $target)   # 定义“名称等于 target”的筛选条件
          $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nameCond)   # 查找第一个名称匹配的控件
        }
        if ($null -eq $el) { throw '找不到输入框' }          # 未找到输入框则抛错
        try {
          $el.SetFocus()                                     # 使输入框获得焦点
          $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)   # 获取 Value 模式
          $vp.SetValue([string]$interaction.value)           # 通过 Value 模式设置文本
        } catch {
          # 回退：真实键盘输入
          Add-Type -AssemblyName System.Windows.Forms         # 加载 WinForms 程序集（用于 SendKeys）
          [DshUi]::SetForegroundWindow($handle) | Out-Null    # 将窗口置为前台
          Start-Sleep -Milliseconds 300                       # 等待 300ms
          [System.Windows.Forms.SendKeys]::SendWait([string]$interaction.value)   # 通过真实键盘事件输入文本
        }
      }
      'press' {                                              # 按键动作
        Add-Type -AssemblyName System.Windows.Forms           # 加载 WinForms 程序集（用于 SendKeys）
        [DshUi]::SetForegroundWindow($handle) | Out-Null      # 将窗口置为前台
        Start-Sleep -Milliseconds 200                         # 等待 200ms
        [System.Windows.Forms.SendKeys]::SendWait(('{' + [string]$interaction.value + '}'))   # 发送按键（包裹成 {键名} 形式）
      }
      'wait' {                                               # 等待动作
        $ms = 0                                              # 初始化等待毫秒数
        if ([int]::TryParse([string]$interaction.value, [ref]$ms)) { Start-Sleep -Milliseconds ([Math]::Min($ms, 10000)) }   # 值为整数则等待（上限 10000ms）
        else { Start-Sleep -Milliseconds 800 }               # 值非法则默认等待 800ms
      }
      'screenshot' {                                         # 截图动作
        Take-Screenshot $handle (Join-Path $artifacts ('desktop-' + [string]($screenshots.Count) + '.png'))   # 截图并以序号命名保存
      }
      default {                                              # 未知动作类型
        $record.ok = $false                                  # 标记失败
        $record.error = '未知操作类型: ' + [string]$interaction.action   # 记录错误信息
      }
    }
  } catch {                                                  # 捕获动作执行中的异常
    $record.ok = $false                                      # 标记失败
    $msg = ($_ | Out-String).Trim()                          # 取异常消息并去除首尾空白
    if ($msg.Length -gt 400) { $msg = $msg.Substring(0, 400) }   # 消息过长则截取前 400 字符
    $record.error = $msg                                     # 记录错误信息
  }
  $actions += $record                                        # 将结果记录加入 actions 数组
  Start-Sleep -Milliseconds 400                              # 每个动作之间等待 400ms
}

# ── 收尾探测 ──
Start-Sleep -Milliseconds 800                                # 等待 800ms 让程序稳定
$proc.Refresh()                                              # 刷新进程状态
if ($proc.HasExited) {                                       # 若进程已退出
  $crashed = $true                                           # 标记为崩溃
  $crashInfo = '程序在模拟过程中退出（ExitCode=' + $proc.ExitCode + '）'   # 记录崩溃信息（含退出码）
} else {                                                     # 进程仍在
  $hangDetected = [DshUi]::IsHungAppWindow($handle)          # 检测窗口是否无响应
  Take-Screenshot $handle (Join-Path $artifacts ('desktop-' + [string]$screenshots.Count + '.png'))   # 截取最终桌面截图
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue   # 强制结束目标进程
}

$payload = @{                                                # 构造最终结果对象
  windowFound = $windowFound                                 # 窗口是否找到
  hangDetected = $hangDetected                               # 是否无响应
  crashed = $crashed                                         # 是否崩溃
  crashInfo = $crashInfo                                     # 崩溃信息
  controls = $controls                                       # 控件总数
  actions = $actions                                         # 动作结果列表
  screenshots = $screenshots                                 # 截图路径列表
  note = $note                                               # 备注信息
} | ConvertTo-Json -Compress -Depth 5                        # 转为紧凑 JSON（深度 5）
Write-Output ('RESULT:' + $payload)                          # 输出最终结果
exit 0                                                       # 正常退出
