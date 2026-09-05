!macro customInit
  ; Terminate any running instances silently; ignore errors if no processes are running
  nsExec::Exec 'taskkill /F /IM "E Store.exe" /T'
  nsExec::Exec 'taskkill /F /IM "E Store.exe" /T'
  nsExec::Exec 'taskkill /F /IM "IStoreBackend.exe" /T'
!macroend

!macro customUnInstallCheck
  ; Prevent uninstaller from failing due to locked executable files or active processes
  nsExec::Exec 'taskkill /F /IM "E Store.exe" /T'
  nsExec::Exec 'taskkill /F /IM "E Store.exe" /T'
  nsExec::Exec 'taskkill /F /IM "IStoreBackend.exe" /T'
!macroend

!macro customUnInstall
  DetailPrint "Safeguarding user database at $LOCALAPPDATA\iStore..."
  MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to completely delete your database and local backups from %LOCALAPPDATA%\iStore?$\n$\nSelect 'No' to preserve your business data (Recommended)." IDNO keepData
  RMDir /r "$LOCALAPPDATA\iStore"
  keepData:
!macroend
