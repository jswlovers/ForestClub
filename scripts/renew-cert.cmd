@echo off
rem Windows 작업 스케줄러(PorkbunCertRenew)가 매일 실행한다. 결과는 data\cert-renew.log에 쌓인다.
cd /d "%~dp0.."
echo [%date% %time%] >> data\cert-renew.log
node --env-file-if-exists=.env scripts\renew-cert.js >> data\cert-renew.log 2>&1
