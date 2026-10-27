param(
  [Parameter(Mandatory=$true, Position=0)]
  [ValidateSet('node','pnpm','npm','git')]
  [string]$Tool,
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$ToolArguments
)
. (Join-Path $PSScriptRoot 'enter-drive-d.ps1')
Set-Location -LiteralPath $projectRoot
$toolExecutable = switch ($Tool) {
  'npm' { 'npm.cmd' }
  'pnpm' { 'pnpm.cmd' }
  default { $Tool }
}
& $toolExecutable @ToolArguments
exit $LASTEXITCODE
