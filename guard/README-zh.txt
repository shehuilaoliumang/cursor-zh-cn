Cursor 简体中文补丁 · 更新后自动重打说明
======================================

作用
----
官方 Cursor 更新往往会覆盖安装目录里的界面补丁。本助手会定期检查：
- product.json 中的版本号
- 主要界面文件和简体语言包的校验值
- 是否还看得到补丁标记（如「远程控制」「计划与用量」）

若发现官方文件已变或补丁缺失，会在 Cursor 完全退出（包括托盘图标）后，
用现有简体词库重新打补丁。不会结束 Cursor 进程，也不会关闭或拦截官方更新。

若 Cursor 当时仍在运行，助手会等到下一次检查（登录时或每 15 分钟）再试。
新版本里如果出现全新英文文案，旧词库未必都能覆盖，那些新句子需要再适配。

位置
----
助手与词库在你的用户目录下：
  %USERPROFILE%\cursor-i18n-apply\
  %USERPROFILE%\cursor-i18n-apply\guard\reapply.ps1
  %USERPROFILE%\cursor-i18n-apply\guard\state.json
  %USERPROFILE%\cursor-i18n-apply\guard\reapply.log

备份（不会改写 3.31.15 那份）在：
  %USERPROFILE%\cursor-i18n-backup-<版本>-<日期>\

计划任务（当前用户，通常不需要管理员权限）
  CursorZhCN-Reapply        登录时检查
  CursorZhCN-Reapply-Poll   每 15 分钟检查一次

常用命令
--------
查看状态：
  powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\cursor-i18n-apply\guard\reapply.ps1" -Status

只检测、不写入：
  powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\cursor-i18n-apply\guard\reapply.ps1" -DetectOnly

临时关闭自动重打（不删除计划任务）：
  powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\cursor-i18n-apply\guard\reapply.ps1" -Disable

重新打开自动重打：
  powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\cursor-i18n-apply\guard\reapply.ps1" -Enable

卸载计划任务：
  powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\cursor-i18n-apply\guard\reapply.ps1" -UninstallTask

重新安装计划任务：
  powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\cursor-i18n-apply\guard\reapply.ps1" -InstallTask

手动立即重打（仍要求 Cursor 已完全退出）：
  powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\cursor-i18n-apply\guard\reapply.ps1" -ApplyNow
