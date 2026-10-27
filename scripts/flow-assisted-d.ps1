param([string]$PortalUrl = 'https://viralflow-ai-blond.vercel.app')
. (Join-Path $PSScriptRoot 'enter-drive-d.ps1')
$portal = [uri]$PortalUrl
$loopbackHttp = $portal.Scheme -eq 'http' -and $portal.Host -in @('localhost','127.0.0.1')
if (($portal.Scheme -ne 'https' -and -not $loopbackHttp) -or $portal.UserInfo) {
  throw 'Use an HTTPS portal, or HTTP localhost for local testing.'
}
$chrome = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chrome)) { throw 'Install Google Chrome before starting assisted mode.' }
$manualProfile = Join-Path $runtimeRoot 'manual-chrome'
$defaultProfile = Join-Path $manualProfile 'Default'
$downloadDirectory = Join-Path $env:FLOW_WORKSPACE 'manual-downloads'
New-Item -ItemType Directory -Force -Path $defaultProfile,$downloadDirectory | Out-Null
$preferences = Join-Path $defaultProfile 'Preferences'
if (-not (Test-Path -LiteralPath $preferences)) {
  @{download=@{default_directory=$downloadDirectory;prompt_for_download=$true}} |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $preferences -Encoding utf8
}
# Ordinary Chrome, operated by the owner. No automation/debugging flags or session transfer.
Start-Process -FilePath $chrome -WindowStyle Normal -ArgumentList @(
  "--user-data-dir=`"$manualProfile`"",
  "--disk-cache-dir=`"$(Join-Path $runtimeRoot 'manual-chrome-cache')`"",
  '--new-window', 'https://labs.google/fx/tools/flow',
  ($portal.GetLeftPart([UriPartial]::Authority) + '/video-factory/providers')
)
Write-Host "Save MP4 and exported job JSON under $downloadDirectory (drive D)."
