#requires -Version 5.1
<#
.SYNOPSIS
  One NFL and NHL close-capture pass for the Windows ops laptop.

.DESCRIPTION
  Runs from the repo root. Requires the Windows time zone Eastern
  Standard Time. Skips ET minutes 05-15, and also skips fires outside
  Sunday 09-23, Saturday 12-23, and Monday-Friday 18-23, or off the
  :04/:16/:26/:36/:46/:56 minute grid.

  Holds a file lock so two runs cannot overlap. A node PID stored in
  that lock is stopped if it is still alive, and the Node child is
  placed in a kill-on-close job so an orphan dies with this process.
  The child is also killed at :04:50 ET, before the quiet window, and
  that deadline is passed to Node.

  Dry-runs first. Applies at most once, with --max-calls at most 10
  and --max-credits 150. Never retries.

  Daily usage is .local/clv-capture-calls/YYYY-MM-DD.txt (ET). Line 1 is
  calls used. Line 2 is cap=N (default 20). When remaining is 0 and the
  dry run still plans calls, the cap goes up by 20, but not past the
  hard ceiling (default 80, CLOSE_CAPTURE_CALL_CEILING). An empty or
  corrupt usage file is an error. Writes go to a temp file and rename
  into place.

.PARAMETER DryRunOnly
  Stop after the dry run. Does not apply, raise the cap, or change usage.
#>
# Arguments are parsed by hand so an unexpected value is never echoed.
$DryRunOnly = $false
$badArgs = $false
foreach ($arg in @($args)) {
  if ($arg -eq '-DryRunOnly') {
    $DryRunOnly = $true
  } else {
    $badArgs = $true
  }
}

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
$helper = Join-Path $PSScriptRoot 'close-capture-summary.mjs'
$utf8 = New-Object System.Text.UTF8Encoding $false

if (-not ('CloseCaptureJob' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CloseCaptureJob {
    const int JobObjectExtendedLimitInformation = 9;
    const uint KillOnJobClose = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const uint GENERIC_WRITE = 0x40000000;
    const uint CREATE_ALWAYS = 2;
    const uint FILE_ATTRIBUTE_NORMAL = 0x80;
    const uint FILE_SHARE_READ = 0x00000001;
    static readonly System.IntPtr InvalidHandle = new System.IntPtr(-1);
    [StructLayout(LayoutKind.Explicit)]
    struct Limits {
        [FieldOffset(0)] public long PerProcessUserTimeLimit;
        [FieldOffset(8)] public long PerJobUserTimeLimit;
        [FieldOffset(16)] public uint LimitFlags;
        [FieldOffset(24)] public System.UIntPtr MinimumWorkingSetSize;
        [FieldOffset(32)] public System.UIntPtr MaximumWorkingSetSize;
        [FieldOffset(40)] public uint ActiveProcessLimit;
        [FieldOffset(48)] public System.UIntPtr Affinity;
        [FieldOffset(56)] public uint PriorityClass;
        [FieldOffset(60)] public uint SchedulingClass;
        [FieldOffset(64)] public ulong ReadOperationCount;
        [FieldOffset(72)] public ulong WriteOperationCount;
        [FieldOffset(80)] public ulong OtherOperationCount;
        [FieldOffset(88)] public ulong ReadTransferCount;
        [FieldOffset(96)] public ulong WriteTransferCount;
        [FieldOffset(104)] public ulong OtherTransferCount;
        [FieldOffset(112)] public System.UIntPtr ProcessMemoryLimit;
        [FieldOffset(120)] public System.UIntPtr JobMemoryLimit;
        [FieldOffset(128)] public System.UIntPtr PeakProcessMemoryUsed;
        [FieldOffset(136)] public System.UIntPtr PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern System.IntPtr CreateJobObject(System.IntPtr a, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(System.IntPtr job, int cls, System.IntPtr info, uint len);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(System.IntPtr job, System.IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(System.IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string app, string cmd, System.IntPtr pa, System.IntPtr ta, bool inherit, uint flags, System.IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern System.IntPtr CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa, uint disp, uint flags, System.IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(System.IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(System.IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(System.IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(System.IntPtr process, out uint code);
    [StructLayout(LayoutKind.Sequential)]
    struct SECURITY_ATTRIBUTES {
        public int nLength;
        public System.IntPtr lpSecurityDescriptor;
        public int bInheritHandle;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public System.IntPtr lpReserved2;
        public System.IntPtr hStdInput;
        public System.IntPtr hStdOutput;
        public System.IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION {
        public System.IntPtr hProcess;
        public System.IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }
    public sealed class SuspendedProcess {
        public System.IntPtr ProcessHandle;
        public System.IntPtr ThreadHandle;
        public int Pid;
        public bool Ok;
    }
    public static System.IntPtr CreateKillOnCloseJob() {
        if (System.IntPtr.Size != 8) return System.IntPtr.Zero;
        System.IntPtr handle = CreateJobObject(System.IntPtr.Zero, null);
        if (handle == System.IntPtr.Zero) return handle;
        Limits info = new Limits();
        info.LimitFlags = KillOnJobClose;
        int size = System.Runtime.InteropServices.Marshal.SizeOf(typeof(Limits));
        System.IntPtr ptr = System.Runtime.InteropServices.Marshal.AllocHGlobal(size);
        try {
            System.Runtime.InteropServices.Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, ptr, (uint)size)) {
                CloseHandle(handle);
                return System.IntPtr.Zero;
            }
        } finally {
            System.Runtime.InteropServices.Marshal.FreeHGlobal(ptr);
        }
        return handle;
    }
    public static bool Assign(System.IntPtr job, System.IntPtr process) {
        if (job == System.IntPtr.Zero || process == System.IntPtr.Zero) return false;
        return AssignProcessToJobObject(job, process);
    }
    public static SuspendedProcess StartSuspended(string application, string commandLine, string workingDirectory, string stdoutPath, string stderrPath) {
        var result = new SuspendedProcess();
        var sa = new SECURITY_ATTRIBUTES();
        sa.nLength = System.Runtime.InteropServices.Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        sa.bInheritHandle = 1;
        System.IntPtr stdout = CreateFileW(stdoutPath, GENERIC_WRITE, FILE_SHARE_READ, ref sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, System.IntPtr.Zero);
        System.IntPtr stderr = CreateFileW(stderrPath, GENERIC_WRITE, FILE_SHARE_READ, ref sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, System.IntPtr.Zero);
        if (stdout == InvalidHandle || stderr == InvalidHandle || stdout == System.IntPtr.Zero || stderr == System.IntPtr.Zero) {
            if (stdout != InvalidHandle && stdout != System.IntPtr.Zero) CloseHandle(stdout);
            if (stderr != InvalidHandle && stderr != System.IntPtr.Zero) CloseHandle(stderr);
            return result;
        }
        var si = new STARTUPINFO();
        si.cb = System.Runtime.InteropServices.Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = (int)STARTF_USESTDHANDLES;
        si.hStdInput = System.IntPtr.Zero;
        si.hStdOutput = stdout;
        si.hStdError = stderr;
        PROCESS_INFORMATION pi;
        bool created = CreateProcessW(application, commandLine, System.IntPtr.Zero, System.IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_NO_WINDOW, System.IntPtr.Zero, workingDirectory, ref si, out pi);
        CloseHandle(stdout);
        CloseHandle(stderr);
        if (!created) return result;
        result.ProcessHandle = pi.hProcess;
        result.ThreadHandle = pi.hThread;
        result.Pid = pi.dwProcessId;
        result.Ok = pi.dwProcessId > 0 && pi.hProcess != System.IntPtr.Zero && pi.hThread != System.IntPtr.Zero;
        return result;
    }
    public static bool Resume(System.IntPtr thread) {
        if (thread == System.IntPtr.Zero) return false;
        uint previous = ResumeThread(thread);
        return previous != 0xFFFFFFFFu;
    }
    public static bool Kill(System.IntPtr process) {
        if (process == System.IntPtr.Zero) return false;
        return TerminateProcess(process, 1);
    }
    public static uint Wait(System.IntPtr process, int milliseconds) {
        if (process == System.IntPtr.Zero || milliseconds < 0) return 0xFFFFFFFFu;
        return WaitForSingleObject(process, (uint)milliseconds);
    }
    public static int ExitCode(System.IntPtr process) {
        uint code;
        if (!GetExitCodeProcess(process, out code)) return 1;
        return unchecked((int)code);
    }
    public static void Release(SuspendedProcess proc) {
        if (proc == null) return;
        if (proc.ThreadHandle != System.IntPtr.Zero) {
            CloseHandle(proc.ThreadHandle);
            proc.ThreadHandle = System.IntPtr.Zero;
        }
        if (proc.ProcessHandle != System.IntPtr.Zero) {
            CloseHandle(proc.ProcessHandle);
            proc.ProcessHandle = System.IntPtr.Zero;
        }
    }
}
'@
}

function Write-CloseLog {
  param(
    [string]$Line,
    [string]$Day
  )
  if (-not $Line) { return }
  $dir = Join-Path $repoRoot '.local\logs'
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  $name = if ($Day) { "close-capture-$Day.log" } else { 'close-capture-unknown.log' }
  $path = Join-Path $dir $name
  [System.IO.File]::AppendAllText($path, ($Line + "`r`n"), $utf8)
  Write-Output $Line
}

function Invoke-Helper {
  param(
    [string[]]$HelperArgs,
    [string]$StdinText
  )
  $preference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $code = -999
  $raw = $null
  try {
    if ($null -eq $StdinText) {
      $global:LASTEXITCODE = -999
      $raw = & node $helper @HelperArgs 2>$null
    } else {
      $global:LASTEXITCODE = -999
      $raw = $StdinText | & node $helper @HelperArgs 2>$null
    }
    if ($global:LASTEXITCODE -ne 0) {
      $code = -999
      if ($null -ne $global:LASTEXITCODE) { $code = $global:LASTEXITCODE }
    } else {
      $code = 0
    }
  } finally {
    $ErrorActionPreference = $preference
  }
  return @{
    Code = $code
    Text = (($raw | Out-String).Trim())
  }
}

function Test-UsageFile {
  param([string]$File)
  if (-not (Test-Path -LiteralPath $File)) { return $false }
  $parsed = Convert-HelperJson (Invoke-Helper -HelperArgs @('read-usage', '--file', $File))
  return [bool]($parsed -and $parsed.ok)
}

function Convert-HelperJson {
  param($Result)
  if (-not $Result -or $Result.Code -ne 0 -or -not $Result.Text) { return $null }
  try {
    return ($Result.Text | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Read-LockText {
  param($Lock)
  $len = [int]$Lock.Length
  if ($len -le 0) { return '' }
  $buf = New-Object byte[] $len
  $Lock.Position = 0
  [void]$Lock.Read($buf, 0, $len)
  return $utf8.GetString($buf)
}

function Write-LockPid {
  param($Lock, [int]$ProcessId, [string]$StartTicks)
  $bytes = $utf8.GetBytes("pid=$ProcessId`r`nstartTicks=$StartTicks`r`n")
  $Lock.SetLength(0)
  $Lock.Position = 0
  $Lock.Write($bytes, 0, $bytes.Length)
  $Lock.Flush()
}

function Clear-LockPid {
  param($Lock)
  if (-not $Lock) { return }
  $Lock.SetLength(0)
  $Lock.Flush()
}

function Stop-OrphanedNode {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param($Lock)
  $text = Read-LockText -Lock $Lock
  $pidMatch = [regex]::Match($text, '(?m)^pid=(\d+)\s*$')
  $tickMatch = [regex]::Match($text, '(?m)^startTicks=(\d+)\s*$')
  if (-not $pidMatch.Success -or -not $tickMatch.Success) { return }
  $oldId = [int]$pidMatch.Groups[1].Value
  if ($oldId -le 0 -or $oldId -eq $PID) { return }
  $proc = Get-Process -Id $oldId -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.ProcessName -ne 'node') { return }
  $actualTicks = [string]$proc.StartTime.ToUniversalTime().Ticks
  $decision = Convert-HelperJson (Invoke-Helper -HelperArgs @(
    'orphan-match', '--pid', ([string]$oldId), '--start-ticks', $actualTicks
  ) -StdinText $text)
  if ($decision -and $decision.kill -and $PSCmdlet.ShouldProcess("pid=$oldId", 'Stop orphaned node')) {
    Stop-Process -Id $oldId -Force -ErrorAction SilentlyContinue
  }
}

function Get-CallCeiling {
  $raw = [string]$env:CLOSE_CAPTURE_CALL_CEILING
  if ([string]::IsNullOrWhiteSpace($raw)) { return '80' }
  if ($raw -notmatch '^\d+$') { return $null }
  return $raw
}

function Format-ProcessArgument {
  param([string]$Text)
  if ($Text -notmatch '[\s"]') { return $Text }
  return '"' + ($Text -replace '"', '\"') + '"'
}

function Get-DeadlineRemaining {
  param([string]$DeadlineIso)
  $left = Convert-HelperJson (Invoke-Helper -HelperArgs @('remaining', '--deadline', $DeadlineIso))
  if (-not $left -or -not $left.ok) { return [int64]0 }
  return [int64]$left.remainingMs
}

function Wait-CapturedExit {
  param($Started)
  if (-not $Started -or $Started.ProcessHandle -eq [IntPtr]::Zero) { return $false }
  [CloseCaptureJob]::Kill($Started.ProcessHandle) | Out-Null
  if ($Started.Pid -gt 0) {
    Stop-Process -Id $Started.Pid -Force -ErrorAction SilentlyContinue
  }
  return ([CloseCaptureJob]::Wait($Started.ProcessHandle, 30000) -eq 0)
}

function Invoke-NodeCapture {
  param(
    [string[]]$NodeArgs,
    [string]$DeadlineIso,
    $Lock,
    [IntPtr]$JobHandle
  )
  $outFile = Join-Path $repoRoot ('.local\logs\close-capture-node-{0}.out' -f ([guid]::NewGuid().ToString('n')))
  $errFile = Join-Path $repoRoot ('.local\logs\close-capture-node-{0}.err' -f ([guid]::NewGuid().ToString('n')))
  $argList = @($NodeArgs) + @('--deadline', $DeadlineIso)
  $timedOut = $false
  $aborted = $false
  $code = 1
  $text = ''
  $started = $null
  $recorded = $false
  $storedTicks = ''
  $readFailed = $false
  $exitConfirmed = $false
  try {
    if ($JobHandle -eq [IntPtr]::Zero) {
      return @{ Code = 1; Text = ''; TimedOut = $false; Aborted = $true }
    }
    $beforeStart = Get-DeadlineRemaining -DeadlineIso $DeadlineIso
    if ($beforeStart -le 0) {
      return @{ Code = 1; Text = ''; TimedOut = $true; Aborted = $false }
    }
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    $command = ((@($nodeExe) + $argList) | ForEach-Object { Format-ProcessArgument $_ }) -join ' '
    # Same order as containCapturedChild: suspended, assign, record, resume.
    $started = [CloseCaptureJob]::StartSuspended($nodeExe, $command, $repoRoot, $outFile, $errFile)
    if (-not $started.Ok) {
      return @{ Code = 1; Text = ''; TimedOut = $false; Aborted = $true }
    }
    $assigned = [CloseCaptureJob]::Assign($JobHandle, $started.ProcessHandle)
    if (-not $assigned) {
      $exitConfirmed = Wait-CapturedExit -Started $started
      $aborted = $true
      return @{ Code = 1; Text = ''; TimedOut = $false; Aborted = $true; ReadFailed = $true }
    }
    $live = Get-Process -Id $started.Pid -ErrorAction SilentlyContinue
    if (-not $live -or $live.ProcessName -ne 'node') {
      $exitConfirmed = Wait-CapturedExit -Started $started
      $aborted = $true
      return @{ Code = 1; Text = ''; TimedOut = $false; Aborted = $true; ReadFailed = $true }
    }
    $storedTicks = [string]$live.StartTime.ToUniversalTime().Ticks
    Write-LockPid -Lock $Lock -ProcessId $started.Pid -StartTicks $storedTicks
    $recorded = $true
    $resumed = [CloseCaptureJob]::Resume($started.ThreadHandle)
    if (-not $resumed) {
      $exitConfirmed = Wait-CapturedExit -Started $started
      $aborted = $true
      return @{ Code = 1; Text = ''; TimedOut = $false; Aborted = $true; ReadFailed = $true }
    }
    $remaining = Get-DeadlineRemaining -DeadlineIso $DeadlineIso
    if ($remaining -le 0) {
      $timedOut = $true
      $code = 1
      $exitConfirmed = Wait-CapturedExit -Started $started
    } else {
      $waitMs = [int][Math]::Min(2147483647, $remaining)
      $wait = [CloseCaptureJob]::Wait($started.ProcessHandle, $waitMs)
      if ($wait -ne 0) {
        $timedOut = $true
        $code = 1
        # Same order as settleCapturedChild: kill, confirm exit, then read.
        $exitConfirmed = Wait-CapturedExit -Started $started
      } else {
        $code = [CloseCaptureJob]::ExitCode($started.ProcessHandle)
        $exitConfirmed = $true
      }
    }
    if ($exitConfirmed) {
      try {
        $stdout = ''
        $stderr = ''
        if (Test-Path -LiteralPath $outFile) { $stdout = [System.IO.File]::ReadAllText($outFile) }
        if (Test-Path -LiteralPath $errFile) { $stderr = [System.IO.File]::ReadAllText($errFile) }
        $text = $stdout + $stderr
      } catch {
        $readFailed = $true
        $text = ''
      }
    } else {
      $readFailed = $true
      $text = ''
    }
  } finally {
    # Ownership and handles are dropped only after the exit is confirmed
    # and the output read above has finished.
    if ($exitConfirmed) {
      if ($recorded) { Clear-LockPid -Lock $Lock }
      if ($started) { [CloseCaptureJob]::Release($started) }
      if (Test-Path -LiteralPath $outFile) { Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue }
      if (Test-Path -LiteralPath $errFile) { Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue }
    }
  }
  return @{ Code = $code; Text = $text; TimedOut = $timedOut; Aborted = $aborted; ReadFailed = $readFailed }
}

if ([System.TimeZoneInfo]::Local.Id -ne 'Eastern Standard Time') {
  $tzClock = Convert-HelperJson (Invoke-Helper -HelperArgs @('quiet-now'))
  $tzDay = if ($tzClock) { [string]$tzClock.date } else { 'unknown' }
  $badTz = Invoke-Helper -HelperArgs @('line', '--reason', 'timezone', '--status', 'failed')
  Write-CloseLog -Line $badTz.Text -Day $tzDay
  exit 0
}

if ($badArgs) {
  $clock = Convert-HelperJson (Invoke-Helper -HelperArgs @('quiet-now'))
  $day = if ($clock) { [string]$clock.date } else { 'unknown' }
  $failed = Invoke-Helper -HelperArgs @('line', '--reason', 'bad-args')
  Write-CloseLog -Line $failed.Text -Day $day
  exit 0
}

$tz = Convert-HelperJson (Invoke-Helper -HelperArgs @('assert-tz', '--id', [System.TimeZoneInfo]::Local.Id))
if (-not $tz -or -not $tz.ok) {
  $clock = Convert-HelperJson (Invoke-Helper -HelperArgs @('quiet-now'))
  $day = if ($clock) { [string]$clock.date } else { 'unknown' }
  $badTz = Invoke-Helper -HelperArgs @('line', '--reason', 'timezone', '--status', 'failed')
  Write-CloseLog -Line $badTz.Text -Day $day
  exit 0
}

$clock = Convert-HelperJson (Invoke-Helper -HelperArgs @('quiet-now'))
if (-not $clock) {
  Write-CloseLog -Line 'CLOSE_CAPTURE_STATUS=failed reason=clock errors=1' -Day 'unknown'
  exit 0
}
$day = [string]$clock.date
if ($clock.quiet) {
  $quietLine = Invoke-Helper -HelperArgs @('line', '--reason', 'quiet')
  Write-CloseLog -Line $quietLine.Text -Day $day
  exit 0
}

$slot = Convert-HelperJson (Invoke-Helper -HelperArgs @('schedule-now'))
if (-not $slot -or -not $slot.allowed) {
  $off = Invoke-Helper -HelperArgs @('line', '--reason', 'schedule')
  Write-CloseLog -Line $off.Text -Day $day
  exit 0
}

$ceiling = Get-CallCeiling
if ($null -eq $ceiling) {
  $badCeiling = Invoke-Helper -HelperArgs @('line', '--reason', 'bad-args', '--status', 'failed')
  Write-CloseLog -Line $badCeiling.Text -Day $day
  exit 0
}

$deadline = Convert-HelperJson (Invoke-Helper -HelperArgs @('deadline'))
$deadlineIso = if ($deadline) { [string]$deadline.iso } else { '' }
if (-not $deadlineIso -or (Get-DeadlineRemaining -DeadlineIso $deadlineIso) -le 0) {
  $due = Invoke-Helper -HelperArgs @('line', '--reason', 'deadline', '--status', 'failed')
  Write-CloseLog -Line $due.Text -Day $day
  exit 0
}

$usageDir = Join-Path $repoRoot '.local\clv-capture-calls'
if (-not (Test-Path -LiteralPath $usageDir)) {
  New-Item -ItemType Directory -Path $usageDir | Out-Null
}
$logDir = Join-Path $repoRoot '.local\logs'
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}
$usageFile = Join-Path $usageDir ($day + '.txt')
$lockPath = Join-Path $usageDir 'close-capture.lock'
$lock = $null
$jobHandle = [IntPtr]::Zero
try {
  $lock = [System.IO.File]::Open(
    $lockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
} catch {
  $locked = Invoke-Helper -HelperArgs @('line', '--reason', 'locked')
  Write-CloseLog -Line $locked.Text -Day $day
  exit 0
}

try {
  Stop-OrphanedNode -Lock $lock
  $jobHandle = [CloseCaptureJob]::CreateKillOnCloseJob()
  if ($jobHandle -eq [IntPtr]::Zero) {
    $noJob = Invoke-Helper -HelperArgs @('line', '--reason', 'job', '--status', 'failed')
    Write-CloseLog -Line $noJob.Text -Day $day
    exit 0
  }

  $usage = Convert-HelperJson (Invoke-Helper -HelperArgs @('read-usage', '--file', $usageFile))
  if (-not $usage -or -not $usage.ok) {
    $badUsage = Invoke-Helper -HelperArgs @('line', '--reason', 'usage-unreadable', '--status', 'failed')
    Write-CloseLog -Line $badUsage.Text -Day $day
    exit 0
  }

  $dry = Invoke-NodeCapture -NodeArgs @(
    'scripts/capture-published-closes.js', '--nfl-all', '--nhl-all', '--game-lines', '--spreads', '--dry-run'
  ) -DeadlineIso $deadlineIso -Lock $lock -JobHandle $jobHandle
  if ($dry.Aborted) {
    $aborted = Invoke-Helper -HelperArgs @('line', '--reason', 'job', '--status', 'failed')
    Write-CloseLog -Line $aborted.Text -Day $day
    exit 0
  }
  if ($dry.TimedOut) {
    $killed = Invoke-Helper -HelperArgs @('line', '--reason', 'deadline', '--status', 'failed')
    Write-CloseLog -Line $killed.Text -Day $day
    exit 0
  }
  if ($dry.ReadFailed -or $dry.Code -ne 0) {
    $crashed = Invoke-Helper -HelperArgs @('line', '--reason', 'plan-unknown', '--status', 'failed')
    Write-CloseLog -Line $crashed.Text -Day $day
    exit 0
  }

  $planArgs = @(
    'plan',
    '--calls-used', [string]([int]$usage.callsUsed),
    '--cap', [string]([int]$usage.cap),
    '--ceiling', $ceiling
  )
  if ($DryRunOnly) { $planArgs += '--dry-run-only' }
  $plan = Convert-HelperJson (Invoke-Helper -HelperArgs $planArgs -StdinText $dry.Text)
  if (-not $plan) {
    $unparsed = Invoke-Helper -HelperArgs @('line', '--reason', 'plan-unknown', '--status', 'failed')
    Write-CloseLog -Line $unparsed.Text -Day $day
    exit 0
  }

  $raisedBy = 0
  if ($null -ne $plan.raisedBy) { $raisedBy = [int]$plan.raisedBy }
  $nextCap = [int]$usage.cap
  if ($null -ne $plan.cap) { $nextCap = [int]$plan.cap }
  if (-not $DryRunOnly -and $nextCap -ne [int]$usage.cap) {
    $raised = Invoke-Helper -HelperArgs @(
      'write-usage', '--file', $usageFile,
      '--calls', [string]([int]$usage.callsUsed),
      '--cap', [string]$nextCap
    )
    if ($raised.Code -ne 0 -or -not (Test-UsageFile -File $usageFile)) {
      $writeFailed = Invoke-Helper -HelperArgs @('line', '--reason', 'summary-failed', '--status', 'failed')
      Write-CloseLog -Line $writeFailed.Text -Day $day
      exit 0
    }
  }

  $action = [string]$plan.action
  $plannedText = '0'
  if ($null -ne $plan.planned) { $plannedText = [string]([int]$plan.planned) }
  $ceilingHit = @()
  if ($plan.ceilingHit) { $ceilingHit = @('--ceiling-hit') }
  if ($action -ne 'apply') {
    $reason = [string]$plan.reason
    $finishArgs = @(
      'finalize',
      '--cap', [string]$nextCap,
      '--ceiling', $ceiling,
      '--raised-by', [string]$raisedBy,
      '--planned', $plannedText,
      '--reason', $reason
    ) + $ceilingHit
    if ($DryRunOnly) { $finishArgs += '--dry-run-only' }
    $finished = Invoke-Helper -HelperArgs $finishArgs -StdinText $dry.Text
    if ($finished.Code -ne 0 -or -not $finished.Text) {
      $finished = Invoke-Helper -HelperArgs @('line', '--reason', 'summary-failed', '--status', 'failed')
    }
    Write-CloseLog -Line $finished.Text -Day $day
    exit 0
  }

  $stillLeft = Get-DeadlineRemaining -DeadlineIso $deadlineIso
  if ($stillLeft -le 0) {
    $dueArgs = @('line', '--reason', 'deadline', '--status', 'failed', '--ceiling', $ceiling) + $ceilingHit
    $due = Invoke-Helper -HelperArgs $dueArgs
    Write-CloseLog -Line $due.Text -Day $day
    exit 0
  }
  $apply = Invoke-NodeCapture -NodeArgs @(
    'scripts/capture-published-closes.js', '--nfl-all', '--nhl-all', '--game-lines', '--spreads', '--apply',
    '--max-calls', ([string]([int]$plan.maxCalls)),
    '--max-credits', ([string]([int]$plan.maxCredits))
  ) -DeadlineIso $deadlineIso -Lock $lock -JobHandle $jobHandle
  if ($apply.Aborted) {
    $applyAborted = Invoke-Helper -HelperArgs @('line', '--reason', 'job', '--status', 'failed')
    Write-CloseLog -Line $applyAborted.Text -Day $day
    exit 0
  }
  $extraErrors = '0'
  $reasonArgs = @()
  $readArgs = @()
  if ($apply.TimedOut -or $apply.Code -ne 0 -or $apply.ReadFailed) {
    $extraErrors = '1'
    if ($apply.TimedOut) { $reasonArgs = @('--reason', 'deadline') }
  }
  if ($apply.ReadFailed) {
    $readArgs = @('--read-failed', '--reserved-calls', ([string]([int]$plan.maxCalls)))
  }
  $finalArgs = @(
    'finalize',
    '--cap', [string]$nextCap,
    '--ceiling', $ceiling,
    '--raised-by', [string]$raisedBy,
    '--planned', $plannedText,
    '--calls-used', [string]([int]$usage.callsUsed),
    '--usage-file', $usageFile,
    '--extra-errors', $extraErrors,
    '--record-calls'
  ) + $ceilingHit + $reasonArgs + $readArgs
  $final = Invoke-Helper -HelperArgs $finalArgs -StdinText $apply.Text
  if ($final.Code -ne 0 -or -not $final.Text) {
    $charged = [int]$plannedText
    if ($apply.ReadFailed) { $charged = [int]$plan.maxCalls }
    $fallbackUsed = [int]$usage.callsUsed + $charged
    $fallbackWrite = Invoke-Helper -HelperArgs @(
      'write-usage', '--file', $usageFile,
      '--calls', [string]$fallbackUsed,
      '--cap', [string]$nextCap
    )
    if ($fallbackWrite.Code -ne 0 -or -not (Test-UsageFile -File $usageFile)) {
      $final = Invoke-Helper -HelperArgs @('line', '--reason', 'summary-failed', '--status', 'failed')
    } else {
      $final = Invoke-Helper -HelperArgs @('line', '--reason', 'summary-failed', '--status', 'failed')
    }
  }
  Write-CloseLog -Line $final.Text -Day $day
  exit 0
} finally {
  if ($jobHandle -ne [IntPtr]::Zero) {
    [CloseCaptureJob]::CloseHandle($jobHandle) | Out-Null
  }
  if ($lock) { $lock.Dispose() }
}
