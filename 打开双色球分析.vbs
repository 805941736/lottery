Option Explicit

Dim shell, fso, root, scriptPath, launchPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(root, "scripts\ssq-local-server.ps1")
launchPath = fso.BuildPath(root, "app\launch.html")

shell.Run Quote(launchPath), 1, False
command = Quote(shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe") & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(scriptPath) & " -Port 8765"
shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function