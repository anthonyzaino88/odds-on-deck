#requires -Version 5.1
<#
.SYNOPSIS
  Register the OddsOnDeck Close Capture task for the logged-on user.

.DESCRIPTION
  Creates task "OddsOnDeck Close Capture" for the current user. Logon
  type is Interactive, so Windows stores no password and the task runs
  only while this user is logged on. A second start is ignored
  (MultipleInstances IgnoreNew). The task is created disabled unless
  -Enable is passed. Triggers come from close-capture-summary.js:
  :04, :16, :26, :36, :46, :56 Eastern local time. Sunday 09-23,
  Saturday 12-23, other days 18-23. The laptop clock must be Eastern.

.PARAMETER Enable
  Leave the task enabled. Without this switch the task is registered
  and then disabled.
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$wrapper = Join-Path $PSScriptRoot 'scheduled-close-capture.ps1'
$helper = Join-Path $PSScriptRoot 'close-capture-summary.js'
$taskName = 'OddsOnDeck Close Capture'

if (-not (Test-Path -LiteralPath $wrapper)) {
  Write-Error 'scheduled-close-capture.ps1 is missing.'
  exit 1
}

$triggerLines = & node $helper triggers 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Could not build the trigger list.'
  exit 1
}

$triggers = @()
foreach ($line in @($triggerLines)) {
  $text = ([string]$line).Trim()
  if ($text -match '^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) (\d{2}):(\d{2})$') {
    $at = Get-Date -Hour ([int]$Matches[2]) -Minute ([int]$Matches[3]) -Second 0
    $triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Matches[1] -At $at
  }
}
if ($triggers.Count -lt 1) {
  Write-Error 'No triggers were created.'
  exit 1
}

$argument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$wrapper`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $repoRoot
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable:$false -RestartCount 0 -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$task = New-ScheduledTask -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'OddsOnDeck close capture. Interactive only. Disabled until enabled.'

Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
if ($Enable) {
  Enable-ScheduledTask -TaskName $taskName | Out-Null
  Write-Output "Registered '$taskName' and enabled it ($($triggers.Count) triggers)."
} else {
  Disable-ScheduledTask -TaskName $taskName | Out-Null
  Write-Output "Registered '$taskName' disabled ($($triggers.Count) triggers). Re-run with -Enable to turn it on."
}
