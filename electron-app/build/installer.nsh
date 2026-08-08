!define WINOTP_LEGACY_INSTALL_DIRECTORY "$LOCALAPPDATA\Programs\WinOTP_Reborn"
!define WINOTP_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\{9C96A88A-8F18-4B57-9F59-AB4E2A8760D1}_is1"
!define WINOTP_LEGACY_START_MENU_DIRECTORY "$SMPROGRAMS\WinOTP"

Var /GLOBAL isWinOtpUpdate

; The v1 updater passes /CURRENTUSER but not NSIS's /S switch. Treat that
; legacy invocation as a silent update so users do not see an installer page.
!macro preInit
  StrCpy $isWinOtpUpdate "0"
  ${GetParameters} $0
  ${GetOptions} $0 "/CURRENTUSER" $1
  ${IfNot} ${Errors}
    SetSilent silent
    StrCpy $isWinOtpUpdate "1"
  ${EndIf}
!macroend

; The retired Inno Setup installer used the directory above and the _is1
; uninstall key. Keep that location for the first v2 install so an update
; launched by the old client replaces the existing installation in place.
!macro customInit
  StrCpy $0 ""
  ReadRegStr $0 HKCU "Software\${APP_GUID}" "InstallLocation"
  ${If} $0 != ""
    ; A v2 install may have been moved by a previous installer. Its own
    ; registered location always wins over the legacy default.
    StrCpy $INSTDIR $0
  ${Else}
    StrCpy $0 ""
    ReadRegStr $0 HKCU "${WINOTP_LEGACY_UNINSTALL_KEY}" "InstallLocation"
    ${If} $0 != ""
      ${If} ${FileExists} "$0\WinOTP.exe"
        StrCpy $INSTDIR $0
      ${Else}
        StrCpy $INSTDIR "${WINOTP_LEGACY_INSTALL_DIRECTORY}"
      ${EndIf}
    ${Else}
      StrCpy $INSTDIR "${WINOTP_LEGACY_INSTALL_DIRECTORY}"
    ${EndIf}
  ${EndIf}
!macroend

; Remove the old Inno registration and uninstaller after the new payload has
; been installed. This leaves one installed application and one uninstall
; entry instead of a stale legacy entry alongside v2.
!macro customInstall
  DeleteRegKey HKCU "${WINOTP_LEGACY_UNINSTALL_KEY}"
  Delete "$INSTDIR\unins000.exe"
  Delete "$INSTDIR\unins000.dat"
  Delete "$INSTDIR\unins000.msg"
  Delete "${WINOTP_LEGACY_START_MENU_DIRECTORY}\WinOTP.lnk"
  Delete "${WINOTP_LEGACY_START_MENU_DIRECTORY}\Uninstall WinOTP.lnk"
  RMDir "${WINOTP_LEGACY_START_MENU_DIRECTORY}"

  ; Silent update requests have no finish page. Relaunch through Electron
  ; Builder's user-context helper after the old client has been replaced.
  ${If} $isWinOtpUpdate == "1"
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  ${EndIf}
!macroend
