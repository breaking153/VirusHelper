!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\*\shell\VirusHelper.Hash" "MUIVerb" "使用 VirusHelper 计算哈希"
  WriteRegStr HKCU "Software\Classes\*\shell\VirusHelper.Hash" "Icon" '$\"$INSTDIR\virus-helper.exe$\",0'
  WriteRegStr HKCU "Software\Classes\*\shell\VirusHelper.Hash" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\*\shell\VirusHelper.Hash\command" "" '$\"$INSTDIR\virus-helper.exe$\" -- $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\VirusHelper.Hash" "MUIVerb" "使用 VirusHelper 计算哈希"
  WriteRegStr HKCU "Software\Classes\Directory\shell\VirusHelper.Hash" "Icon" '$\"$INSTDIR\virus-helper.exe$\",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\VirusHelper.Hash" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\Directory\shell\VirusHelper.Hash\command" "" '$\"$INSTDIR\virus-helper.exe$\" -- $\"%1$\"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\*\shell\VirusHelper.Hash"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\VirusHelper.Hash"
!macroend
