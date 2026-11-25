$ErrorActionPreference = "SilentlyContinue"
$list = @()
Get-Process | Where-Object {
  $_.ProcessName -match '^(Cursor|cursor)$'
} | ForEach-Object {
  $list += ("{0}`t{1}`t{2}" -f $_.Id, $_.ProcessName, $_.Path)
}
# Also count processes whose executable lives in the Cursor install dir (tray / leftover).
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $p = $_.ExecutablePath
  if ($p -and ($p -like '*\Programs\cursor\*' -or $p -like '*\Programs\Cursor\*') -and ($_.Name -match '^(Cursor|cursor)\.exe$')) {
    $line = "{0}`t{1}`t{2}" -f $_.ProcessId, $_.Name, $p
    if ($list -notcontains $line) { $list += $line }
  }
}
if ($list.Count -gt 0) {
  $list -join "`n"
} else {
  Write-Output "running=none"
}
exit 0
