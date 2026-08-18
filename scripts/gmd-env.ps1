$ErrorActionPreference = "Stop"

$script:ProjectRoot = Split-Path -Parent $PSScriptRoot

$script:BuildToolRoot = "C:\GMD-Account-Manager-Build"
$env:RUSTUP_HOME = Join-Path $script:BuildToolRoot "rustup"
$script:CargoToolBin = Join-Path $script:BuildToolRoot "cargo\bin"
$env:CARGO_HOME = Join-Path $script:ProjectRoot ".cache\cargo"
$env:CARGO_TARGET_DIR = Join-Path $script:ProjectRoot "target"
$env:GMD_VCVARS64_PATH = Join-Path $script:BuildToolRoot "vs-buildtools\VC\Auxiliary\Build\vcvars64.bat"
$env:npm_config_cache = Join-Path $script:ProjectRoot ".cache\npm"
$env:GOROOT = Join-Path $script:ProjectRoot ".tools\go"
$env:GOPATH = Join-Path $script:ProjectRoot ".cache\go-path"
$env:GOENV = Join-Path $script:ProjectRoot ".cache\go-env"
$env:GOCACHE = Join-Path $script:ProjectRoot ".cache\go-build"
$env:GOMODCACHE = Join-Path $script:ProjectRoot ".cache\go-mod"
$env:TEMP = Join-Path $script:ProjectRoot ".temp"
$env:TMP = $env:TEMP
$env:GMD_SKIP_CLIPROXY_BUILD = "1"

$managedDirectories = @(
    $env:CARGO_HOME,
    $env:CARGO_TARGET_DIR,
    $env:npm_config_cache,
    $env:GOPATH,
    $env:GOCACHE,
    $env:GOMODCACHE,
    $env:TEMP,
    (Join-Path $script:ProjectRoot ".artifacts"),
    (Join-Path $script:ProjectRoot ".qa")
)

foreach ($directory in $managedDirectories) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$goBin = Join-Path $env:GOROOT "bin"
foreach ($binPath in @($script:CargoToolBin, $goBin)) {
    if (-not (($env:PATH -split [IO.Path]::PathSeparator) -contains $binPath)) {
        $env:PATH = "$binPath$([IO.Path]::PathSeparator)$env:PATH"
    }
}

Write-Host "GMD build environment loaded from $script:ProjectRoot"
Write-Host "Existing Rust/MSVC tools are read from C:. Cargo downloads, npm cache, build output and temporary files are routed to E:."
