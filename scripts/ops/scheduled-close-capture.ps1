#requires -Version 5.1
<#
.SYNOPSIS
  One NFL close-capture pass for the Windows ops laptop.

.DESCRIPTION
  Runs from the repo root. Skips ET minutes 05-15. Holds a file lock so
  two runs cannot overlap. Dry-runs first. Applies at most once, with
  --max-calls at most 10 and --max-credits 150. Never retries.

  Daily usage is .local/clv-capture-calls/YYYY-MM-DD.txt (ET). Line 1 is
  calls used. Line 2 is cap=N (default 20). When remaining is 0 and the
  dry run still plans calls, the cap goes up by 20.

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
$helper = Join-Path $PSScriptRoot 'close-capture-summary.js'
$utf8 = New-Object System.Text.UTF8Encoding $false

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
  if ($null -eq $StdinText) {
    $raw = & node $helper @HelperArgs 2>$null
  } else {
    $raw = $StdinText | & node $helper @HelperArgs 2>$null
  }
  return @{
    Code = $LASTEXITCODE
    Text = (($raw | Out-String).Trim())
  }
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

if ($badArgs) {
  $clock = Convert-HelperJson (Invoke-Helper -HelperArgs @('quiet-now'))
  $day = if ($clock) { [string]$clock.date } else { 'unknown' }
  $failed = Invoke-Helper -HelperArgs @('line', '--reason', 'bad-args')
  Write-CloseLog -Line $failed.Text -Day $day
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

$usageDir = Join-Path $repoRoot '.local\clv-capture-calls'
if (-not (Test-Path -LiteralPath $usageDir)) {
  New-Item -ItemType Directory -Path $usageDir | Out-Null
}
$usageFile = Join-Path $usageDir ($day + '.txt')
$lockPath = Join-Path $usageDir 'close-capture.lock'
$lock = $null
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
  $usage = Convert-HelperJson (Invoke-Helper -HelperArgs @('read-usage', '--file', $usageFile))
  if (-not $usage -or -not $usage.ok) {
    $badUsage = Invoke-Helper -HelperArgs @('line', '--reason', 'usage-unreadable', '--status', 'failed')
    Write-CloseLog -Line $badUsage.Text -Day $day
    exit 0
  }

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $dryOut = & node scripts/capture-published-closes.js --nfl-all --game-lines --dry-run 2>&1 | Out-String
  $dryCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($dryCode -ne 0) {
    $crashed = Invoke-Helper -HelperArgs @('line', '--reason', 'plan-unknown', '--status', 'failed')
    Write-CloseLog -Line $crashed.Text -Day $day
    exit 0
  }

  $planArgs = @(
    'plan',
    '--calls-used', [string]([int]$usage.callsUsed),
    '--cap', [string]([int]$usage.cap)
  )
  if ($DryRunOnly) { $planArgs += '--dry-run-only' }
  $plan = Convert-HelperJson (Invoke-Helper -HelperArgs $planArgs -StdinText $dryOut)
  if (-not $plan) {
    $unparsed = Invoke-Helper -HelperArgs @('line', '--reason', 'plan-unknown', '--status', 'failed')
    Write-CloseLog -Line $unparsed.Text -Day $day
    exit 0
  }

  $raisedBy = 0
  if ($null -ne $plan.raisedBy) { $raisedBy = [int]$plan.raisedBy }
  if ($raisedBy -gt 0) {
    $raised = Invoke-Helper -HelperArgs @(
      'write-usage', '--file', $usageFile,
      '--calls', [string]([int]$usage.callsUsed),
      '--cap', [string]([int]$plan.cap)
    )
    if ($raised.Code -ne 0) {
      $writeFailed = Invoke-Helper -HelperArgs @('line', '--reason', 'summary-failed', '--status', 'failed')
      Write-CloseLog -Line $writeFailed.Text -Day $day
      exit 0
    }
  }

  $action = [string]$plan.action
  $plannedText = '0'
  if ($null -ne $plan.planned) { $plannedText = [string]([int]$plan.planned) }
  if ($action -ne 'apply') {
    $reason = [string]$plan.reason
    $finishArgs = @(
      'finalize',
      '--cap', [string]([int]$plan.cap),
      '--raised-by', [string]$raisedBy,
      '--planned', $plannedText,
      '--reason', $reason
    )
    if ($DryRunOnly) { $finishArgs += '--dry-run-only' }
    $finished = Invoke-Helper -HelperArgs $finishArgs -StdinText $dryOut
    if ($finished.Code -ne 0 -or -not $finished.Text) {
      $finished = Invoke-Helper -HelperArgs @('line', '--reason', 'summary-failed', '--status', 'failed')
    }
    Write-CloseLog -Line $finished.Text -Day $day
    exit 0
  }

  $ErrorActionPreference = 'Continue'
  $applyOut = & node scripts/capture-published-closes.js --nfl-all --game-lines --apply --max-calls ([string]([int]$plan.maxCalls)) --max-credits ([string]([int]$plan.maxCredits)) 2>&1 | Out-String
  $applyCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  $extraErrors = '0'
  if ($applyCode -ne 0) { $extraErrors = '1' }
  $finalArgs = @(
    'finalize',
    '--cap', [string]([int]$plan.cap),
    '--raised-by', [string]$raisedBy,
    '--planned', $plannedText,
    '--calls-used', [string]([int]$usage.callsUsed),
    '--usage-file', $usageFile,
    '--extra-errors', $extraErrors,
    '--record-calls'
  )
  $final = Invoke-Helper -HelperArgs $finalArgs -StdinText $applyOut
  if ($final.Code -ne 0 -or -not $final.Text) {
    $fallbackUsed = [int]$usage.callsUsed + [int]$plannedText
    Invoke-Helper -HelperArgs @(
      'write-usage', '--file', $usageFile,
      '--calls', [string]$fallbackUsed,
      '--cap', [string]([int]$plan.cap)
    ) | Out-Null
    $final = Invoke-Helper -HelperArgs @('line', '--reason', 'summary-failed', '--status', 'failed')
  }
  Write-CloseLog -Line $final.Text -Day $day
  exit 0
} finally {
  if ($lock) { $lock.Dispose() }
}
