@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0ai.ps1" %*
