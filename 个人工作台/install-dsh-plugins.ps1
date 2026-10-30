# 家里电脑：一次装齐 DSH 插件
# 用法： pwsh -ExecutionPolicy Bypass -File .\install-dsh-plugins.ps1
#       如果 dsh 不在 PATH： pwsh -ExecutionPolicy Bypass -File .\install-dsh-plugins.ps1 -DshExe "D:\deepseekHARNESS\resources\app.asar.unpacked\dsh\bin\dsh.js"

param(
    [string]$DshExe = "",
    [string]$Profile = "desktop"
)

$ErrorActionPreference = 'Stop'

$plugins = @(
    @{ Name = 'dshmarket';                              Version = '1.70.2' },
    @{ Name = '@vectorize-io/hindsight-coding-agents';  Version = '0.8.2' },
    @{ Name = 'billion-context';                        Version = '0.1.209' },
    @{ Name = 'dsh-connect-workbuddy';                  Version = '5.12.1' },
    @{ Name = 'dsh-context';                            Version = '0.77.0' },
    @{ Name = 'dsh-free-search';                        Version = '0.9.17' },
    @{ Name = 'dsh-ops';                                Version = '0.4.1' }
)

# 解析 dsh 命令
$dsh = $null
if ($DshExe) {
    $dsh = @($DshExe)
} else {
    $cmd = Get-Command dsh -ErrorAction SilentlyContinue
    if ($cmd) {
        $dsh = @($cmd.Source)
    } else {
        Write-Host "✗ 没找到 dsh 命令。" -ForegroundColor Red
        Write-Host "  请先确认 DSH 安装目录，再这样跑：" -ForegroundColor Yellow
        Write-Host '  pwsh -ExecutionPolicy Bypass -File .\install-dsh-plugins.ps1 -DshExe "<DSH安装目录>\bin\dsh.js"' -ForegroundColor Yellow
        exit 1
    }
}

$nodeModules = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile\node_modules"

foreach ($p in $plugins) {
    $installed = Join-Path $nodeModules $p.Name
    if (Test-Path $installed) {
        Write-Host "✓ 已装 $($p.Name) $($p.Version)，跳过" -ForegroundColor DarkGray
        continue
    }
    $spec = "$($p.Name)@$($p.Version)"
    Write-Host "→ 安装 $spec" -ForegroundColor Cyan
    & $dsh[0] @($dsh[1..($dsh.Count - 1)]) plugin --profile $Profile add $spec
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ $($p.Name) 安装失败（退出码 $LASTEXITCODE），继续下一个" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "全部处理完毕。请完全退出并重启 DSH，然后在插件页确认 7 个插件都在。" -ForegroundColor Green
Write-Host "别忘了：WorkBuddy 要重新登录，Hindsight 要选记忆库（见同目录 插件清单.md）。" -ForegroundColor Yellow
