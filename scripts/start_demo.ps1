# Flowcast: запуск демо одной командой.
#   1) venv C:\venvs\daromad  2) seed --reset  3) бэкенд uvicorn :8000 (+ бот)  4) туннель cloudflared
#   5) печатает выданный https-адрес как VITE_API_URL и что делать дальше. Ctrl+C — остановить всё.
# Запуск из корня репозитория:  powershell -ExecutionPolicy Bypass -File scripts\start_demo.ps1
param(
    [string]$Venv = "C:\venvs\daromad",
    [int]$Port = 8000,
    [switch]$NoTunnel
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$py = Join-Path $Venv "Scripts\python.exe"
$logDir = Join-Path $env:TEMP "flowcast-demo"
# 127.0.0.1, не localhost: в Windows PowerShell localhost сначала идёт в IPv6 (::1), а uvicorn слушает IPv4
$health = "http://127.0.0.1:$Port/"
New-Item -ItemType Directory -Force $logDir | Out-Null

function Write-Step($text) { Write-Host "`n>> $text" -ForegroundColor Cyan }

if (-not (Test-Path $py)) { throw "venv topilmadi: $py  (README -> Ustanovka)" }
if (-not (Test-Path (Join-Path $backend ".env"))) { Write-Warning "backend\.env yo'q - bot va AI ishlamaydi (namuna: backend\.env.example)" }

# 1. venv (активация не обязательна — дальше python вызывается по полному пути; ошибка политики не критична)
Write-Step "venv: $Venv"
try { & (Join-Path $Venv "Scripts\Activate.ps1") } catch { Write-Host "   (Activate.ps1 o'tkazib yuborildi: $($_.Exception.Message))" -ForegroundColor DarkGray }
$env:PYTHONIOENCODING = "utf-8"

# порт занят — второй экземпляр бота и API не запускаем
try {
    Invoke-RestMethod -Uri $health -TimeoutSec 2 | Out-Null
    throw "Port $Port band: backend allaqachon ishlayapti. Uni to'xtating va qayta ishga tushiring."
} catch [System.Net.WebException] { } catch { if ($_.Exception.Message -like "Port*") { throw } }

# 2. демо-данные
Write-Step "Demo ma'lumotlar: seed.py --reset"
Push-Location $backend
try { & $py seed.py --reset | Select-Object -Last 3 } finally { Pop-Location }

# 3. бэкенд
Write-Step "Backend: uvicorn :$Port (loglar: $logDir)"
$api = Start-Process -FilePath $py -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "$Port" `
    -WorkingDirectory $backend -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $logDir "api.out.log") -RedirectStandardError (Join-Path $logDir "api.err.log")
$tunnel = $null
try {
    $ok = $false
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if ($api.HasExited) { break }
        try { Invoke-RestMethod -Uri $health -TimeoutSec 3 | Out-Null; $ok = $true; break } catch { Start-Sleep -Milliseconds 700 }
    }
    if (-not $ok) {
        Get-Content (Join-Path $logDir "api.err.log") -Tail 20 -ErrorAction SilentlyContinue
        throw "Backend ishga tushmadi (loglar yuqorida)."
    }
    Write-Host "   OK: http://localhost:$Port/" -ForegroundColor Green

    $url = $null
    if (-not $NoTunnel) {
        # 4. туннель
        $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
        if (-not $cf) {
            foreach ($p in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) {
                if (Test-Path $p) { $cf = $p; break }
            }
        }
        if (-not $cf) {
            Write-Warning "cloudflared topilmadi. O'rnatish: winget install Cloudflare.cloudflared  (backend lokal ishlayapti)"
        } else {
            Write-Step "Tunnel: cloudflared tunnel --url http://localhost:$Port"
            $cfLog = Join-Path $logDir "cloudflared.log"
            Remove-Item $cfLog, "$cfLog.out" -ErrorAction SilentlyContinue
            $tunnel = Start-Process -FilePath $cf -ArgumentList "tunnel", "--url", "http://localhost:$Port" -PassThru -NoNewWindow `
                -RedirectStandardError $cfLog -RedirectStandardOutput "$cfLog.out"
            # cloudflared пишет адрес в stderr: «https://<random>.trycloudflare.com»
            for ($i = 0; $i -lt 60 -and -not $url; $i++) {
                Start-Sleep -Seconds 1
                if ($tunnel.HasExited) { break }
                $m = Select-String -Path $cfLog, "$cfLog.out" -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($m) { $url = $m.Matches[0].Value }
            }
            if (-not $url) { Write-Warning "Tunnel manzili 60 s ichida chiqmadi. Log: $cfLog" }
        }
    }

    # 5. итог
    $line = "=" * 64
    Write-Host "`n$line" -ForegroundColor Green
    if ($url) {
        Write-Host "  VITE_API_URL=$url" -ForegroundColor Yellow
        Write-Host $line -ForegroundColor Green
        Write-Host @"
  Keyingi qadamlar:
   1. Vercel -> Project -> Settings -> Environment Variables:
        VITE_API_URL = $url
      -> Deployments -> Redeploy (Vite manzilni build paytida yozadi).
   2. Tekshirish: $url/  ->  {"ok": true, ...}
   3. backend\.env: WEBAPP_URL=https://<vercel-loyiha>.vercel.app/tg  (o'zgarsa - shu skriptni qayta ishga tushiring)
   4. Telegram -> bot -> «Hisobim» tugmasi. Lokal: http://localhost:5173/app
  Tunnel manzili har ishga tushirishda o'zgaradi. To'xtatish: Ctrl+C
"@
    } else {
        Write-Host "  Backend: http://localhost:$Port  (tunnelsiz)" -ForegroundColor Yellow
        Write-Host $line -ForegroundColor Green
        Write-Host "  Lokal demo: npm --prefix miniapp run dev  ->  http://localhost:5173/app   To'xtatish: Ctrl+C"
    }

    Wait-Process -Id $api.Id
} finally {
    Write-Host "`nTo'xtatilmoqda..." -ForegroundColor DarkGray
    foreach ($p in @($tunnel, $api)) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
