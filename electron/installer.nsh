; Silently installs the Visual C++ Redistributable that the bundled portable
; mongod.exe needs to run — without it, a fresh Windows machine with no other
; VC++-dependent software installed would have mongod.exe fail to launch with
; a missing-DLL error the first time the app starts. Running this during
; setup (once, with the installer's own admin elevation) means the app never
; needs to ask for elevation again at runtime just for this.
!macro customInstall
  DetailPrint "Installing Visual C++ Redistributable (required by bundled MongoDB)..."
  SetOutPath "$TEMP"
  File "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
  ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart'
  Delete "$TEMP\vc_redist.x64.exe"
!macroend
