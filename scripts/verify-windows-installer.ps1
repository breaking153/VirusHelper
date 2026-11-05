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
    $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $acl = Get-Acl -LiteralPath $work
    $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($ownerSid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $work -AclObject $acl
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
    cargo build --locked -p windows-shell --example verify_registration
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the installed COM probe.' }
    $probe = Join-Path $work 'verify_registration.exe'
    Copy-Item 'target/debug/examples/verify_registration.exe' $probe
    $config = @{ executable = $probe; paths = @($first, $second); expectedSid = $ownerSid }
    [IO.File]::WriteAllText((Join-Path $work 'probe.json'), ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $probeScript = Join-Path $work 'probe.ps1'
    [IO.File]::WriteAllText($probeScript, @'
$ErrorActionPreference = 'Stop'
$report = Join-Path $PSScriptRoot 'probe-output.txt'
$exitCode = 1
try {
    $config = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'probe.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $isAdmin = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    "Normal-user probe: SID=$($identity.User.Value); administrator=$isAdmin" | Out-File $report -Encoding utf8
    if ($identity.User.Value -ne $config.expectedSid -or $isAdmin) { throw 'Probe must use the same user with a non-administrator token.' }
    & $config.executable @($config.paths) 2>&1 | Out-File $report -Append -Encoding utf8
    $exitCode = $LASTEXITCODE
} catch { $_ | Out-File $report -Append -Encoding utf8 }
finally {
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'probe-exit.tmp'), [string]$exitCode)
    Move-Item (Join-Path $PSScriptRoot 'probe-exit.tmp') (Join-Path $PSScriptRoot 'probe-exit.txt')
}
exit $exitCode
'@, [Text.UTF8Encoding]::new($true))
    # Shell intentionally treats elevated and normal-user extension discovery differently.
    # Test the installed per-user handler with a restricted medium-integrity token,
    # without changing machine policy or starting any application on a user desktop.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class VirusHelperNormalProbe {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Startup {
        public int cb;
        public string reserved, desktop, title;
        public int x, y, width, height, xChars, yChars, fill, flags;
        public short show, reservedSize;
        public IntPtr reservedPtr, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process, thread; public uint processId, threadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct Label { public IntPtr sid; public uint attributes; }
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SaferCreateLevel(uint scope, uint level, uint flags, out IntPtr handle, IntPtr reserved);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SaferComputeTokenFromLevel(IntPtr level, IntPtr input, out IntPtr output, uint flags, IntPtr reserved);
    [DllImport("advapi32.dll")] static extern bool SaferCloseLevel(IntPtr level);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ConvertStringSidToSid(string text, out IntPtr sid);
    [DllImport("advapi32.dll")] static extern uint GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SetTokenInformation(IntPtr token, int kind, IntPtr info, int size);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessWithTokenW(IntPtr token, uint logonFlags, string application, StringBuilder command, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle, uint code);
    static void Require(bool ok, string operation) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    public static int Run(string application, string script, string directory) {
        IntPtr level = IntPtr.Zero, token = IntPtr.Zero, sid = IntPtr.Zero, label = IntPtr.Zero;
        ProcessInfo process = new ProcessInfo();
        try {
            Require(SaferCreateLevel(2, 0x20000, 1, out level, IntPtr.Zero), "Create normal-user security level");
            Require(SaferComputeTokenFromLevel(level, IntPtr.Zero, out token, 0, IntPtr.Zero), "Create restricted user token");
            Require(ConvertStringSidToSid("S-1-16-8192", out sid), "Create medium integrity SID");
            int size = Marshal.SizeOf(typeof(Label)) + (int)GetLengthSid(sid);
            label = Marshal.AllocHGlobal(size);
            Marshal.StructureToPtr(new Label { sid = sid, attributes = 0x20 }, label, false);
            Require(SetTokenInformation(token, 25, label, size), "Set medium integrity level");
            var startup = new Startup { cb = Marshal.SizeOf(typeof(Startup)), desktop = "winsta0\\default", flags = 1, show = 0 };
            var command = new StringBuilder("\"" + application + "\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"");
            Require(CreateProcessWithTokenW(token, 1, application, command, 0x08000000, IntPtr.Zero, directory, ref startup, out process), "Start normal-user installer probe");
            if (WaitForSingleObject(process.process, 120000) != 0) { TerminateProcess(process.process, 1); throw new TimeoutException("Normal-user installer probe timed out"); }
            uint code;
            Require(GetExitCodeProcess(process.process, out code), "Read probe result");
            return (int)code;
        } finally {
            if (process.thread != IntPtr.Zero) CloseHandle(process.thread);
            if (process.process != IntPtr.Zero) CloseHandle(process.process);
            if (label != IntPtr.Zero) Marshal.FreeHGlobal(label);
            if (sid != IntPtr.Zero) LocalFree(sid);
            if (token != IntPtr.Zero) CloseHandle(token);
            if (level != IntPtr.Zero) SaferCloseLevel(level);
        }
    }
}
'@
    $powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $probeExit = [VirusHelperNormalProbe]::Run($powershell, $probeScript, $work)
    $report = Join-Path $work 'probe-output.txt'
    if (Test-Path -LiteralPath $report) { Get-Content -LiteralPath $report -Encoding UTF8 | Write-Output }
    if ($probeExit -ne 0) { throw "Normal-user installed COM or Explorer menu verification failed: $probeExit" }
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
