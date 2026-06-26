' Launch MeepMap without a command window. Place this file next to MeepMap.exe
' or one folder above win-unpacked\MeepMap.exe.

Option Explicit

Dim fso, shell, scriptDir, exePath, workDir

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

exePath = FindMeepMapExe(scriptDir)

If exePath = "" Then
  MsgBox "MeepMap could not be found." & vbCrLf & vbCrLf & _
    "Make sure you extracted the entire folder from the zip, then try again." & vbCrLf & vbCrLf & _
    "Look for MeepMap.exe in this folder or in win-unpacked\MeepMap.exe.", _
    vbCritical + vbOKOnly, "MeepMap"
  WScript.Quit 1
End If

workDir = fso.GetParentFolderName(exePath)
shell.CurrentDirectory = workDir
shell.Run """" & exePath & """", 1, False

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
