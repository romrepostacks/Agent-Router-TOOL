; Extra steps for the NSIS installer (electron-builder includes this file).
; - First page: Server or Client. Then, for a Server, optional AI tools (Claude Code, Codex, Copilot), installed
;   after the app by resources\install-clis.ps1. Then electron-builder's own pages (install for me / everyone, folder).
; - The role is saved in resources\install-role for desktop.cjs and shown in Windows Settings -> Apps as
;   "<version> server" or "<version> client". Silent installs take /ROLE=server or /ROLE=client.
; - electron-builder reuses an earlier install's folder and removes the old version before copying the new one.
;   customInit tells the user, preselects the earlier install's role, and moves people off the old Squirrel
;   installer (0.15.0 and earlier).
; - The uninstaller (Windows Settings -> Apps, or Start menu -> Uninstall Local Agent Router) asks whether to also
;   delete the user's data. Updates and silent uninstalls never delete it.
; Installer-only code sits in !ifndef BUILD_UNINSTALLER: the uninstaller build fails on functions it never references.

!ifndef BUILD_UNINSTALLER
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include WordFunc.nsh

Var RouterRole
Var RouterOldInstall
Var RouterServerRadio
Var RouterClientRadio

Var RouterTools
Var RouterClaudeBox
Var RouterCodexBox
Var RouterCopilotBox

!macro customWelcomePage
  Page custom RouterRolePage RouterRoleLeave
  Page custom RouterToolsPage RouterToolsLeave
!macroend

; Optional command-line AI tools, installed after the app by resources\install-clis.ps1. Server installs only.
Function RouterToolsPage
  ${If} $RouterRole == "client"
    Abort
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:AI tools (optional)"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Install the command-line tools you have subscriptions for."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "Ticked tools are downloaded and installed after Local Agent Router, in a PowerShell window. Tools already installed are skipped. You can also install them later in Settings -> AI tools."
  Pop $0
  ${NSD_CreateCheckbox} 10u 32u 100% 12u "Claude Code - coding and UI work with a Claude subscription"
  Pop $RouterClaudeBox
  ${NSD_CreateCheckbox} 10u 48u 100% 12u "Codex - planning and reviews with a ChatGPT plan (installs Node.js if needed)"
  Pop $RouterCodexBox
  ${NSD_CreateCheckbox} 10u 64u 100% 12u "GitHub Copilot CLI - security audits and GitHub requests (installs Node.js if needed)"
  Pop $RouterCopilotBox
  ClearErrors
  ${WordFind} "$RouterTools" "claude" "E+1{" $0
  ${IfNot} ${Errors}
    ${NSD_Check} $RouterClaudeBox
  ${EndIf}
  ClearErrors
  ${WordFind} "$RouterTools" "codex" "E+1{" $0
  ${IfNot} ${Errors}
    ${NSD_Check} $RouterCodexBox
  ${EndIf}
  ClearErrors
  ${WordFind} "$RouterTools" "copilot" "E+1{" $0
  ${IfNot} ${Errors}
    ${NSD_Check} $RouterCopilotBox
  ${EndIf}
  ${NSD_CreateLabel} 0 86u 100% 24u "Sign in to each tool afterwards from Settings -> AI tools."
  Pop $0
  nsDialogs::Show
FunctionEnd

; Keeps only known tool names in $RouterTools, so nothing else reaches the PowerShell command line.
Function RouterCleanTools
  StrCpy $1 ""
  ClearErrors
  ${WordFind} "$RouterTools" "claude" "E+1{" $0
  ${IfNot} ${Errors}
    StrCpy $1 "$1,claude"
  ${EndIf}
  ClearErrors
  ${WordFind} "$RouterTools" "codex" "E+1{" $0
  ${IfNot} ${Errors}
    StrCpy $1 "$1,codex"
  ${EndIf}
  ClearErrors
  ${WordFind} "$RouterTools" "copilot" "E+1{" $0
  ${IfNot} ${Errors}
    StrCpy $1 "$1,copilot"
  ${EndIf}
  StrCpy $RouterTools $1
FunctionEnd

Function RouterToolsLeave
  StrCpy $RouterTools ""
  ${NSD_GetState} $RouterClaudeBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $RouterTools "$RouterTools,claude"
  ${EndIf}
  ${NSD_GetState} $RouterCodexBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $RouterTools "$RouterTools,codex"
  ${EndIf}
  ${NSD_GetState} $RouterCopilotBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $RouterTools "$RouterTools,copilot"
  ${EndIf}
FunctionEnd

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
  ; /TOOLS=claude,codex,copilot preselects the AI tools page, and is what a silent install installs.
  StrCpy $RouterTools ""
  ClearErrors
  ${GetOptions} $0 "/TOOLS=" $1
  ${IfNot} ${Errors}
    StrCpy $RouterTools ",$1"
    Call RouterCleanTools
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
  CreateShortCut "$SMPROGRAMS\Uninstall Local Agent Router.lnk" "$INSTDIR\${UNINSTALL_FILENAME}"

  ; AI tools ticked on the AI tools page (or /TOOLS=). Failures don't fail Setup; the script says to retry in Settings.
  ${If} $RouterRole == "server"
  ${AndIf} $RouterTools != ""
    DetailPrint "Installing AI tools: $RouterTools"
    ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-clis.ps1" -Tools "$RouterTools"'
  ${EndIf}

  ; Remove the old Squirrel install. User data lives in LocalAgentRouterData and is not touched.
  ReadEnvStr $R2 LOCALAPPDATA
  StrCmp "$INSTDIR" "$R2\LocalAgentRouter" squirrelDone ; never delete the folder we just installed into
  IfFileExists "$R2\LocalAgentRouter\Update.exe" 0 squirrelDone
    ExecWait '"$R2\LocalAgentRouter\Update.exe" --uninstall -s'
  squirrelDone:
!macroend
!endif

!ifdef BUILD_UNINSTALLER
!macro customUnInstall
  Delete "$SMPROGRAMS\Uninstall Local Agent Router.lnk"
  ; An update runs the old uninstaller first: keep everything then, and in silent uninstalls.
  ${ifNot} ${isUpdated}
    IfSilent keepData
    ReadEnvStr $R2 LOCALAPPDATA
    ReadEnvStr $R3 APPDATA
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Local Agent Router data?$\r$\n$\r$\nThis removes settings, chat history, saved API keys, paired devices and imported skills:$\r$\n$R2\LocalAgentRouterData$\r$\n$R3\Local Agent Router$\r$\n$\r$\nYour project folders and installed AI tools are not touched." IDNO keepData
      RMDir /r "$R2\LocalAgentRouterData"
      RMDir /r "$R3\Local Agent Router"
    keepData:
  ${endIf}
!macroend
!endif
