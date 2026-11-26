Option Explicit
' Hidden launcher for the Cursor zh-CN reapply watcher.
' Scheduled tasks that start powershell.exe directly can flash a console
' even with -WindowStyle Hidden. wscript.exe is a GUI process, and
' WshShell.Run with window style 0 starts PowerShell with no window.
Dim sh, fso, root, ps, cmd, mode, wait, i, arg
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
ps = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
mode = "-Daemon"
wait = True
For i = 0 To WScript.Arguments.Count - 1
  arg = LCase(WScript.Arguments(i))
  If arg = "-stopdaemon" Or arg = "--stop" Then
    mode = "-StopDaemon"
  ElseIf arg = "-detectonly" Then
    mode = "-DetectOnly"
  End If
Next
If Not fso.FileExists(ps) Then
  WScript.Quit 1
End If
cmd = """" & ps & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\reapply.ps1"" " & mode
sh.Run cmd, 0, wait
