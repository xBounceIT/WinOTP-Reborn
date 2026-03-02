#define MyAppName "WinOTP"
#define MyAppPublisher "xBounceIT"
#define MyAppExeName "WinOTP.exe"
#define MyAppId "{{9C96A88A-8F18-4B57-9F59-AB4E2A8760D1}}"

#ifndef MyAppVersion
  #error "MyAppVersion must be defined by the build script."
#endif

#ifndef MyAppAssetVersion
  #error "MyAppAssetVersion must be defined by the build script."
#endif

#ifndef MyAppArch
  #define MyAppArch "x64"
#endif

#if MyAppArch == "arm64"
  #define InnoArchitecturesAllowed "arm64"
#else
  #define InnoArchitecturesAllowed "x64compatible"
#endif

#ifndef PublishDir
  #define PublishDir "..\\bin\\Release\\net10.0-windows10.0.19041.0\\win-" + MyAppArch + "\\publish"
#endif

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppVerName={#MyAppName} {#MyAppVersion}
DefaultDirName={localappdata}\Programs\WinOTP
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed={#InnoArchitecturesAllowed}
ArchitecturesInstallIn64BitMode={#InnoArchitecturesAllowed}
OutputDir=output
OutputBaseFilename=WinOTP-{#MyAppAssetVersion}-win-{#MyAppArch}-setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
Source: "{#PublishDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"
Name: "{group}\\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
