$ErrorActionPreference = 'Stop'
$classId = '{6F5D6C28-415B-48EE-B3E8-BAAD03A18D41}'
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
try {
    foreach ($category in @('ContextMenuHandlers', 'PropertySheetHandlers')) {
        $registry.DeleteSubKeyTree("Software\Classes\AllFilesystemObjects\shellex\$category\$classId", $false)
    }
    $registry.DeleteSubKeyTree("Software\Classes\CLSID\$classId", $false)
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
Write-Output 'VirusHelper Shell extension unregistered for the current user.'