$ErrorActionPreference = 'Stop'
foreach ($kind in @('*', 'Directory')) {
    # Delete only this application's two fixed verb keys, never file associations.
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("Software\Classes\$kind\shell\VirusHelper.Hash", $false)
}
Write-Output 'VirusHelper context menu removed for the current user.'
