; NSIS 安装钩子（tauri.conf.json bundle.windows.nsis.installerHooks）
;
; 应用启动时会按系统语言把桌面快捷方式 <productName>.lnk 重命名为
; 「尘渊笔记.lnk」（src/desktop_shortcut.rs）；NSIS 模板的卸载只按
; productName 删除 —— 这里补删中文名，避免卸载残留。
; 守卫与模板卸载逻辑一致：只删目标指向本应用 exe 的快捷方式。
; 文件必须带 UTF-8 BOM：makensis 对无 BOM 文件按 ANSI 解码，中文会乱码。
!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro IsShortcutTarget "$DESKTOP\尘渊笔记.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro UnpinShortcut "$DESKTOP\尘渊笔记.lnk"
    Delete "$DESKTOP\尘渊笔记.lnk"
  ${EndIf}
!macroend
