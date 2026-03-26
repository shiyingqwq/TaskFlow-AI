@echo off
setlocal

cd /d "%~dp0"
title TaskFlow-AI APK Builder

REM ===== You can edit these defaults =====
set "JAVA_HOME_DEFAULT=D:\and\jbr"
set "ANDROID_SDK_DEFAULT=D:\ad\sdk"
set "APP_URL_DEFAULT=http://8.137.154.66:3001/"
set "USE_PROXY=0"
set "PROXY_HOST=127.0.0.1"
set "PROXY_PORT=7890"
REM =======================================

if "%JAVA_HOME%"=="" set "JAVA_HOME=%JAVA_HOME_DEFAULT%"
if "%ANDROID_HOME%"=="" set "ANDROID_HOME=%ANDROID_SDK_DEFAULT%"
if "%ANDROID_SDK_ROOT%"=="" set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
if "%CAP_SERVER_URL%"=="" set "CAP_SERVER_URL=%APP_URL_DEFAULT%"

set "PATH=%JAVA_HOME%\bin;%PATH%"

echo [1/6] Environment
echo JAVA_HOME=%JAVA_HOME%
echo ANDROID_HOME=%ANDROID_HOME%
echo CAP_SERVER_URL=%CAP_SERVER_URL%

if not exist "%JAVA_HOME%\bin\java.exe" (
  echo.
  echo Invalid JAVA_HOME: %JAVA_HOME%
  echo Please set JDK/JBR 21 path and retry.
  pause
  exit /b 1
)

if not exist "%ANDROID_HOME%" (
  echo.
  echo Invalid ANDROID_HOME: %ANDROID_HOME%
  echo Please install Android SDK and retry.
  pause
  exit /b 1
)

echo [2/6] Java version
java -version
if errorlevel 1 (
  echo.
  echo java -version failed.
  pause
  exit /b 1
)

echo [3/6] Writing android\local.properties
> "%~dp0android\local.properties" echo sdk.dir=%ANDROID_HOME:\=\\%

if "%USE_PROXY%"=="1" (
  echo [4/6] Enable proxy %PROXY_HOST%:%PROXY_PORT%
  set "HTTP_PROXY=http://%PROXY_HOST%:%PROXY_PORT%"
  set "HTTPS_PROXY=http://%PROXY_HOST%:%PROXY_PORT%"
  set "http_proxy=http://%PROXY_HOST%:%PROXY_PORT%"
  set "https_proxy=http://%PROXY_HOST%:%PROXY_PORT%"
  set "GRADLE_OPTS=-Dhttp.proxyHost=%PROXY_HOST% -Dhttp.proxyPort=%PROXY_PORT% -Dhttps.proxyHost=%PROXY_HOST% -Dhttps.proxyPort=%PROXY_PORT%"
) else (
  echo [4/6] Proxy disabled
)

echo [5/6] Sync Capacitor assets
call npm run mobile:sync
if errorlevel 1 (
  echo.
  echo npm run mobile:sync failed.
  pause
  exit /b 1
)

echo [6/6] Build debug APK
pushd android
call gradlew.bat --no-daemon assembleDebug
if errorlevel 1 (
  popd
  echo.
  echo APK build failed.
  pause
  exit /b 1
)
popd

echo.
echo Build complete.
echo APK: android\app\build\outputs\apk\debug\app-debug.apk
pause

endlocal
