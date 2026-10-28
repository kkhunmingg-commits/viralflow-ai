# ViralFlow clip maker setup. The web page wraps this script in ViralFlow-Setup.cmd with the site address, this
# account's computer token and the worker files filled in; the person only double-clicks that file.
# Installs per Windows user without admin rights: private Node.js, the worker, a hidden start at every logon.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName System.Windows.Forms
$title = 'ViralFlow สร้างคลิป'
function Box([string]$text, [string]$icon = 'Information') { [void][Windows.Forms.MessageBox]::Show($text, $title, 'OK', $icon) }
function Say([string]$text) { Write-Host $text }

$portal = '__PORTAL__'
$token = '__TOKEN__'
$version = '__VERSION__'
$files = @{
__FILES__
}
$dir = Join-Path $env:LOCALAPPDATA 'ViralFlowClipMaker'
$app = Join-Path $dir 'app'
$log = Join-Path $dir 'worker.log'
# On the owner's own computer, keep using the repo worker's signed-in Google profiles instead of signing in again.
$repoWorkspace = 'D:\ViralFlowAI\workers\flow-browser\workspace'
$workspace = if (Test-Path -LiteralPath (Join-Path $repoWorkspace 'profiles')) { $repoWorkspace } else { Join-Path $dir 'workspace' }
$utf8 = New-Object Text.UTF8Encoding $false

# Stops this program's hidden launcher and worker, and the older repo-based worker, so only one runs.
function Stop-Worker {
  Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'wscript.exe' -and $_.CommandLine -like '*ViralFlowClipMaker*') -or
    ($_.Name -eq 'node.exe' -and ($_.CommandLine -like '*ViralFlowClipMaker*' -or $_.CommandLine -like '*flow-browser*farm.mjs*'))
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
  Say 'กำลังติดตั้งเครื่องสร้างคลิป ViralFlow ... (ใช้เวลา 2-5 นาที อย่าปิดหน้าต่างนี้)'
  $chrome = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) | Where-Object { $_ } |
    ForEach-Object { Join-Path $_ 'Google\Chrome\Application\chrome.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $chrome) {
    Start-Process 'https://www.google.com/chrome/'
    Box "ต้องมี Google Chrome ในเครื่องก่อน`nติดตั้ง Chrome จากหน้าที่เปิดให้ แล้วดับเบิลคลิกไฟล์ติดตั้งนี้อีกครั้ง" 'Warning'
    exit 1
  }

  # The earlier PowerShell-based autostart (repo copy) is replaced by this install.
  Get-ScheduledTask -TaskName 'ViralFlow Flow Farm' -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  Stop-Worker
  Start-Sleep -Seconds 1
  New-Item -ItemType Directory -Force -Path $dir, $app, $workspace | Out-Null

  # Private Node.js (checked against nodejs.org's published SHA-256), so nothing else on the computer matters.
  $node = Join-Path $dir 'node\node.exe'
  if (-not (Test-Path -LiteralPath $node)) {
    Say '1/3 ดาวน์โหลด Node.js ...'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $base = 'https://nodejs.org/dist/latest-v22.x/'
    $sums = [string](Invoke-WebRequest ($base + 'SHASUMS256.txt') -UseBasicParsing).Content
    $match = [regex]::Match($sums, '([0-9a-f]{64})\s+(node-v[0-9.]+-win-' + $arch + ')\.zip')
    if (-not $match.Success) { throw 'NODE_RELEASE_NOT_FOUND' }
    $zip = Join-Path $dir 'node.zip'
    Invoke-WebRequest ($base + $match.Groups[2].Value + '.zip') -OutFile $zip -UseBasicParsing
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $match.Groups[1].Value.ToUpper()) { throw 'NODE_DOWNLOAD_CORRUPT' }
    $unpack = Join-Path $dir 'node-unpack'
    Remove-Item -LiteralPath $unpack, (Join-Path $dir 'node') -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
    Move-Item -LiteralPath (Join-Path $unpack $match.Groups[2].Value) -Destination (Join-Path $dir 'node')
    Remove-Item -LiteralPath $unpack, $zip -Recurse -Force -ErrorAction SilentlyContinue
  }

  Say '2/3 ติดตั้งตัวสร้างคลิป ...'
  foreach ($name in $files.Keys) { [IO.File]::WriteAllBytes((Join-Path $app $name), [Convert]::FromBase64String($files[$name])) }
  [IO.File]::WriteAllText((Join-Path $app 'package.json'),
    '{"name":"viralflow-clip-maker","private":true,"type":"module","dependencies":{"playwright":"1.55.0","ffprobe-static":"3.1.0"}}', $utf8)
  [IO.File]::WriteAllText((Join-Path $app 'farm.env'), (@(
    "FLOW_PORTAL_URL=$portal", "FLOW_WORKER_TOKEN=$token", 'FLOW_WINDOW=offscreen', 'FLOW_CHROME_CHANNEL=chrome',
    'FLOW_MAX_CREDITS_PER_CLIP=10', 'FLOW_WATCH_SECONDS=60', "FLOW_WORKSPACE=$workspace", 'FLOW_INSTALLED=1'
  ) -join "`r`n"), $utf8)
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
  $env:npm_config_cache = Join-Path $dir 'npm-cache'
  $env:Path = (Join-Path $dir 'node') + ';' + $env:Path
  Push-Location -LiteralPath $app
  try { & (Join-Path $dir 'node\npm.cmd') install --omit=dev --no-audit --no-fund --loglevel=error | Out-Host }
  finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "NPM_INSTALL_FAILED ($LASTEXITCODE)" }

  Say '3/3 ตั้งให้เปิดเองแบบซ่อนทุกครั้งที่เปิดคอม ...'
  # wscript runs the worker with no window and starts it again a minute after it stops.
  $command = 'cmd /c ""' + $node + '" farm.mjs --watch > "' + $log + '" 2>&1"'
  $vbs = Join-Path $dir 'run-hidden.vbs'
  [IO.File]::WriteAllText($vbs, (@(
    'Set shell = CreateObject("WScript.Shell")',
    ('shell.CurrentDirectory = "' + $app + '"'),
    'Do',
    ('  shell.Run "' + $command.Replace('"', '""') + '", 0, True'),
    '  WScript.Sleep 60000',
    'Loop'
  ) -join "`r`n"), [Text.Encoding]::Unicode)
  $startup = 'wscript.exe "' + $vbs + '"'
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'ViralFlowClipMaker' -Value $startup

  $uninstallPs1 = Join-Path $dir 'uninstall.ps1'
  [IO.File]::WriteAllText($uninstallPs1, (@'
Add-Type -AssemblyName System.Windows.Forms
$dir = Join-Path $env:LOCALAPPDATA 'ViralFlowClipMaker'
$answer = [Windows.Forms.MessageBox]::Show("ถอนการติดตั้งเครื่องสร้างคลิป ViralFlow?`nบัญชี Google ที่ล็อกอินไว้ในเครื่องนี้จะถูกลบด้วย (คลิปในเว็บไม่หาย)", 'ViralFlow สร้างคลิป', 'YesNo', 'Question')
if ($answer -ne 'Yes') { exit }
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'ViralFlowClipMaker' -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ViralFlowClipMaker' -Recurse -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'wscript.exe', 'node.exe', 'chrome.exe' -and $_.CommandLine -like '*ViralFlowClipMaker*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Start-Process cmd.exe -ArgumentList ('/c timeout /t 2 /nobreak >nul & rmdir /s /q "' + $dir + '"') -WindowStyle Hidden
[void][Windows.Forms.MessageBox]::Show('ถอนการติดตั้งแล้ว', 'ViralFlow สร้างคลิป')
'@), (New-Object Text.UTF8Encoding $true))
  $entry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ViralFlowClipMaker'
  New-Item -Path $entry -Force | Out-Null
  Set-ItemProperty -Path $entry -Name DisplayName -Value $title
  Set-ItemProperty -Path $entry -Name DisplayVersion -Value $version
  Set-ItemProperty -Path $entry -Name Publisher -Value 'ViralFlow'
  Set-ItemProperty -Path $entry -Name InstallLocation -Value $dir
  Set-ItemProperty -Path $entry -Name UninstallString -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $uninstallPs1 + '"')
  Set-ItemProperty -Path $entry -Name NoModify -Value 1 -Type DWord
  Set-ItemProperty -Path $entry -Name NoRepair -Value 1 -Type DWord

  Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
  Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')

  # Wait for the worker's first check with the website: a summary line means the token works.
  Say 'กำลังเชื่อมกับเว็บ ...'
  $deadline = (Get-Date).AddSeconds(90); $text = ''
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-Path -LiteralPath $log) { $text = [IO.File]::ReadAllText($log, $utf8) }
    if ($text -match '"made"|ล็อกอิน|PORTAL_|INVALID_|SET_FLOW|FFPROBE|Error') { break }
  }
  if ($text -match 'PORTAL_ACCOUNTS_401') { throw 'TOKEN_REJECTED: ดาวน์โหลดไฟล์ติดตั้งใหม่จากหน้าเว็บ (ไฟล์เก่าใช้ไม่ได้เมื่อดาวน์โหลดไฟล์ใหม่)' }
  if ($text -notmatch '"made"|ล็อกอิน') { throw ("WORKER_DID_NOT_START`n" + (($text -split "`n" | Select-Object -Last 5) -join "`n")) }
  Box "ติดตั้งเสร็จแล้ว เครื่องสร้างคลิปทำงานเบื้องหลังและจะเปิดเองทุกครั้งที่เปิดคอม`n`nขั้นต่อไป: ในหน้าเว็บ (สร้างคลิปฟรี) กด “+ ผูกบัญชี Google”`nภายใน 1 นาที Chrome จะเปิดหน้าล็อกอิน Google ให้ ล็อกอินเสร็จแล้วปิดหน้าต่างนั้นได้เลย`n`nถอนการติดตั้ง: Settings > Apps > ViralFlow สร้างคลิป"
  exit 0
} catch {
  Box ("ติดตั้งไม่สำเร็จ`n`n" + $_.Exception.Message + "`n`nบันทึก: $log") 'Error'
  exit 1
}
