# Dot-source this script in every development process before invoking tools.
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $projectRoot.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'ViralFlow development requires a workspace on drive D.'
}
$runtimeRoot = Join-Path $projectRoot '.runtime'
$env:TEMP = Join-Path $runtimeRoot 'tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:npm_config_cache = Join-Path $runtimeRoot 'npm-cache'
$env:npm_config_store_dir = Join-Path $runtimeRoot 'pnpm-store'
$env:npm_config_cache_dir = Join-Path $runtimeRoot 'pnpm-cache'
$env:npm_config_state_dir = Join-Path $runtimeRoot 'pnpm-state'
$env:pnpm_config_cache_dir = Join-Path $runtimeRoot 'pnpm-cache'
$env:pnpm_config_state_dir = Join-Path $runtimeRoot 'pnpm-state'
$env:pnpm_config_store_dir = Join-Path $runtimeRoot 'pnpm-store'
$env:npm_config_devdir = Join-Path $runtimeRoot 'node-gyp'
$env:npm_config_prefix = Join-Path $runtimeRoot 'npm-global'
$env:PNPM_HOME = Join-Path $runtimeRoot 'pnpm'
$env:COREPACK_HOME = Join-Path $runtimeRoot 'corepack'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $runtimeRoot 'playwright'
$env:PIP_CACHE_DIR = Join-Path $runtimeRoot 'pip-cache'
$env:UV_CACHE_DIR = Join-Path $runtimeRoot 'uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $runtimeRoot 'python'
$env:UV_TOOL_DIR = Join-Path $runtimeRoot 'uv-tools'
$env:UV_TOOL_BIN_DIR = Join-Path $runtimeRoot 'uv-bin'
$env:PYTHONUSERBASE = Join-Path $runtimeRoot 'python-user'
$env:HF_HOME = Join-Path $runtimeRoot 'huggingface'
$env:TORCH_HOME = Join-Path $runtimeRoot 'torch'
$env:XDG_CACHE_HOME = Join-Path $runtimeRoot 'cache'
$env:XDG_STATE_HOME = Join-Path $runtimeRoot 'state'
$env:XDG_DATA_HOME = Join-Path $runtimeRoot 'data'
$env:PYTHONPYCACHEPREFIX = Join-Path $runtimeRoot 'pycache'
$env:FLOW_WORKSPACE = Join-Path $projectRoot 'workers\flow-browser\workspace'
$env:FLOW_SELECTORS = Join-Path $projectRoot 'workers\flow-browser\selectors.json'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:DO_NOT_TRACK = '1'
$env:GIT_TERMINAL_PROMPT = '0'
# Process-only: never write a global Git config to the user's C: profile.
$gitConfigIndex = 0
if ($env:GIT_CONFIG_COUNT) { $gitConfigIndex = [int]$env:GIT_CONFIG_COUNT }
[Environment]::SetEnvironmentVariable("GIT_CONFIG_KEY_$gitConfigIndex", 'safe.directory', 'Process')
[Environment]::SetEnvironmentVariable("GIT_CONFIG_VALUE_$gitConfigIndex", $projectRoot.Replace('\','/'), 'Process')
$env:GIT_CONFIG_COUNT = [string]($gitConfigIndex + 1)
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
