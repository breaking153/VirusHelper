param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
)

$ErrorActionPreference = 'Stop'
$executable = (Get-Item -LiteralPath $ExecutablePath).FullName
if ([IO.Path]::GetExtension($executable) -ne '.exe' -or $executable.Contains('"')) {
    throw 'ExecutablePath must point to a Windows executable.'
}

# Use Registry APIs so the literal '*' is never expanded as a wildcard.
foreach ($kind in @('*', 'Directory')) {
    $verb = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$kind\shell\VirusHelper.Hash")
    try {
        $verb.SetValue('MUIVerb', '使用 VirusHelper 计算哈希')
        $verb.SetValue('Icon', ('"{0}",0' -f $executable))
        $verb.SetValue('MultiSelectModel', 'Single')
        $command = $verb.CreateSubKey('command')
        try { $command.SetValue('', ('"{0}" -- "%1"' -f $executable)) }
        finally { $command.Dispose() }
    } finally { $verb.Dispose() }
}
Write-Output "Context menu registered for the current user: $executable"
