# HERMES Gateway Health Check
# 检测僵尸进程、内存泄漏、Gateway状态
# 用法: powershell -File hermes-health-check.ps1

$ok = 0; $warn = 0; $crit = 0

Write-Host "=== HERMES Health Check $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===" -ForegroundColor Cyan

# 1. 检查 Ollama
$ollama = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($ollama) { 
    Write-Host "  [OK] Ollama: PID=$($ollama.Id)" -ForegroundColor Green; $ok++ 
} else { 
    Write-Host "  [CRIT] Ollama not running!" -ForegroundColor Red; $crit++ 
}

# 2. 检查 Gateway
$pythonProcs = Get-Process -Name "python" -ErrorAction SilentlyContinue
$gateway = $pythonProcs | Where-Object { $_.WorkingSet64 -gt 10MB }
if ($gateway) {
    Write-Host "  [OK] Gateway: PID=$($gateway.Id) $([math]::Round($gateway.WorkingSet64/1MB,1))MB" -ForegroundColor Green; $ok++
} else {
    Write-Host "  [CRIT] Gateway not running!" -ForegroundColor Red; $crit++
}

# 3. 检测僵尸进程 (<5MB 的 hermes/python)
$zombies = Get-Process -Name "python","hermes" -ErrorAction SilentlyContinue | 
    Where-Object { $_.WorkingSet64 -lt 5MB } |
    Select-Object Id, ProcessName, @{N='MemKB';E={[math]::Round($_.WorkingSet64/1KB,0)}}

if ($zombies) {
    $count = @($zombies).Count
    Write-Host "  [WARN] $count zombie process(es) detected:" -ForegroundColor Yellow; $warn++
    $zombies | ForEach-Object { 
        Write-Host "    PID=$($_.Id) $($_.ProcessName) $($_.MemKB)KB" -ForegroundColor Yellow
        # 自动清理超过1小时的僵尸
        $age = (Get-Date) - $_.StartTime
        if ($age.TotalHours -gt 1) {
            Write-Host "      Auto-killing (age: $([math]::Round($age.TotalHours,1))h)" -ForegroundColor Red
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Host "  [OK] No zombies" -ForegroundColor Green; $ok++
}

# 4. 检查重复 Gateway
$gateways = $pythonProcs | Where-Object { $_.WorkingSet64 -gt 10MB }
if (@($gateways).Count -gt 1) {
    Write-Host "  [WARN] Multiple gateways: $(@($gateways).Count)" -ForegroundColor Yellow; $warn++
} else {
    Write-Host "  [OK] Single gateway" -ForegroundColor Green; $ok++
}

# 5. 总结
Write-Host ""
Write-Host "Summary: OK=$ok WARN=$warn CRIT=$crit" -ForegroundColor $(if($crit -gt 0){'Red'}elseif($warn -gt 0){'Yellow'}else{'Green'})

# 返回状态码
if ($crit -gt 0) { exit 2 }
if ($warn -gt 0) { exit 1 }
exit 0
