param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP) { throw 'This installer smoke test is only for an isolated CI runner.' }
$classId = '{6F5D6C28-415B-48EE-B3E8-BAAD03A18D41}'
$paths = @(
    "Software\Classes\CLSID\$classId",
    "Software\Classes\AllFilesystemObjects\shellex\ContextMenuHandlers\$classId",
    "Software\Classes\AllFilesystemObjects\shellex\PropertySheetHandlers\$classId"
)
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
$work = Join-Path $env:RUNNER_TEMP "VirusHelper-installer-$([Guid]::NewGuid().ToString('N'))"
$installDir = Join-Path $work 'Installed App'
$installerPath = (Get-Item -LiteralPath $Installer).FullName
function Run-Installer([string]$File, [string]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(120000)) { $process.Kill(); throw "Installer timed out: $File" }
    if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode): $File" }
}
try {
    foreach ($path in $paths) {
        $existing = $registry.OpenSubKey($path)
        if ($existing) { $existing.Dispose(); throw 'Refusing to replace an existing VirusHelper Shell registration.' }
    }
    New-Item -ItemType Directory -Path $work | Out-Null
    Run-Installer $installerPath "/S /D=$installDir"
    $exe = Join-Path $installDir 'virus-helper.exe'
    $dll = Join-Path $installDir "virushelper_shell-$Version.dll"
    if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $dll)) { throw 'Installer did not deploy the executable and versioned COM DLL.' }
    $server = $registry.OpenSubKey("Software\Classes\CLSID\$classId\InprocServer32")
    if (-not $server) { throw 'Installer did not register InprocServer32.' }
    try {
        if ($server.GetValue('') -ne $dll -or $server.GetValue('ThreadingModel') -ne 'Apartment') { throw 'Installer registered an incorrect COM server.' }
    } finally { $server.Dispose() }
    foreach ($path in $paths[1..2]) {
        $key = $registry.OpenSubKey($path)
        if (-not $key) { throw "Installer did not register $path" }
        try { if ($key.GetValue('') -ne $classId) { throw 'Incorrect Shell handler CLSID.' } }
        finally { $key.Dispose() }
    }
    $approvedPath = 'Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved'
    $approved = $registry.OpenSubKey($approvedPath)
    if (-not $approved) { throw 'Installer did not register the per-user Approved entry.' }
    try { if ($approved.GetValue($classId) -ne 'VirusHelper Shell Extension') { throw 'Installer did not approve its own per-user Shell extension.' } }
    finally { $approved.Dispose() }
    Write-Output "Windows version: $([Environment]::OSVersion.VersionString); interactive: $([Environment]::UserInteractive); session: $([Diagnostics.Process]::GetCurrentProcess().SessionId)"
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
        $policyRoot = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
        try {
            $policy = $policyRoot.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Policies\Explorer')
            if ($policy) { try { Write-Output "$hive EnforceShellExtensionSecurity=$($policy.GetValue('EnforceShellExtensionSecurity'))" } finally { $policy.Dispose() } }
        } finally { $policyRoot.Dispose() }
    }
    $first = Join-Path $work '测试 one & sample.txt'
    $second = Join-Path $work '测试 two.txt'
    [IO.File]::WriteAllBytes($first, [Text.Encoding]::UTF8.GetBytes('abc'))
    [IO.File]::WriteAllBytes($second, [Text.Encoding]::UTF8.GetBytes('def'))
    cargo run --locked -p windows-shell --example verify_registration -- $first $second
    if ($LASTEXITCODE -ne 0) { throw 'Installed COM activation or Explorer context-menu verification failed.' }
    Write-Output 'Installer deployment, COM server, classic context menu and property sheet: PASS'
} finally {
    try {
        $uninstaller = Join-Path $installDir 'uninstall.exe'
        if (Test-Path -LiteralPath $uninstaller) {
            Run-Installer $uninstaller "/S _?=$installDir"
            foreach ($path in $paths) {
                $key = $registry.OpenSubKey($path)
                if ($key) { $key.Dispose(); throw "Uninstaller left registration behind: $path" }
            }
            $approved = $registry.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved')
            if ($approved) { try { if ($null -ne $approved.GetValue($classId)) { throw 'Uninstaller left its Approved entry behind.' } } finally { $approved.Dispose() } }
            Write-Output 'Uninstaller removed the VirusHelper Shell registrations: PASS'
        }
    } finally { $registry.Dispose() }
}
