@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 영상 멀티플랫폼 자동 업로더 ===
python main.py
pause
