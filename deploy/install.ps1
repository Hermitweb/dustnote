# DustNote 一条命令安装部署入口（Windows）
#
# 职责：从 GitHub Release 拉取部署包 → 解压 → 调用 deploy.ps1 完成部署
#       （无需先 clone 仓库，一条命令从零到上线）
#
# 用法（推荐，一条命令）：
#   powershell -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing https://raw.githubusercontent.com/Hermitweb/dustnote/dev/setup-and-fixes/deploy/install.ps1 | iex"
#
# 或下载后执行：
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Cn] [-Port N] [-Domain D] [-Version vX.Y.Z] [-NoBuild]
#
# 参数：
#   -Cn          中国网络加速（apk/npm/docker 切国内镜像源）
#   -Port N      宿主机端口（默认 8080）
#   -Domain D    域名（设置后启用 Caddy 自动 HTTPS）
#   -Version TAG 指定版本（默认自动获取 GitHub 最新 Release，如 v2.5.21）
#   -NoBuild     跳过重新构建镜像（复用已构建镜像）
#   -Help        帮助

param(
    [switch]$Cn,
    [string]$Port = "8080",
    [string]$Domain = "",
    [string]$Version = "",
    [switch]$NoBuild,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$Repo = "Hermitweb/dustnote"
$PkgPrefix = "dustnote-server"

if ($Help) {
    Write-Host "用法：powershell -ExecutionPolicy Bypass -File install.ps1 [-Cn] [-Port N] [-Domain D] [-Version vX.Y.Z] [-NoBuild]"
    exit 0
}

function Info($m)  { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "[ OK ] $m" -ForegroundColor Green }
function Warn($m)  { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m)  { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

# ─── 1. 确定版本 ───
if (-not $Version) {
    Info "查询 GitHub 最新 Release…"
    try {
        $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'dustnote-install' }
        $Version = $latest.tag_name
    } catch {
        Fail "无法获取最新版本，请用 -Version vX.Y.Z 指定（错误：$($_.Exception.Message)）"
    }
}
if ($Version -notmatch '^v') { $Version = "v$Version" }
Info "目标版本：$Version"

# ─── 2. 下载部署包 ───
$Pkg = "$PkgPrefix-$Version.zip"
$Url = "https://github.com/$Repo/releases/download/$Version/$Pkg"
Info "下载部署包：$Pkg"
try {
    Invoke-WebRequest -Uri $Url -OutFile $Pkg -UseBasicParsing
} catch {
    Fail "下载失败：$Url（$($_.Exception.Message)）"
}

# ─── 3. 解压 ───
Info "解压部署包…"
Expand-Archive -Path $Pkg -DestinationPath . -Force
$SrcDir = "$PkgPrefix-$Version"
if (-not (Test-Path $SrcDir)) { Fail "解压目录不存在：$SrcDir" }

# ─── 4. 调用 deploy.ps1 完成部署 ───
Set-Location $SrcDir
$deployArgs = @()
if ($Cn) { $deployArgs += "-Cn" }
if ($Port) { $deployArgs += "-Port"; $deployArgs += $Port }
if ($Domain) { $deployArgs += "-Domain"; $deployArgs += $Domain }
if ($NoBuild) { $deployArgs += "-NoBuild" }

Ok "部署包已就绪：$(Get-Location)"
Info "开始部署：powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1"
& powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1 @deployArgs
if ($LASTEXITCODE -ne 0) { Fail "deploy.ps1 执行失败" }
