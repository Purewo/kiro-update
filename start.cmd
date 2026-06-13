@echo off
setlocal
cd /d "%~dp0server"
if "%PROXY_PORT%"=="" set PROXY_PORT=29080
if "%ADMIN_PORT%"=="" set ADMIN_PORT=29081
if "%PROXY_HOST%"=="" set PROXY_HOST=127.0.0.1
if "%ADMIN_HOST%"=="" set ADMIN_HOST=127.0.0.1
if "%ADMIN_PASSWORD%"=="" set ADMIN_PASSWORD=changeme
if "%KIRO_DATA_DIR%"=="" set KIRO_DATA_DIR=%~dp0.local-data
rem Default outbound proxy for AWS Kiro backend (matches user's local proxy on 17893).
rem Override by setting HTTPS_PROXY/HTTP_PROXY before invoking, or unset these to bypass.
if "%HTTPS_PROXY%"=="" set HTTPS_PROXY=http://127.0.0.1:17893
if "%HTTP_PROXY%"=="" set HTTP_PROXY=http://127.0.0.1:17893
echo ===============================
echo  Kiro Web
echo   Admin UI:      http://%ADMIN_HOST%:%ADMIN_PORT%
echo   Reverse Proxy: http://%PROXY_HOST%:%PROXY_PORT%
echo   Data dir:      %KIRO_DATA_DIR%
echo   Admin pass:    %ADMIN_PASSWORD%
echo ===============================
call npm run start
