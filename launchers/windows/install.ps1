$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Install Node 24 LTS for your Windows CPU first, then retry.'
}
& node (Join-Path $PSScriptRoot '..\install.mjs') @args
exit $LASTEXITCODE
