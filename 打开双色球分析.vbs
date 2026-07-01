Option Explicit

Dim shell, fso, root, scriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(root, "scripts\ssq-local-server.ps1")
command = "powershell -NoProfile -ExecutionPolicy Bypass -File " & Quote(scriptPath) & " -Port 0 -Open"

shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function