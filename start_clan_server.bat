@echo off
title R.E.B.O.R.N. Clan Server
echo ========================================================================
echo    [+] R.E.B.O.R.N. // CLAN ACCESS LAUNCHER [+]
echo    Custom Web Domain: https://feliciadatabase.loca.lt
echo    Backup Cloudflare: https://brook-noble-firewall-montgomery.trycloudflare.com
echo ========================================================================

start "REBORN Server" python "%~dp0run.py"
timeout /t 3 /nobreak >nul
start "REBORN Cloudflare Tunnel" "%~dp0bin\cloudflared.exe" tunnel --url http://127.0.0.1:8000
start "REBORN Public Domain" cmd /c "title Localtunnel && :loop && npx -y localtunnel --port 8000 --subdomain feliciadatabase && timeout /t 3 >nul && goto loop"

echo.
echo Both Local Server and Public Tunnels are active!
echo Share with your Clan: https://feliciadatabase.loca.lt
pause
