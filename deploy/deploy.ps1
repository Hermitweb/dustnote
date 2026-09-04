# DustNote 一键部署脚本（Windows）
#
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Cn
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Domain notes.example.com
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Port 9000 -Cn
#
# 参数：
#   -Cn          中国网络加速（apk/npm/docker 均切国内镜像源）
#   -Port N      宿主机端口（默认 8080）
#   -Domain D    域名（设置后启用 Caddy 自动 HTTPS）
#   -Origin URL  覆盖 WEB_ORIGIN/CORS 白名单（默认 http://<本机IP>:<端口>）
#   -NoBuild     跳过重新构建镜像（复用已构建镜像）
#   -Help        帮助

param(
    [switch]$Cn,
    [string]$Port = "8080",
    [string]$Domain = "",
    [string]$Origin = "",
    [switch]$NoBuild,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
    Get-Content $PSCommandPath | Select-Object -Skip 1 -First 18
    exit 0
}

# ─── 定位仓库根目录 ───
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RootDir

function Info($m)  { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "[ OK ] $m" -ForegroundColor Green }
function Warn($m)  { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m)  { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

# ─── 检测 Docker ───
$dockerOk = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    try {
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
    } catch {}
}

if (-not $dockerOk) {
    Fail "未检测到运行中的 Docker。请先安装并启动 Docker Desktop（https://www.docker.com/products/docker-desktop/），完成后重新运行本脚本。"
}
Ok "Docker：$(docker --version)"

# ─── 检测 Docker Compose v2 ───
$compose = $null
docker compose version *> $null
if ($LASTEXITCODE -eq 0) {
    $compose = "docker compose"
} elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    $compose = "docker-compose"
} else {
    Fail "未检测到 Docker Compose v2，请更新 Docker Desktop 后重试。"
}
Ok "Compose：docker compose v2"

# ─── 中国网络：提示配置 Docker 镜像加速 ───
if ($Cn) {
    $daemonJson = "$env:USERPROFILE\.docker\daemon.json"
    Warn "已启用 -Cn。建议在 Docker Desktop 设置 → Docker Engine 中配置镜像加速："
    Warn '  { "registry-mirrors": ["https://docker.1panel.live"] }'
    Warn "（自动写入 daemon.json 需要重启 Docker Desktop，本脚本不强制改动）"
}

# ─── 生成 .env ───
if (Test-Path ".env") {
    Info "检测到已存在 .env，跳过生成（如需重置请删除后重跑）"
} else {
    Info "生成 .env 配置…"
    $Version = "2.5.33"
    if (Test-Path "package.json") {
        try {
            $pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
            if ($pkg.version) { $Version = $pkg.version }
        } catch {}
    }

    # 安全随机 JWT_SECRET（32 字节 hex = 64 字符）
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $JwtSecret = -join ($bytes | ForEach-Object { $_.ToString("x2") })

    $WebOrigin = $Origin
    if (-not $WebOrigin) {
        # 默认按本机 IPv4 推导（与 deploy.sh 行为一致），失败回退 localhost
        $ip = "localhost"
        try {
            $nic = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
                Select-Object -First 1
            if ($nic) { $ip = $nic.IPAddress }
        } catch {}
        $WebOrigin = "http://${ip}:$Port"
    }
    if ($Domain) { $WebOrigin = "https://$Domain" }

    $envLines = @(
        "# DustNote 环境变量（由 deploy.ps1 自动生成 $(Get-Date -Format yyyy-MM-dd)）",
        "PORT=$Port",
        "WEB_ORIGIN=$WebOrigin",
        "SERVER_VERSION=$Version",
        "MIN_CLIENT_VERSION=2.0.2",
        "RECOMMENDED_CLIENT_VERSION=$Version",
        "FORCE_UPDATE_VERSION=",
        "EOL_DATE_FOR_V0=",
        "JWT_SECRET=$JwtSecret",
        "TRUST_PROXY=1",
        "LOG_LEVEL=info"
    )
    if ($Domain) { $envLines += "DOMAIN=$Domain" }
    $envLines | Set-Content -Path ".env" -Encoding utf8
    Ok ".env 已生成（JWT_SECRET 已随机化，请妥善保存）"
}

# ─── 构建参数（中国网络） ───
if ($Cn) {
    $env:APK_MIRROR = "mirrors.aliyun.com"
    $env:NPM_REGISTRY = "https://registry.npmmirror.com"
    Info "已启用中国镜像源：apk=mirrors.aliyun.com / npm=npmmirror"
}

# ─── 启动 ───
Info "启动容器…"
$buildArg = @()
if (-not $NoBuild) { $buildArg = @("--build") }

$buildLog = Join-Path $env:TEMP "dustnote-compose-build.log"
if ($Domain) {
    Ok "启用 HTTPS 模式（Caddy 自动证书，域名：$Domain）"
    & docker compose --profile tls up -d @buildArg *> $buildLog
} else {
    & docker compose up -d @buildArg *> $buildLog
}
if ($LASTEXITCODE -ne 0) {
    Get-Content $buildLog -Tail 40 | ForEach-Object { Write-Host $_ }
    Fail "docker compose up 执行失败，完整构建日志：$buildLog"
}

# ─── 等待健康检查 ───
Info "等待服务健康检查通过（最长 120s）…"
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
    $status = (& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{end}}" dustnote 2>$null) -join ""
    if ($status -eq "healthy") { $healthy = $true; break }
    if ($status -eq "unhealthy") { break }
    Start-Sleep -Seconds 3
}

if ($healthy) { Ok "服务已就绪" } else { Warn "健康检查未通过，查看日志：docker compose logs dustnote" }

# ─── 输出访问地址 ───
if ($Domain) {
    Info "访问地址：https://$Domain"
} else {
    Info "访问地址：http://localhost:$Port（本机）或 http://<服务器IP>:$Port（按实际网络访问）"
}
Info "提示：Docker 发布的端口不受 Windows 防火墙入站规则语义之外的额外限制约束，公网暴露请确认云安全组"
Ok "部署完成。常用命令：docker compose logs -f dustnote / docker compose down"
