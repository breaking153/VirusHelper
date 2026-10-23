; Same handler categories as OpenHashTab Setup/Package.wxs; our own COM class.
!define VIRUSHELPER_SHELL_CLSID "{6F5D6C28-415B-48EE-B3E8-BAAD03A18D41}"

!macro NSIS_HOOK_POSTINSTALL
  SetRegView 64
  ; Versioned DLLs avoid overwriting a module held by Explorer during updates.
  WriteRegStr HKCU "Software\Classes\CLSID\${VIRUSHELPER_SHELL_CLSID}" "" "VirusHelper Shell Extension"
  WriteRegStr HKCU "Software\Classes\CLSID\${VIRUSHELPER_SHELL_CLSID}\InprocServer32" "" "$INSTDIR\virushelper_shell-${VERSION}.dll"
  WriteRegStr HKCU "Software\Classes\CLSID\${VIRUSHELPER_SHELL_CLSID}\InprocServer32" "ThreadingModel" "Apartment"
  WriteRegStr HKCU "Software\Classes\AllFilesystemObjects\shellex\ContextMenuHandlers\${VIRUSHELPER_SHELL_CLSID}" "" "${VIRUSHELPER_SHELL_CLSID}"
  WriteRegStr HKCU "Software\Classes\AllFilesystemObjects\shellex\PropertySheetHandlers\${VIRUSHELPER_SHELL_CLSID}" "" "${VIRUSHELPER_SHELL_CLSID}"
  DeleteRegKey HKCU "Software\Classes\*\shell\VirusHelper.Hash"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\VirusHelper.Hash"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  SetRegView 64
  DeleteRegKey HKCU "Software\Classes\AllFilesystemObjects\shellex\ContextMenuHandlers\${VIRUSHELPER_SHELL_CLSID}"
  DeleteRegKey HKCU "Software\Classes\AllFilesystemObjects\shellex\PropertySheetHandlers\${VIRUSHELPER_SHELL_CLSID}"
  DeleteRegKey HKCU "Software\Classes\CLSID\${VIRUSHELPER_SHELL_CLSID}"
  DeleteRegKey HKCU "Software\Classes\*\shell\VirusHelper.Hash"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\VirusHelper.Hash"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend