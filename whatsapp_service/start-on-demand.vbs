Option Explicit

Dim fileSystem, shell, serviceDirectory, runnerPath, command

Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

serviceDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
runnerPath = fileSystem.BuildPath(serviceDirectory, "run-background.ps1")

' Use Windows' headless console host so launching the service never creates a
' Command Prompt, PowerShell, or Windows Terminal window.
command = """" & shell.ExpandEnvironmentStrings("%WINDIR%") & _
          "\System32\conhost.exe"" --headless powershell.exe" & _
          " -NoProfile -NonInteractive -File """ & runnerPath & """"

shell.Run command, 0, False
