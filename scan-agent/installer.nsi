; ============================================================
;  ClaimsFlow Scan Agent — NSIS Installer
;  Requires NSIS 3.x + MUI2
;
;  Build inputs (must exist before running makensis):
;    dist\claimsflow-scan-agent.exe   (built by pkg)
;    winsw.exe                        (downloaded from github.com/winsw/winsw)
;    winsw.xml                        (service descriptor)
;    assets\icon.ico                  (optional — fallback to NSIS default)
; ============================================================

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

; ── Metadata ─────────────────────────────────────────────────────────────────
!define PRODUCT_NAME      "ClaimsFlow Scan Agent"
!define PRODUCT_VERSION   "1.0.0"
!define PRODUCT_PUBLISHER "CIC Insurance Group PLC"
!define PRODUCT_URL       "https://claimsflow-frontend.onrender.com"
!define SERVICE_ID        "ClaimsFlowScanAgent"
!define AGENT_PORT        "7420"
!define REG_KEY           "Software\ClaimsFlow\ScanAgent"
!define UNINST_KEY        "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClaimsFlowScanAgent"

Name          "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile       "ClaimsFlow-Scan-Agent-Setup.exe"
InstallDir    "$PROGRAMFILES64\${PRODUCT_NAME}"
InstallDirRegKey HKLM "${REG_KEY}" "InstallDir"
RequestExecutionLevel admin
Unicode True

; ── Icon ────────────────────────────────────────────────────────────────────
; Use NSIS default installer icon — no custom asset bundled.

; ── MUI Pages ─────────────────────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE   "Welcome to ${PRODUCT_NAME} Setup"
!define MUI_WELCOMEPAGE_TEXT    "This wizard will install the ClaimsFlow Scan Agent on your computer.$\r$\n$\r$\nThe agent runs as a Windows service on port ${AGENT_PORT} and lets ClaimsFlow connect to your physical scanner (TWAIN, WIA, ISIS, SANE).$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_TEXT     "The ClaimsFlow Scan Agent has been installed and started.$\r$\n$\r$\nOpen ClaimsFlow in your browser, go to Batch Upload → Scan Document, and your scanner will appear automatically."
!define MUI_FINISHPAGE_LINK     "Open ClaimsFlow"
!define MUI_FINISHPAGE_LINK_LOCATION "${PRODUCT_URL}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── Version info ─────────────────────────────────────────────────────────────
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName"     "${PRODUCT_NAME}"
VIAddVersionKey "ProductVersion"  "${PRODUCT_VERSION}"
VIAddVersionKey "CompanyName"     "${PRODUCT_PUBLISHER}"
VIAddVersionKey "FileDescription" "ClaimsFlow Local Scan Agent Installer"
VIAddVersionKey "FileVersion"     "${PRODUCT_VERSION}"
VIAddVersionKey "LegalCopyright"  "© 2026 ${PRODUCT_PUBLISHER}"

; ── Install section ───────────────────────────────────────────────────────────
Section "ClaimsFlow Scan Agent" SecMain
  SectionIn RO  ; required — cannot be deselected

  ; Stop + remove previous installation
  nsExec::ExecToStack 'sc stop "${SERVICE_ID}"'
  Pop $0
  Sleep 2000
  nsExec::ExecToStack '"$INSTDIR\winsw.exe" uninstall'
  Pop $0

  SetOutPath "$INSTDIR"
  SetOverwrite on

  ; ── Core files ──────────────────────────────────────────────────────────────
  File "dist\claimsflow-scan-agent.exe"
  File "winsw.exe"
  File "winsw.xml"

  ; Create logs directory
  CreateDirectory "$INSTDIR\logs"

  ; ── Install + start Windows service ─────────────────────────────────────────
  nsExec::ExecToStack '"$INSTDIR\winsw.exe" install "$INSTDIR\winsw.xml"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Service installation failed (code $0).$\r$\nThe agent was installed but will not start automatically.$\r$\nYou can start it manually from: $INSTDIR\claimsflow-scan-agent.exe"
  ${Else}
    nsExec::ExecToStack 'sc start "${SERVICE_ID}"'
    Pop $0
  ${EndIf}

  ; ── Start Menu ───────────────────────────────────────────────────────────────
  CreateDirectory "$SMPROGRAMS\ClaimsFlow"
  CreateShortcut  "$SMPROGRAMS\ClaimsFlow\Scan Agent.lnk" \
                  "$INSTDIR\claimsflow-scan-agent.exe" "" \
                  "$INSTDIR\claimsflow-scan-agent.exe" 0
  CreateShortcut  "$SMPROGRAMS\ClaimsFlow\Uninstall Scan Agent.lnk" \
                  "$INSTDIR\Uninstall.exe"

  ; ── Registry ─────────────────────────────────────────────────────────────────
  WriteRegStr   HKLM "${REG_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr   HKLM "${REG_KEY}" "Version"    "${PRODUCT_VERSION}"
  WriteRegStr   HKLM "${REG_KEY}" "Port"       "${AGENT_PORT}"

  WriteRegStr   HKLM "${UNINST_KEY}" "DisplayName"          "${PRODUCT_NAME}"
  WriteRegStr   HKLM "${UNINST_KEY}" "UninstallString"      '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr   HKLM "${UNINST_KEY}" "InstallLocation"      "$INSTDIR"
  WriteRegStr   HKLM "${UNINST_KEY}" "Publisher"            "${PRODUCT_PUBLISHER}"
  WriteRegStr   HKLM "${UNINST_KEY}" "URLInfoAbout"         "${PRODUCT_URL}"
  WriteRegStr   HKLM "${UNINST_KEY}" "DisplayVersion"       "${PRODUCT_VERSION}"
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify"             1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair"             1

  ; ── Uninstaller ──────────────────────────────────────────────────────────────
  WriteUninstaller "$INSTDIR\Uninstall.exe"

SectionEnd

; ── Uninstall section ─────────────────────────────────────────────────────────
Section "Uninstall"

  ; Stop and remove the service
  nsExec::ExecToStack 'sc stop "${SERVICE_ID}"'
  Pop $0
  Sleep 2000
  nsExec::ExecToStack '"$INSTDIR\winsw.exe" uninstall'
  Pop $0
  Sleep 1000

  ; Delete files
  Delete "$INSTDIR\claimsflow-scan-agent.exe"
  Delete "$INSTDIR\winsw.exe"
  Delete "$INSTDIR\winsw.xml"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir  /r "$INSTDIR\logs"
  RMDir  "$INSTDIR"

  ; Start Menu
  Delete "$SMPROGRAMS\ClaimsFlow\Scan Agent.lnk"
  Delete "$SMPROGRAMS\ClaimsFlow\Uninstall Scan Agent.lnk"
  RMDir  "$SMPROGRAMS\ClaimsFlow"

  ; Registry
  DeleteRegKey HKLM "${REG_KEY}"
  DeleteRegKey HKLM "${UNINST_KEY}"

SectionEnd
