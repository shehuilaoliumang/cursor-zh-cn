# Cursor 简体中文补丁：检测官方更新并在 Cursor 完全退出后自动重打。
# 不会关闭或拦截官方更新，也不会结束 Cursor 进程。
[CmdletBinding()]
param(
  [switch]$DetectOnly,
  [switch]$DryRun,
  [switch]$ApplyNow,
  [switch]$InstallTask,
  [switch]$UninstallTask,
  [switch]$Status,
  [switch]$Disable,
  [switch]$Enable
)

$ErrorActionPreference = "Stop"
$GuardDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkDir = Split-Path -Parent $GuardDir
$HomeDir = $env:USERPROFILE
$InstallRoot = if ($env:CURSOR_INSTALL_ROOT) { $env:CURSOR_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA "Programs\cursor" }
$ProductJson = Join-Path $InstallRoot "resources\app\product.json"
$Node = Join-Path $env:LOCALAPPDATA "Programs\node-v22.21.0\node.exe"
if (-not (Test-Path $Node)) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source }
}
$ApplyJs = Join-Path $WorkDir "apply-cursor-i18n-v3.js"
$StateFile = Join-Path $GuardDir "state.json"
$DisabledFile = Join-Path $GuardDir "disabled.flag"
$LogFile = Join-Path $GuardDir "reapply.log"
$CheckScript = Join-Path $GuardDir "check-cursor-running.ps1"
$LegacyBackup = Join-Path $HomeDir "cursor-i18n-backup-3.31.15-20261122"
$TaskDetect = "CursorZhCN-Reapply"
$TaskPoll = "CursorZhCN-Reapply-Poll"

function Write-Log([string]$msg) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
  $line = "[{0}] {1}" -f $ts, $msg
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  Write-Output $line
}

function Get-Sha256([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
}

function Get-CursorVersion {
  if (-not (Test-Path -LiteralPath $ProductJson)) { return $null }
  try {
    $p = Get-Content -LiteralPath $ProductJson -Raw -Encoding UTF8 | ConvertFrom-Json
    return [string]$p.version
  } catch { return $null }
}

function Get-ProcessCount {
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $CheckScript
  if (-not $out -or $out.Trim() -eq "running=none") { return 0 }
  return @($out -split "`r?`n" | Where-Object { $_ -and $_ -ne "running=none" }).Count
}

function Get-CurrentHashes {
  $app = Join-Path $InstallRoot "resources\app"
  $map = [ordered]@{}
  $files = @(
    @{ k = "product.json"; p = Join-Path $app "product.json" },
    @{ k = "out/vs/workbench/workbench.desktop.main.js"; p = Join-Path $app "out\vs\workbench\workbench.desktop.main.js" },
    @{ k = "out/vs/workbench/workbench.glass.main.js"; p = Join-Path $app "out\vs\workbench\workbench.glass.main.js" },
    @{ k = "out/vs/workbench/workbench.anysphere-ui.js"; p = Join-Path $app "out\vs\workbench\workbench.anysphere-ui.js" },
    @{ k = "out/vs/workbench/workbench.anysphere-ui-automations.js"; p = Join-Path $app "out\vs\workbench\workbench.anysphere-ui-automations.js" },
    @{ k = "out/vs/workbench/workbench.xai-commerce-prepaid.js"; p = Join-Path $app "out\vs\workbench\workbench.xai-commerce-prepaid.js" }
  )
  foreach ($f in $files) {
    $h = Get-Sha256 $f.p
    if ($h) { $map[$f.k] = $h }
  }
  $extRoot = Join-Path $HomeDir ".cursor\extensions"
  $pack = Get-ChildItem -LiteralPath $extRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "ms-ceintl.vscode-language-pack-zh-hans-*" } |
    Sort-Object Name |
    Select-Object -Last 1
  if ($pack) {
    $packFile = Join-Path $pack.FullName "translations\main.i18n.json"
    $h = Get-Sha256 $packFile
    if ($h) { $map["language-pack/main.i18n.json"] = $h }
    $map["_languagePackId"] = $pack.Name
  }
  return $map
}

function Test-PatchMarkers {
  $glass = Join-Path $InstallRoot "resources\app\out\vs\workbench\workbench.glass.main.js"
  if (-not (Test-Path -LiteralPath $glass)) { return $false }
  $fs = [System.IO.File]::Open($glass, "Open", "Read", "ReadWrite")
  try {
    $buf = New-Object byte[] 4096
    $reader = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8, $true, 65536, $true)
    $chunk = New-Object char[] 1048576
    $foundRemote = $false
    $foundPlan = $false
    while (($n = $reader.Read($chunk, 0, $chunk.Length)) -gt 0) {
      $s = New-Object string ($chunk, 0, $n)
      if ($s -like "*远程控制*") { $foundRemote = $true }
      if ($s -like "*计划与用量*") { $foundPlan = $true }
      if ($foundRemote -and $foundPlan) { return $true }
    }
    return ($foundRemote -and $foundPlan)
  } finally { $fs.Close() }
}

function Get-State {
  if (-not (Test-Path -LiteralPath $StateFile)) { return $null }
  return (Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Get-Detection {
  $version = Get-CursorVersion
  $hashes = Get-CurrentHashes
  $state = Get-State
  $running = Get-ProcessCount
  $markers = $false
  try { $markers = Test-PatchMarkers } catch { $markers = $false }

  $postMatch = $false
  if ($state -and $state.postHashes) {
    $keys = @("product.json","out/vs/workbench/workbench.desktop.main.js","out/vs/workbench/workbench.glass.main.js")
    $postMatch = $true
    foreach ($k in $keys) {
      $expected = [string]$state.postHashes.$k
      $actual = [string]$hashes[$k]
      if (-not $expected -or -not $actual -or $expected.ToLower() -ne $actual.ToLower()) { $postMatch = $false; break }
    }
  }

  $reason = $null
  $action = "none"
  if (Test-Path -LiteralPath $DisabledFile) {
    $action = "disabled"
    $reason = "已放置 disabled.flag，自动重打已关闭。"
  } elseif (-not $version) {
    $action = "missing-install"
    $reason = "找不到 Cursor 安装或 product.json。"
  } elseif ($postMatch -and $markers) {
    $action = "already-applied"
    $reason = ("当前文件与上次成功补丁一致（{0}）。" -f $version)
  } elseif ($markers -and $state -and $state.lastAppliedVersion -eq $version -and $postMatch -eq $false) {
    # markers present but hash drift on some files; still treat as needs check
    $action = "needs-apply"
    $reason = ("版本仍是 {0}，但安装文件校验已变化，需要重打。" -f $version)
  } else {
    $action = "needs-apply"
    if ($state -and $state.lastAppliedVersion -and $state.lastAppliedVersion -ne $version) {
      $reason = ("Cursor 已从 {0} 更新到 {1}，补丁需要按新版本重打。" -f $state.lastAppliedVersion, $version)
    } elseif (-not $markers) {
      $reason = ("检测到官方界面文案（缺少补丁标记），版本 {0}。" -f $version)
    } else {
      $reason = ("安装文件与上次成功补丁不一致，版本 {0}。" -f $version)
    }
  }

  return [pscustomobject]@{
    action = $action
    reason = $reason
    version = $version
    running = $running
    markers = $markers
    postMatch = $postMatch
    languagePack = $hashes["_languagePackId"]
    lastAppliedVersion = $(if ($state) { $state.lastAppliedVersion } else { $null })
    lastAppliedAt = $(if ($state) { $state.lastAppliedAt } else { $null })
  }
}

function New-VersionBackup([string]$version) {
  $date = Get-Date -Format "yyyyMMdd"
  $dest = Join-Path $HomeDir ("cursor-i18n-backup-{0}-{1}" -f $version, $date)
  if ($dest -eq $LegacyBackup) { throw "拒绝写入 3.31.15 备份目录。" }
  if (Test-Path -LiteralPath $dest) {
    Write-Log ("backup already exists, reusing {0}" -f $dest)
    return $dest
  }
  New-Item -ItemType Directory -Path (Join-Path $dest "app") | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $dest "language-pack") | Out-Null
  $app = Join-Path $InstallRoot "resources\app"
  $items = @(
    @{ src = Join-Path $app "product.json"; rel = "app\product.json" },
    @{ src = Join-Path $app "out\vs\workbench\workbench.desktop.main.js"; rel = "app\out_vs_workbench_workbench.desktop.main.js" },
    @{ src = Join-Path $app "out\vs\workbench\workbench.glass.main.js"; rel = "app\out_vs_workbench_workbench.glass.main.js" },
    @{ src = Join-Path $app "out\vs\workbench\workbench.anysphere-ui.js"; rel = "app\out_vs_workbench_workbench.anysphere-ui.js" },
    @{ src = Join-Path $app "out\vs\workbench\workbench.anysphere-ui-automations.js"; rel = "app\out_vs_workbench_workbench.anysphere-ui-automations.js" },
    @{ src = Join-Path $app "out\vs\workbench\workbench.xai-commerce-prepaid.js"; rel = "app\out_vs_workbench_workbench.xai-commerce-prepaid.js" }
  )
  $packDir = Get-ChildItem -LiteralPath (Join-Path $HomeDir ".cursor\extensions") -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "ms-ceintl.vscode-language-pack-zh-hans-*" } |
    Sort-Object Name | Select-Object -Last 1
  if ($packDir) {
    $items += @{ src = Join-Path $packDir.FullName "translations\main.i18n.json"; rel = "language-pack\main.i18n.json" }
  }
  $manifest = [ordered]@{
    version = $version
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    createdBy = "cursor-i18n-guard"
    files = [ordered]@{}
  }
  foreach ($item in $items) {
    if (-not (Test-Path -LiteralPath $item.src)) { continue }
    $target = Join-Path $dest $item.rel
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $item.src -Destination $target -Force
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
    $manifest.files[$item.rel.Replace("\","/")] = [ordered]@{ sha256 = $hash; bytes = (Get-Item $target).Length }
  }
  ($manifest | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath (Join-Path $dest "manifest.json") -Encoding UTF8
  Write-Log ("backup created {0}" -f $dest)
  return $dest
}

function Invoke-Apply([string]$version, [switch]$Dry) {
  if (-not (Test-Path -LiteralPath $Node)) { throw "找不到 Node.js：请确认已安装 node。" }
  if (-not (Test-Path -LiteralPath $ApplyJs)) { throw "找不到 apply-cursor-i18n-v3.js" }
  $state = Get-State
  $backup = $null
  if ($state -and $state.backupDir -and (Test-Path (Join-Path $state.backupDir "manifest.json"))) {
    try {
      $mf = Get-Content (Join-Path $state.backupDir "manifest.json") -Raw | ConvertFrom-Json
      if ($mf.version -eq $version) { $backup = $state.backupDir }
    } catch {}
  }
  if (-not $backup) {
    $today = Join-Path $HomeDir ("cursor-i18n-backup-{0}-{1}" -f $version, (Get-Date -Format "yyyyMMdd"))
    if ((Test-Path -LiteralPath $today) -and $today -ne $LegacyBackup) { $backup = $today }
  }
  $adapt = $false
  if (-not $backup) {
    if ($Dry) {
      Write-Log "dry-run would create a new dated backup first"
    } else {
      $backup = New-VersionBackup $version
    }
    $adapt = $true
  } else {
    try {
      $mf = Get-Content (Join-Path $backup "manifest.json") -Raw | ConvertFrom-Json
      if ($mf.version -ne $version) { $adapt = $true }
    } catch { $adapt = $true }
  }
  $args = @($ApplyJs, "--backup-dir", $backup)
  if ($adapt) { $args += "--adapt-new-version" }
  if ($Dry) { $args += "--dry-run" }
  Write-Log ("running apply version={0} backup={1} adapt={2} dry={3}" -f $version, $backup, $adapt, [bool]$Dry)
  & $Node @args
  $code = $LASTEXITCODE
  Write-Log ("apply exit={0}" -f $code)
  return $code
}

function Install-Tasks {
  $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $scriptPath = $PSCommandPath
  if (-not $scriptPath) { $scriptPath = $MyInvocation.MyCommand.Path }
  if (-not $scriptPath) { $scriptPath = Join-Path $GuardDir "reapply.ps1" }
  if (-not (Test-Path -LiteralPath $scriptPath)) { throw "找不到助手脚本：$scriptPath" }
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
  $action = New-ScheduledTaskAction -Execute $ps -Argument $arg
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
  Register-ScheduledTask -TaskName $TaskDetect -Action $action -Trigger $logonTrigger -Settings $settings -User $userId -Force | Out-Null

  $pollTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName $TaskPoll -Action $action -Trigger $pollTrigger -Settings $settings -User $userId -Force | Out-Null

  $t1 = Get-ScheduledTask -TaskName $TaskDetect -ErrorAction Stop
  $t2 = Get-ScheduledTask -TaskName $TaskPoll -ErrorAction Stop
  $arg1 = [string]$t1.Actions.Arguments
  if ($arg1 -notlike "*reapply.ps1*") { throw "计划任务未写入脚本路径： $arg1" }
  Write-Log ("scheduled tasks installed: {0} (state={1}), {2} (state={3}), script={4}" -f $TaskDetect, $t1.State, $TaskPoll, $t2.State, $scriptPath)
}
function Uninstall-Tasks {
  schtasks /Delete /TN $TaskDetect /F 2>$null | Out-Null
  schtasks /Delete /TN $TaskPoll /F 2>$null | Out-Null
  Write-Log "scheduled tasks removed"
}

# ---- commands ----
if ($InstallTask) { Install-Tasks; exit 0 }
if ($UninstallTask) { Uninstall-Tasks; exit 0 }
if ($Disable) {
  "disabled $(Get-Date -Format o)" | Set-Content -LiteralPath $DisabledFile -Encoding UTF8
  Write-Log "auto re-apply disabled via disabled.flag"
  exit 0
}
if ($Enable) {
  if (Test-Path -LiteralPath $DisabledFile) { Remove-Item -LiteralPath $DisabledFile -Force }
  Write-Log "auto re-apply enabled"
  exit 0
}

$det = Get-Detection
if ($Status -or $DetectOnly -or $DryRun) {
  Write-Output ($det | ConvertTo-Json -Depth 4)
  if ($DetectOnly -or $Status) { exit 0 }
}

if ($det.action -eq "disabled") { Write-Log $det.reason; exit 0 }
if ($det.action -eq "already-applied") { if ($ApplyNow) { Write-Log $det.reason } ; if (-not $ApplyNow) { exit 0 } }
if ($det.action -eq "missing-install") { Write-Log $det.reason; exit 1 }

if ($det.running -gt 0 -and -not $DryRun) {
  Write-Log ("pending: Cursor is running (count={0}). Will retry later, will not kill it. {1}" -f $det.running, $det.reason)
  exit 2
}

if ($det.action -eq "needs-apply" -or $ApplyNow) {
  $code = Invoke-Apply -version $det.version -Dry:$DryRun
  exit $code
}

Write-Log ("noop: {0}" -f $det.reason)
exit 0
