; ============================================================
;  I-Store ERP -- Inno Setup Installer Script
;  Version: 1.0.0
;  To update the version, change MyAppVersion below,
;  then run build-setup.bat to rebuild the installer.
; ============================================================

#define MyAppName       "I-Store ERP"
#define MyAppVersion     "1.1.15"
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

; Install under Program Files. Application Control policies commonly block
; executable files installed in the user-writable AppData folders.
DefaultDirName={autopf}\{#MyAppName}
UsePreviousAppDir=no
DefaultGroupName={#MyAppName}

; Program Files requires elevation and is a trusted application location.
PrivilegesRequired=admin


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

; -- Run After Install -------------------------------------------------------
[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

; -- Cleanup on Uninstall ----------------------------------------------------
[UninstallDelete]
; Uncomment the line below to delete app data on uninstall:
; Type: filesandordirs; Name: "{userappdata}\{#MyAppName}"
