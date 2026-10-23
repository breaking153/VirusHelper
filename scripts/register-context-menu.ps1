param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$ShellExtensionPath
)
$ErrorActionPreference = 'Stop'
$executable = (Get-Item -LiteralPath $ExecutablePath).FullName
$extension = (Get-Item -LiteralPath $ShellExtensionPath).FullName
if ([IO.Path]::GetExtension($executable) -ne '.exe' -or [IO.Path]::GetExtension($extension) -ne '.dll') {
    throw 'Expected a Windows executable and a native Shell extension DLL.'
}
if ([IO.Path]::GetFileName($executable) -ne 'virus-helper.exe' -or [IO.Path]::GetDirectoryName($executable) -ne [IO.Path]::GetDirectoryName($extension)) {
    throw 'Place virus-helper.exe and its versioned Shell extension DLL in the same directory.'
}
$classId = '{6F5D6C28-415B-48EE-B3E8-BAAD03A18D41}'
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
try {
    $entries = @{
        "Software\Classes\CLSID\$classId" = 'VirusHelper Shell Extension'
        "Software\Classes\CLSID\$classId\InprocServer32" = $extension
        "Software\Classes\AllFilesystemObjects\shellex\ContextMenuHandlers\$classId" = $classId
        "Software\Classes\AllFilesystemObjects\shellex\PropertySheetHandlers\$classId" = $classId
    }
    foreach ($path in $entries.Keys) {
        $key = $registry.CreateSubKey($path)
        try { $key.SetValue('', $entries[$path], [Microsoft.Win32.RegistryValueKind]::String) }
        finally { $key.Dispose() }
    }
    $server = $registry.OpenSubKey("Software\Classes\CLSID\$classId\InprocServer32", $true)
    try { $server.SetValue('ThreadingModel', 'Apartment') }
    finally { $server.Dispose() }
    foreach ($kind in @('*', 'Directory')) {
        $registry.DeleteSubKeyTree("Software\Classes\$kind\shell\VirusHelper.Hash", $false)
    }
} finally { $registry.Dispose() }
if (-not ('VirusHelper.Associations' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace VirusHelper {
    public static class Associations {
        [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b);
    }
}
"@
}
[VirusHelper.Associations]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "VirusHelper COM handlers registered for the current user: $extension"
Write-Output 'Windows 11: this OpenHashTab-style handler uses the classic context menu and file Properties.'