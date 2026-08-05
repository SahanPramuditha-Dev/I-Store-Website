; ============================================================
;  I-Store ERP -- Inno Setup Installer Script
;  Version: 1.0.0
;  To update the version, change MyAppVersion below,
;  then run build-setup.bat to rebuild the installer.
; ============================================================

#define MyAppName       "I-Store ERP"
#define MyAppVersion     "1.1.39"
#define MyAppPublisher  "I-Store Dev"
#define MyAppURL        "https://github.com/SahanPramuditha-Dev/I-Store-Website"
#define MyAppExeName    "I-Store ERP.exe"
#define MyAppSourceDir  "..\dist-electron\win-unpacked"

; -- Setup Section -----------------------------------------------------------
[Setup]
; Unique GUID -- do NOT change once released (identifies this app to Windows)
AppId={{C6B500C1-5B3E-4B07-96A9-98BF012E4E19}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}

; Install per-user so business data remains in the user's AppData and is not
; overwritten by future upgrades or by another account on the same machine.
DefaultDirName={userappdata}\{#MyAppName}
UsePreviousAppDir=no
DefaultGroupName={#MyAppName}

; Per-user installs do not require elevation and preserve the business data
; root in the current user's LocalAppData profile.
PrivilegesRequired=lowest
CloseApplications=yes
CloseApplicationsFilter=IStoreBackend.exe


OutputDir=..\dist-electron
OutputBaseFilename=I-Store-ERP-Setup-{#MyAppVersion}

; Compression -- lzma2/max balances size vs speed
Compression=lzma2/max
SolidCompression=yes

; Visual
WizardStyle=modern
WizardResizable=yes
ShowLanguageDialog=no

; Minimum Windows version: Windows 10 (Electron 31 requirement)
MinVersion=10.0

; -- Languages ---------------------------------------------------------------
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; -- Installation Tasks ------------------------------------------------------
[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupicon"; Description: "Launch I-Store ERP at Windows startup"; GroupDescription: "Startup"; Flags: unchecked

; -- Files to Install --------------------------------------------------------
[Files]
Source: "{#MyAppSourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; -- Shortcuts ---------------------------------------------------------------
[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startupicon

; -- Registry ----------------------------------------------------------------
[Registry]
Root: HKCU; Subkey: "Software\{#MyAppName}"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey

[InstallDelete]
Type: filesandordirs; Name: "{app}\userData"

; -- Run After Install -------------------------------------------------------
[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

; -- Cleanup on Uninstall ----------------------------------------------------
[UninstallDelete]
; Preserve business data by default. The application writes its runtime data to
; %LOCALAPPDATA%\iStore and should not be deleted during uninstall unless the
; operator explicitly requests a full reset.
; Type: filesandordirs; Name: "{userappdata}\iStore"

[Code]
function ExecuteAndCaptureOutput(const Cmd, Params, OutputFile: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/C ' + Cmd + ' ' + Params + ' > "' + OutputFile + '" 2>&1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function IsProcessRunning(const ProcessName: String): Boolean;
var
  TempFile: String;
  Output: String;
begin
  TempFile := ExpandConstant('{tmp}\process_check.txt');
  Result := False;
  if ExecuteAndCaptureOutput('tasklist', '/FI "IMAGENAME eq ' + ProcessName + '" /NH', TempFile) then
  begin
    if LoadStringFromFile(TempFile, Output) then
      Result := Pos(ProcessName, Output) > 0;
  end;
end;

function TerminateProcessByName(const ProcessName: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('taskkill', '/F /IM ' + ProcessName, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  if IsProcessRunning('IStoreBackend.exe') or IsProcessRunning('I-Store ERP.exe') then
  begin
    TerminateProcessByName('IStoreBackend.exe');
    TerminateProcessByName('I-Store ERP.exe');
  end;
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if IsProcessRunning('IStoreBackend.exe') then
  begin
    if MsgBox('A running instance of I-Store ERP was detected and must be closed before continuing installation.' + #13#10#13#10 +
      'Click Yes to terminate it automatically now, or No to cancel setup.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    begin
      if not TerminateProcessByName('IStoreBackend.exe') then
      begin
        MsgBox('Failed to terminate IStoreBackend.exe automatically. Please close I-Store ERP manually or end IStoreBackend.exe in Task Manager, and then rerun setup.', mbError, MB_OK);
        Result := False;
      end;
    end
    else
      Result := False;
  end;
end;
