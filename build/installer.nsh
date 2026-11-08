; Extra steps for the NSIS installer (electron-builder includes this file).
; - First page: Server or Client. Then electron-builder's own pages (install for me / everyone, folder).
; - The role is saved in resources\install-role for desktop.cjs and shown in Windows Settings -> Apps as
;   "<version> server" or "<version> client". Silent installs take /ROLE=server or /ROLE=client.
; - electron-builder reuses an earlier install's folder and removes the old version before copying the new one.
;   customInit tells the user, preselects the earlier install's role, and moves people off the old Squirrel
;   installer (0.15.0 and earlier).
; Everything is installer-only: the uninstaller build would fail on functions it never references.

!ifndef BUILD_UNINSTALLER
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

Var RouterRole
Var RouterOldInstall
Var RouterServerRadio
Var RouterClientRadio

!macro customWelcomePage
  Page custom RouterRolePage RouterRoleLeave
!macroend

Function RouterRolePage
  ; electron-builder includes this file before MUI2.nsh, so MUI_HEADER_TEXT doesn't exist yet. Set the header
  ; controls (1037 title, 1038 subtitle) directly.
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Server or Client"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Choose how this computer uses Local Agent Router."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "Install a Server on the computer that runs the AI providers. Install a Client on other computers to connect to that Server over Tailscale."
  Pop $0
  ${NSD_CreateRadioButton} 10u 34u 100% 12u "&Server - runs providers, projects and sessions on this computer"
  Pop $RouterServerRadio
  ${NSD_CreateRadioButton} 10u 52u 100% 12u "&Client - connects to a Server; runs no providers here"
  Pop $RouterClientRadio
  ${If} $RouterRole == "client"
    ${NSD_Check} $RouterClientRadio
  ${Else}
    ${NSD_Check} $RouterServerRadio
  ${EndIf}
  ${If} $RouterOldInstall != ""
    ${NSD_CreateLabel} 0 76u 100% 24u "Already installed in $RouterOldInstall. The current choice is preselected; Setup updates that install."
    Pop $0
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function RouterRoleLeave
  ${NSD_GetState} $RouterClientRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $RouterRole "client"
  ${Else}
    StrCpy $RouterRole "server"
  ${EndIf}
FunctionEnd

!macro customInit
  StrCpy $RouterRole "server"
  StrCpy $RouterOldInstall ""
  ReadRegStr $RouterOldInstall HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $RouterOldInstall "" 0 +2
    ReadRegStr $RouterOldInstall HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ; An update keeps the earlier install's role unless /ROLE= says otherwise.
  ${If} $RouterOldInstall != ""
  ${AndIf} ${FileExists} "$RouterOldInstall\resources\install-role"
    FileOpen $0 "$RouterOldInstall\resources\install-role" r
    FileRead $0 $1
    FileClose $0
    StrCpy $1 $1 6
    ${If} $1 == "client"
      StrCpy $RouterRole "client"
    ${EndIf}
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/ROLE=" $1
  ${IfNot} ${Errors}
    ${If} $1 == "client"
    ${OrIf} $1 == "server"
      StrCpy $RouterRole $1
    ${EndIf}
  ${EndIf}

  IfSilent initDone
  StrCmp $RouterOldInstall "" checkSquirrel
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Local Agent Router is already installed in:$\r$\n$RouterOldInstall$\r$\n$\r$\nSetup will update it. Your settings, sessions and skills are kept." IDOK initDone
    Quit
  checkSquirrel:
  ReadEnvStr $R2 LOCALAPPDATA
  IfFileExists "$R2\LocalAgentRouter\Update.exe" 0 initDone
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "An older Local Agent Router is installed in:$\r$\n$R2\LocalAgentRouter$\r$\n$\r$\nSetup will remove it after installing the new version. Your settings, sessions and skills are kept." IDOK initDone
    Quit
  initDone:
!macroend

!macro customInstall
  CreateDirectory "$INSTDIR\resources"
  FileOpen $0 "$INSTDIR\resources\install-role" w
  FileWrite $0 $RouterRole
  FileClose $0
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "${VERSION} $RouterRole"

  ; Remove the old Squirrel install. User data lives in LocalAgentRouterData and is not touched.
  ReadEnvStr $R2 LOCALAPPDATA
  StrCmp "$INSTDIR" "$R2\LocalAgentRouter" squirrelDone ; never delete the folder we just installed into
  IfFileExists "$R2\LocalAgentRouter\Update.exe" 0 squirrelDone
    ExecWait '"$R2\LocalAgentRouter\Update.exe" --uninstall -s'
  squirrelDone:
!macroend
!endif
