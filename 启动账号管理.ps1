$ErrorActionPreference = "Stop"

$exe = Join-Path $PSScriptRoot ".runtime\cockpit-tools.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "GMD 账号管理 executable not found: $exe"
}

Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
