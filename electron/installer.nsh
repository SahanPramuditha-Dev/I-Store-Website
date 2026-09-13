!macro customInit
  ; Move business data outside the deletion path used by older uninstallers.
  ; Rename is atomic because both paths are on the same volume.
  ${If} ${FileExists} "$LOCALAPPDATA\iStore.update-safety\*.*"
    ${IfNot} ${FileExists} "$LOCALAPPDATA\iStore\*.*"
      Rename "$LOCALAPPDATA\iStore.update-safety" "$LOCALAPPDATA\iStore"
    ${Else}
      MessageBox MB_OK|MB_ICONSTOP "E Store found both the live data directory and an update safety copy. Setup stopped without changing either directory. Contact support before continuing." /SD IDOK
      Abort
    ${EndIf}
  ${EndIf}

  ${If} ${FileExists} "$LOCALAPPDATA\iStore\*.*"
    Rename "$LOCALAPPDATA\iStore" "$LOCALAPPDATA\iStore.update-safety"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "E Store could not secure your business data before updating. Close E Store and try again." /SD IDOK
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ${If} ${FileExists} "$LOCALAPPDATA\iStore.update-safety\*.*"
    ${If} ${FileExists} "$LOCALAPPDATA\iStore\*.*"
      MessageBox MB_OK|MB_ICONSTOP "E Store was installed, but both live and protected data directories now exist. Neither was deleted. Contact support before opening E Store." /SD IDOK
      Abort
    ${EndIf}
    Rename "$LOCALAPPDATA\iStore.update-safety" "$LOCALAPPDATA\iStore"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "E Store was installed, but the protected business data could not be restored automatically. Your data remains at $LOCALAPPDATA\iStore.update-safety. Contact support before opening E Store." /SD IDOK
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  DetailPrint "Preserving database and backups at $LOCALAPPDATA\iStore"
!macroend
