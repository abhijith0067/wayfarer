@echo off
rem Serves Wayfarer on http://localhost:8793 and opens it. Location access needs localhost or HTTPS.
cd /d "%~dp0"
start "" http://localhost:8793/
python -m http.server 8793 --bind 127.0.0.1
