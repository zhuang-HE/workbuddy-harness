# HERMES Gateway Clean Start Guard
# 防止僵尸进程：启动前检查并清理旧实例
# 用法: powershell -File clean-start.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== HERMES Gateway Clean Start ===" -ForegroundColor Cyan

# 1. 检查是否已有运行中的 gateway
$running = Get-Process -Name "python","hermes" -ErrorAction SilentlyContinue | 
    Where-Object { $_.WorkingSet64 -gt 10MB }

if ($running) {
    $running | ForEach-Object { 
        Write-Host "Found running gateway: PID=$($_.Id) Mem=$([math]::Round($_.WorkingSet64/1MB,1))MB" -ForegroundColor Yellow 
    }
    Write-Host "Gateway already running. Aborting to prevent duplicate." -ForegroundColor Green
    exit 0
}

# 2. 杀掉所有僵尸/孤儿 hermes/python 进程 (<5MB = 僵尸)
$zombies = Get-Process -Name "python","hermes" -ErrorAction SilentlyContinue | 
    Where-Object { $_.WorkingSet64 -lt 5MB }

if ($zombies) {
    Write-Host "Cleaning $(@($zombies).Count) zombie process(es)..." -ForegroundColor Magenta
    $zombies | ForEach-Object {
        Write-Host "  Killing PID=$($_.Id) $($_.ProcessName) ($([math]::Round($_.WorkingSet64/1KB,0))KB)" -ForegroundColor Red
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    Write-Host "Zombies cleaned." -ForegroundColor Green
}

# 3. 检查 Ollama 是否运行
$ollama = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if (-not $ollama) {
    Write-Host "WARNING: Ollama not running!" -ForegroundColor Yellow
}

# 4. 启动 Gateway
$hermesDir = "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts"
$logFile = "$env:USERPROFILE\.hermes\logs\gateway.log"

Write-Host "Starting HERMES Gateway..." -ForegroundColor Cyan

$proc = Start-Process -FilePath "python" `
    -ArgumentList "hermes.exe","gateway","run" `
    -WorkingDirectory $hermesDir `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Gateway started: PID=$($proc.Id)" -ForegroundColor Green
Write-Host "Log: $logFile" -ForegroundColor Gray

# 5. 等待并验证
Start-Sleep -Seconds 5
$verify = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($verify -and $verify.WorkingSet64 -gt 5MB) {
    Write-Host "Gateway verified running: $([math]::Round($verify.WorkingSet64/1MB,1))MB" -ForegroundColor Green
} else {
    Write-Host "WARNING: Gateway may not have started properly" -ForegroundColor Red
    Write-Host "Check: $logFile" -ForegroundColor Yellow
}
