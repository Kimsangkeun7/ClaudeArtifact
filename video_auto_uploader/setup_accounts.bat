@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 계정 설정 화면을 엽니다 ===
start "" http://127.0.0.1:5000
python webui\app.py
pause
