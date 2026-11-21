# Starts the Kyna Ops print agent automatically when this Windows user signs in,
# and restarts it if it stops. Run once, in PowerShell, from this folder:
#   powershell -ExecutionPolicy Bypass -File .\install-startup.ps1
# Remove it with:  Unregister-ScheduledTask -TaskName "Kyna Print Agent" -Confirm:$false

$ErrorActionPreference = "Stop"
$folder = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $folder ".env"))) {
  throw "Create .env first (copy .env.example and fill it in)."
}

# Runs as the signed-in user so it sees the same printers they do.
$action = New-ScheduledTaskAction -Execute $node -Argument "--env-file=.env agent.mjs" -WorkingDirectory $folder
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

Register-ScheduledTask -TaskName "Kyna Print Agent" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Prints Kyna Ops labels and keeps the app syncing." -Force | Out-Null

Start-ScheduledTask -TaskName "Kyna Print Agent"
Write-Host "Installed. The agent is running and will start every time you sign in."
