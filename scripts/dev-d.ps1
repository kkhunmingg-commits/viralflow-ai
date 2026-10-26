param(
  [Parameter(Mandatory=$true, Position=0)]
  [ValidateSet('node','pnpm','npm','git')]
  [string]$Tool,
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$ToolArguments
)
. (Join-Path $PSScriptRoot 'enter-drive-d.ps1')
Set-Location -LiteralPath $projectRoot
if ($Tool -eq 'npm') { $Tool = 'npm.cmd' }
if ($Tool -eq 'pnpm') { $Tool = 'pnpm.cmd' }
& $Tool @ToolArguments
exit $LASTEXITCODE
