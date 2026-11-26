# 更新后自动重打

这套助手给太初用来在官方 Cursor 更新之后，把简体中文补丁重新打上。它只做检测和重打，不会结束 Cursor 进程，也不会关闭或拦截官方更新器。

## 行为

1. 读取 `product.json` 的版本号，以及主要界面文件、简体语言包的 SHA-256。
2. 检查是否还能看到补丁标记（例如「远程控制」「计划与用量」）。
3. 若官方文件已变或补丁缺失：
   - Cursor 仍在运行（包括托盘）时，记录为待处理，静默等待完全退出后再写入。不会在应用启动或运行过程中打补丁，也不会结束进程。
   - Cursor 已完全退出时，用现有词库重打，以便下一次启动恢复中文。
4. 若版本号变了，先建立 `cursor-i18n-backup-<版本>-<日期>` 备份，再按新版本适配。不会改写 `cursor-i18n-backup-3.31.15-20261122`。
5. 全新英文句子若不在旧词库中，这次重打可能覆盖不到，需要再补翻译。

## 计划任务

以当前 Windows 用户安装，通常不需要管理员权限：

- `CursorZhCN-Reapply`：登录时以 `wscript` 完全隐藏启动守护进程（检查一次，随后监听安装目录变化）
- 已不再注册 `CursorZhCN-Reapply-Poll`（旧的 15 分钟轮询会在重新安装时移除）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\guard\reapply.ps1" -InstallTask
powershell -NoProfile -ExecutionPolicy Bypass -File ".\guard\reapply.ps1" -Status
powershell -NoProfile -ExecutionPolicy Bypass -File ".\guard\reapply.ps1" -DetectOnly
powershell -NoProfile -ExecutionPolicy Bypass -File ".\guard\reapply.ps1" -Disable
powershell -NoProfile -ExecutionPolicy Bypass -File ".\guard\reapply.ps1" -Enable
powershell -NoProfile -ExecutionPolicy Bypass -File ".\guard\reapply.ps1" -UninstallTask
powershell -NoProfile -ExecutionPolicy Bypass -File ".\guard\reapply.ps1" -ApplyNow
```

`-ApplyNow` 同样要求 Cursor 已完全退出。

本地状态文件（不要提交）：

- `guard/state.json`：上次成功打补丁的版本与哈希
- `guard/reapply.log`：检查日志
- `guard/disabled.flag`：临时关闭标记

路径默认在当前用户目录下，也可用 `CURSOR_INSTALL_ROOT`、`CURSOR_I18N_WORK` 覆盖。
