param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appDirectory = $PSScriptRoot
$appUrl = 'http://127.0.0.1:4318/'

function Test-LoungeReady {
    try {
        $page = Invoke-WebRequest -UseBasicParsing -Uri $appUrl -TimeoutSec 2
        return ($page.StatusCode -eq 200 -and $page.Content -match 'Agent Lounge')
    } catch { return $false }
}

try {
    if (-not (Test-LoungeReady)) {
        $env:PORT = '4318'
        $startScript = Join-Path $appDirectory 'start.ps1'
        $shellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        Start-Process -FilePath $shellPath -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $startScript)) -WorkingDirectory $appDirectory -WindowStyle Hidden
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if (Test-LoungeReady) { $ready = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw 'The local service did not start. Please run start.cmd in the app folder to see the error.' }
    }
    if (-not $NoBrowser) { Start-Process $appUrl }
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Agent Lounge', 'OK', 'Error') | Out-Null
    exit 1
}
