#requires -Version 5.1
<#
.SYNOPSIS
  Register the OddsOnDeck Close Capture task for the logged-on user.

.DESCRIPTION
  Creates task "OddsOnDeck Close Capture" for the current user. Logon
  type is Interactive, so Windows stores no password and the task runs
  only while this user is logged on. A second start is ignored
  (MultipleInstances IgnoreNew).

  Enabled is set on the task settings before Register-ScheduledTask.
  The default is Enabled = $false. -Enable sets Enabled = $true on that
  same object. This script never enables the task and then disables it.

  Triggers are a handful of daily repeats (one per :04/:16/:26/:36/:46/:56),
  not one trigger per hour. Windows allows 48. The wrapper drops fires
  outside Sunday 09-23, Saturday 12-23, and Monday-Friday 18-23 ET.
  The laptop time zone must be Eastern Standard Time. ExecutionTimeLimit
  matches the longest run that still ends by the next :04:50.
#>
# Arguments are parsed by hand so an unexpected value is never echoed.
$Enable = $false
foreach ($arg in @($args)) {
  if ($arg -eq '-Enable') {
    $Enable = $true
  } else {
    Write-Error 'Unknown argument. Pass -Enable to leave the task enabled.'
    exit 1
  }
}

$ErrorActionPreference = 'Stop'

if ([System.TimeZoneInfo]::Local.Id -ne 'Eastern Standard Time') {
  Write-Error 'The laptop time zone must be Eastern Standard Time. Triggers use local time.'
  exit 1
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$wrapper = Join-Path $PSScriptRoot 'scheduled-close-capture.ps1'
$helper = Join-Path $PSScriptRoot 'close-capture-summary.mjs'
$taskName = 'OddsOnDeck Close Capture'

if (-not (Test-Path -LiteralPath $wrapper)) {
  Write-Error 'scheduled-close-capture.ps1 is missing.'
  exit 1
}

$preference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$nodeExit = 1
try {
  $raw = & node $helper triggers 2>$null
  if ($null -ne $LASTEXITCODE) { $nodeExit = $LASTEXITCODE }
} finally {
  $ErrorActionPreference = $preference
}
if ($nodeExit -ne 0 -or -not $raw) {
  Write-Error 'Could not build the trigger list.'
  exit 1
}
$spec = ($raw | Out-String).Trim() | ConvertFrom-Json
$triggerSpecs = @($spec.triggers)
if ($triggerSpecs.Count -lt 1 -or $triggerSpecs.Count -gt 48) {
  Write-Error 'Refusing to register a task outside the Windows 48-trigger limit.'
  exit 1
}

$triggers = @()
foreach ($item in $triggerSpecs) {
  $at = Get-Date -Hour ([int]$item.startHour) -Minute ([int]$item.minute) -Second 0
  # -Daily and -RepetitionInterval are different parameter sets. Build the
  # daily trigger, then copy Repetition from a -Once trigger.
  $daily = New-ScheduledTaskTrigger -Daily -At $at
  $once = New-ScheduledTaskTrigger -Once -At $at `
    -RepetitionInterval (New-TimeSpan -Minutes ([int]$item.intervalMinutes)) `
    -RepetitionDuration (New-TimeSpan -Minutes ([int]$item.durationMinutes))
  $daily.Repetition = $once.Repetition
  $triggers += $daily
}

$limitSeconds = [int]$spec.executionTimeLimitSeconds
if ($limitSeconds -lt 1) {
  Write-Error 'Could not read the execution time limit.'
  exit 1
}

$argument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$wrapper`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $repoRoot
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable:$false -RestartCount 0 -ExecutionTimeLimit (New-TimeSpan -Seconds $limitSeconds)
$settings.Enabled = $false
if ($Enable) {
  $settings.Enabled = $true
}
$task = New-ScheduledTask -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'OddsOnDeck close capture. Interactive only. Disabled until enabled.'

Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
if ($Enable) {
  Write-Output "Registered '$taskName' enabled ($($triggers.Count) repeating triggers)."
} else {
  Write-Output "Registered '$taskName' disabled ($($triggers.Count) repeating triggers). Re-run with -Enable to turn it on."
}
