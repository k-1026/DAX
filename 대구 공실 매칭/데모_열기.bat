@echo off
cd /d "%~dp0"
rem 데모를 로컬 서버(127.0.0.1:8765)로 엽니다. 지도 서버가 file:// 접속을 막기 때문입니다.
rem 끝낼 때는 작업 표시줄의 '공실데모 서버' 창을 닫으세요.
where python >nul 2>nul || (echo Python이 없어 서버를 켤 수 없습니다. & pause & exit /b 1)
start "공실데모 서버" /min python -m http.server 8765 --bind 127.0.0.1
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8765/%%EA%%B3%%B5%%EC%%8B%%A4_%%EC%%8A%%A4%%EC%%BD%%94%%EC%%96%%B4%%EB%%A7%%81_%%EC%%A7%%80%%EB%%8F%%84_%%EB%%8D%%B0%%EB%%AA%%A8_26.11.11.html"
