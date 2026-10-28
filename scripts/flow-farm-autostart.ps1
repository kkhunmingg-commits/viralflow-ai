# Starts the Flow farm worker hidden every time this Windows user logs on, and starts it now.
# Run once:  .\scripts\flow-farm-autostart.ps1        Remove:  .\scripts\flow-farm-autostart.ps1 -Remove
param([switch]$Remove)
$name = 'ViralFlow Flow Farm'
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue; return }
$script = Join-Path $PSScriptRoot 'flow-farm-d.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Output "ตั้งให้โปรแกรมสร้างคลิปเปิดเองแบบซ่อนทุกครั้งที่เข้าเครื่องแล้ว"
