param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) { throw 'This test creates an isolated local account and must only run on a disposable CI runner.' }
cargo build --locked -p windows-shell --example verify_registration
if ($LASTEXITCODE -ne 0) { throw 'Could not build the installed COM verification probe.' }
$name = 'vhci' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
$password = [Guid]::NewGuid().ToString('N') + 'Vh!9a'
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$work = Join-Path $env:PUBLIC ('VirusHelper-installer-ci-' + [Guid]::NewGuid().ToString('N'))
$account = $null
$process = $null
try {
    $account = New-LocalUser -Name $name -Password $securePassword -AccountNeverExpires -PasswordNeverExpires -Description 'Temporary VirusHelper installer CI test'
    $users = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
    if (-not (Get-LocalGroupMember -SID $users | Where-Object { $_.SID.Value -eq $account.SID.Value })) {
        Add-LocalGroupMember -SID $users -Member $account
    }
    New-Item -ItemType Directory -Path $work | Out-Null
    $acl = Get-Acl -LiteralPath $work
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($account.SID, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    Set-Acl -LiteralPath $work -AclObject $acl
    $copy = Join-Path $work 'VirusHelper-setup.exe'
    Copy-Item -LiteralPath (Get-Item -LiteralPath $Installer).FullName -Destination $copy
    if ((Get-FileHash -LiteralPath $copy).Hash -ne (Get-FileHash -LiteralPath $Installer).Hash) { throw 'Installer copy hash mismatch.' }
    Copy-Item 'target/debug/examples/verify_registration.exe' (Join-Path $work 'verify_registration.exe')
    Copy-Item (Join-Path $PSScriptRoot 'test-installed-windows-shell.ps1') (Join-Path $work 'test-installed-windows-shell.ps1')
    [IO.File]::WriteAllText((Join-Path $work 'version.txt'), $Version)
    $entry = Join-Path $work 'run-test.ps1'
    [IO.File]::WriteAllText($entry, @'
$ErrorActionPreference = 'Stop'
$env:RUNNER_TEMP = $PSScriptRoot
$report = Join-Path $PSScriptRoot 'verification.txt'
$code = 1
try {
    $version = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'version.txt')).Trim()
    & (Join-Path $PSScriptRoot 'test-installed-windows-shell.ps1') -Installer (Join-Path $PSScriptRoot 'VirusHelper-setup.exe') -Version $version -ProbeExecutable (Join-Path $PSScriptRoot 'verify_registration.exe') *> $report
    $code = 0
} catch { $_ | Out-File $report -Append -Encoding utf8 }
exit $code
'@, [Text.UTF8Encoding]::new($true))
    $credential = [PSCredential]::new("$env:COMPUTERNAME\$name", $securePassword)
    $process = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -Credential $credential -LoadUserProfile -WorkingDirectory $work -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$entry`"" -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(300000)) { $process.Kill(); throw 'Isolated ordinary-user installer verification timed out.' }
    $report = Join-Path $work 'verification.txt'
    if (Test-Path -LiteralPath $report) { Get-Content -LiteralPath $report -Encoding utf8 | Write-Output }
    if ($process.ExitCode -ne 0) { throw "Ordinary-user installer verification failed: $($process.ExitCode)" }
} finally {
    if ($process) { $process.Dispose() }
    if ($account) { Remove-LocalUser -SID $account.SID }
    $password = $null
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
