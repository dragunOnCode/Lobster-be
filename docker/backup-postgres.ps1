# PostgreSQL 备份脚本
# 用法: .\backup-postgres.ps1
# 在 Windows 重启前手动运行，或设置计划任务定期执行

$timestamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$backupDir = "$PSScriptRoot\backups"
$backupFile = "$backupDir\postgres_$timestamp.sql"

if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

Write-Host "正在备份 PostgreSQL 数据..." -ForegroundColor Cyan
docker exec lobster-postgres pg_dumpall -U admin -f /tmp/backup_export.sql

if ($LASTEXITCODE -eq 0) {
    docker cp "lobster-postgres:/tmp/backup_export.sql" $backupFile
    docker exec lobster-postgres rm /tmp/backup_export.sql
    $size = [math]::Round((Get-Item $backupFile).Length / 1KB, 1)
    Write-Host "备份成功: $backupFile ($size KB)" -ForegroundColor Green

    # 只保留最近 7 份备份
    Get-ChildItem "$backupDir\postgres_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 7 | Remove-Item -Force
    Write-Host "已清理旧备份，当前保留 $(( Get-ChildItem "$backupDir\postgres_*.sql" ).Count) 份" -ForegroundColor Yellow
} else {
    Write-Host "备份失败！请确认 lobster-postgres 容器正在运行。" -ForegroundColor Red
}
