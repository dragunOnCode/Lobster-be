# PostgreSQL 恢复脚本（在密码或数据丢失后使用）
# 用法: .\restore-postgres.ps1 .\backups\postgres_2026-03-09_0100.sql

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile
)

if (-not (Test-Path $BackupFile)) {
    Write-Host "备份文件不存在: $BackupFile" -ForegroundColor Red
    exit 1
}

Write-Host "正在恢复 PostgreSQL 数据从: $BackupFile" -ForegroundColor Cyan
Write-Host "警告：这将覆盖现有数据！" -ForegroundColor Yellow
$confirm = Read-Host "确认继续? (y/N)"
if ($confirm -ne 'y') { exit 0 }

docker cp $BackupFile "lobster-postgres:/tmp/restore.sql"
docker exec lobster-postgres psql -U admin -d postgres -f /tmp/restore.sql
docker exec lobster-postgres rm /tmp/restore.sql

if ($LASTEXITCODE -eq 0) {
    Write-Host "恢复成功！" -ForegroundColor Green
} else {
    Write-Host "恢复过程中有错误，请检查输出。" -ForegroundColor Yellow
}
