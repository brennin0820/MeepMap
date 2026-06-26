' Creates a Desktop shortcut that launches MeepMap (no command window).

Option Explicit

Dim fso, shell, scriptDir, exePath, launcherPath, desktop, shortcut, target, args

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

exePath = FindMeepMapExe(scriptDir)
launcherPath = fso.BuildPath(scriptDir, "Start MeepMap.vbs")

If exePath = "" And Not fso.FileExists(launcherPath) Then
  MsgBox "MeepMap could not be found." & vbCrLf & vbCrLf & _
    "Extract the full folder from the zip, then run this again.", _
    vbCritical + vbOKOnly, "MeepMap"
  WScript.Quit 1
End If

desktop = shell.SpecialFolders("Desktop")
Set shortcut = shell.CreateShortcut(desktop & "\MeepMap.lnk")

If exePath <> "" Then
  shortcut.TargetPath = exePath
  shortcut.WorkingDirectory = fso.GetParentFolderName(exePath)
Else
  shortcut.TargetPath = "wscript.exe"
  shortcut.Arguments = "//B """ & launcherPath & """"
  shortcut.WorkingDirectory = scriptDir
End If

shortcut.Description = "Launch MeepMap"
shortcut.Save

MsgBox "A MeepMap shortcut was added to your Desktop.", vbInformation + vbOKOnly, "MeepMap"

Function FindMeepMapExe(baseDir)
  Dim candidates, i, candidate
  candidates = Array( _
    fso.BuildPath(baseDir, "MeepMap.exe"), _
    fso.BuildPath(baseDir, "win-unpacked\MeepMap.exe") _
  )
  For i = 0 To UBound(candidates)
    candidate = candidates(i)
    If fso.FileExists(candidate) Then
      FindMeepMapExe = candidate
      Exit Function
    End If
  Next
  FindMeepMapExe = ""
End Function
