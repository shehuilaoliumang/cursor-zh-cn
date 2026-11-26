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
  [switch]$Enable,
  [switch]$Daemon,
  [switch]$StopDaemon
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
$StopFile = Join-Path $GuardDir "daemon-stop.flag"
$HiddenVbs = Join-Path $GuardDir "reapply-hidden.vbs"
$MutexName = "Local\CursorZhCN-Reapply-Daemon"

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
  # Stay in-process. Spawning powershell.exe here was flashing a console
  # even when the parent task used -WindowStyle Hidden.
  $ids = @{}
  Get-Process -Name "Cursor","cursor" -ErrorAction SilentlyContinue | ForEach-Object {
    $ids[$_.Id] = $true
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $p = $_.ExecutablePath
    if ($p -and ($p -like '*\Programs\cursor\*' -or $p -like '*\Programs\Cursor\*') -and ($_.Name -match '^(Cursor|cursor)\.exe$')) {
      $ids[$_.ProcessId] = $true
    }
  }
  return $ids.Count
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

function Stop-DaemonInstance {
  # The running daemon exits when it sees this flag. Do not launch another
  # hidden helper here (that would re-enter this function).
  "stop $(Get-Date -Format o)" | Set-Content -LiteralPath $StopFile -Encoding UTF8
}

function Start-HiddenDaemon {
  $mutex = $null
  try {
    $mutex = New-Object System.Threading.Mutex($false, $MutexName)
    if (-not $mutex.WaitOne(0)) {
      Write-Log "daemon already running; not starting a second instance"
      return
    }
    $mutex.ReleaseMutex() | Out-Null
  } catch { } finally {
    if ($mutex) { $mutex.Dispose() }
  }
  if (Test-Path -LiteralPath $StopFile) { Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue }
  Start-ScheduledTask -TaskName $TaskDetect
}

function Install-Tasks {
  $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
  if (-not (Test-Path -LiteralPath $HiddenVbs)) { throw "找不到隐藏启动器：$HiddenVbs" }
  if (-not (Test-Path -LiteralPath $wscript)) { throw "找不到 wscript.exe" }

  # Drop the old 15-minute poll if it is still registered.
  Unregister-ScheduledTask -TaskName $TaskPoll -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskDetect -Confirm:$false -ErrorAction SilentlyContinue

  $arg = "//nologo //B `"$HiddenVbs`""
  $action = New-ScheduledTaskAction -Execute $wscript -Argument $arg
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  $settings.Hidden = $true
  $settings.DisallowStartIfOnBatteries = $false
  $settings.StopIfGoingOnBatteries = $false
  $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
  Register-ScheduledTask -TaskName $TaskDetect -Action $action -Trigger $logonTrigger -Settings $settings -User $userId -Force | Out-Null

  $t1 = Get-ScheduledTask -TaskName $TaskDetect -ErrorAction Stop
  $arg1 = [string]$t1.Actions.Arguments
  $exe1 = [string]$t1.Actions.Execute
  if ($exe1 -notlike "*wscript.exe*" -or $arg1 -notlike "*reapply-hidden.vbs*") {
    throw "计划任务未写入隐藏启动器： $exe1 $arg1"
  }
  $pollGone = $null -eq (Get-ScheduledTask -TaskName $TaskPoll -ErrorAction SilentlyContinue)
  if (-not $pollGone) { throw "未能移除 15 分钟轮询任务 $TaskPoll" }

  Start-HiddenDaemon
  Write-Log ("scheduled task installed: {0} (state={1}), hidden launcher, no poll, script={2}" -f $TaskDetect, $t1.State, $HiddenVbs)
}

function Uninstall-Tasks {
  Stop-DaemonInstance
  try { Stop-ScheduledTask -TaskName $TaskDetect -ErrorAction SilentlyContinue } catch { }
  schtasks /Delete /TN $TaskDetect /F 2>$null | Out-Null
  schtasks /Delete /TN $TaskPoll /F 2>$null | Out-Null
  Start-Sleep -Milliseconds 800
  if (Test-Path -LiteralPath $StopFile) {
    Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue
  }
  Write-Log "scheduled tasks removed; daemon stop requested"
}

function Invoke-DaemonCycle([string]$reason) {
  $det = Get-Detection
  Write-Log ("daemon cycle reason={0} action={1} running={2} {3}" -f $reason, $det.action, $det.running, $det.reason)
  if ($det.action -eq "disabled" -or $det.action -eq "already-applied" -or $det.action -eq "missing-install") {
    $script:pendingApply = $false
    return $det
  }
  if ($det.action -eq "needs-apply") {
    if ($det.running -gt 0) {
      Write-Log ("pending: Cursor is running (count={0}). Waiting for a clean quit; will not kill it. {1}" -f $det.running, $det.reason)
      $script:pendingApply = $true
      return $det
    }
    $script:pendingApply = $false
    Invoke-Apply -version $det.version | Out-Null
  }
  return $det
}

function Start-DaemonLoop {
  $mutex = New-Object System.Threading.Mutex($false, $MutexName)
  if (-not $mutex.WaitOne(0)) {
    Write-Log "daemon already running"
    exit 0
  }
  $watchers = @()
  $subscribers = @()
  try {
    if (Test-Path -LiteralPath $StopFile) { Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue }
    Write-Log "daemon start"
    $script:pendingApply = $false
    $sync = [hashtable]::Synchronized(@{ fsPending = $false })

    $watchRoots = @()
    $res = Join-Path $InstallRoot "resources"
    if (Test-Path -LiteralPath $res) { $watchRoots += $res }
    elseif (Test-Path -LiteralPath $InstallRoot) { $watchRoots += $InstallRoot }

    foreach ($dir in $watchRoots) {
      $w = New-Object System.IO.FileSystemWatcher
      $w.Path = $dir
      $w.IncludeSubdirectories = $true
      $w.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::DirectoryName -bor [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Size
      $w.EnableRaisingEvents = $true
      foreach ($evt in @("Changed","Created","Deleted","Renamed")) {
        $subscribers += Register-ObjectEvent -InputObject $w -EventName $evt -MessageData $sync -Action {
          $event.MessageData.fsPending = $true
        }
      }
      $watchers += $w
    }

    Invoke-DaemonCycle "startup" | Out-Null
    $lastPendingPoll = Get-Date
    while (-not (Test-Path -LiteralPath $StopFile)) {
      if ($sync.fsPending) {
        Start-Sleep -Milliseconds 1500
        $sync.fsPending = $false
        Invoke-DaemonCycle "fs-change" | Out-Null
      }
      if ($script:pendingApply) {
        $now = Get-Date
        if (($now - $lastPendingPoll).TotalSeconds -ge 15) {
          $lastPendingPoll = $now
          if ((Get-ProcessCount) -eq 0) {
            Invoke-DaemonCycle "process-exited" | Out-Null
          }
        }
      }
      Start-Sleep -Milliseconds 1000
    }
    Write-Log "daemon stop requested"
  } finally {
    foreach ($s in $subscribers) {
      try { Unregister-Event -SourceIdentifier $s.Name -ErrorAction SilentlyContinue } catch { }
    }
    foreach ($w in $watchers) {
      try { $w.EnableRaisingEvents = $false; $w.Dispose() } catch { }
    }
    try { $mutex.ReleaseMutex() | Out-Null } catch { }
    $mutex.Dispose()
    if (Test-Path -LiteralPath $StopFile) { Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue }
  }
}

# ---- commands ----
if ($InstallTask) { Install-Tasks; exit 0 }
if ($UninstallTask) { Uninstall-Tasks; exit 0 }
if ($StopDaemon) { Stop-DaemonInstance; exit 0 }
if ($Daemon) { Start-DaemonLoop; exit 0 }
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
