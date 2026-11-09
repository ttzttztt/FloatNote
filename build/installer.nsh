; electron-builder 会自动引入这个文件（build/installer.nsh）。
;
; 安装 / 自动更新后刷新 Windows 的图标缓存：
; Windows 按「文件路径」缓存快捷方式图标，程序更新后路径不变，桌面上可能一直显示旧图标。
; 安装程序默认只发一个“文件关联已变化”的通知，资源管理器不一定重新读取，这里再让 ie4uinit 刷新一次。
!macro customInstall
  StrCpy $0 "$WINDIR\Sysnative\ie4uinit.exe"  ; 32 位安装程序在 64 位系统上访问真正的 System32
  ${IfNot} ${FileExists} $0
    StrCpy $0 "$WINDIR\System32\ie4uinit.exe"
  ${EndIf}
  ${If} ${FileExists} $0
    nsExec::Exec '"$0" -show'          ; Windows 10 / 11
    Pop $1
    nsExec::Exec '"$0" -ClearIconCache' ; Windows 7 / 8
    Pop $1
  ${EndIf}
!macroend
