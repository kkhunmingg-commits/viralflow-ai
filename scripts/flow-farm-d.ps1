# Semi-auto Flow farm on drive D. Default: watch the library queue and make clips in Google Flow in the background.
#   .\scripts\flow-farm-d.ps1                 # watch (leave running; the library page's button queues work)
#   .\scripts\flow-farm-d.ps1 -Login <id>     # sign one Flow account in, once (visible window)
#   .\scripts\flow-farm-d.ps1 -Probe [<id>]   # check sign-in, Generate button and credit cost; never generates
#   .\scripts\flow-farm-d.ps1 -DryRun         # prepare one clip in Flow and stop before Generate
#   .\scripts\flow-farm-d.ps1 -Once           # one pass, then exit
# Settings live in workers\flow-browser\farm.env (never committed): FLOW_PORTAL_URL, FLOW_WORKER_TOKEN, FLOW_WINDOW, ...
param([string]$Login, [switch]$Probe, [string]$ProbeId, [switch]$DryRun, [switch]$Once, [switch]$Visible)
. (Join-Path $PSScriptRoot 'enter-drive-d.ps1')
Set-Location -LiteralPath $projectRoot
if ($Visible) { $env:FLOW_WINDOW = 'visible' }
$farm = Join-Path $projectRoot 'workers\flow-browser\farm.mjs'
if ($Login) { & node $farm --login $Login }
elseif ($Probe) { if ($ProbeId) { & node $farm --probe $ProbeId } else { & node $farm --probe } }
elseif ($DryRun) { & node $farm --dry-run }
elseif ($Once) { & node $farm --once }
else { & node $farm --watch }
exit $LASTEXITCODE
