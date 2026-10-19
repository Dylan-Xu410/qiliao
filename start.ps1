$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:LOUNGE_DATA_DIR = Join-Path $PSScriptRoot 'data'
if (-not $env:PORT) { $env:PORT = '4318' }
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:LOCALAPPDATA 'hermes\node\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { Write-Host 'Please install Node.js 22.16 or newer: https://nodejs.org'; exit 1 }
$nodeVersion = & $nodePath -p "process.versions.node"
if ([version]$nodeVersion -lt [version]'22.16.0') {
    $bundledNode = Join-Path $env:LOCALAPPDATA 'hermes\node\node.exe'
    if (Test-Path -LiteralPath $bundledNode) { $nodePath = $bundledNode }
    $nodeVersion = & $nodePath -p "process.versions.node"
    if ([version]$nodeVersion -lt [version]'22.16.0') { Write-Host 'Please install Node.js 22.16 or newer: https://nodejs.org'; exit 1 }
}
$codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
if ($codexCommand) { $env:CODEX_BIN = $codexCommand.Source } else {
    $codexBinRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
    if (Test-Path -LiteralPath $codexBinRoot) {
        $codexCandidate = Get-ChildItem -LiteralPath $codexBinRoot -Filter codex.exe -File -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($codexCandidate) { $env:CODEX_BIN = $codexCandidate.FullName }
    }
}
Write-Host 'Agent Lounge - local chat observatory'
Write-Host 'Open http://127.0.0.1:4318 in your browser after the ready message.'
Write-Host 'Keep this terminal open. Press Ctrl+C to stop.'
& $nodePath (Join-Path $PSScriptRoot 'server.mjs')
