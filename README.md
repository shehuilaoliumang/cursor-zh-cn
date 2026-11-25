# Cursor 简体中文界面补丁

你好，太初。这是一套个人维护的 Cursor 简体中文补丁：只处理 Cursor 自己的界面文案，编辑器本体仍使用微软官方「简体中文」语言包。本仓库只包含词库、打补丁脚本和更新后自动重打说明，**不含** Cursor 官方源码、安装包或 `app.asar`。

## 它做什么

- 把设置页、侧栏、按键说明等 Cursor 专有英文，按完整官方字符串翻成信达雅的简体中文。
- 产品名、模型名和计划名保持原文，例如 Cursor、Composer、Bugbot、Projects、MCP、Worktree、Autopilot、Super、Premium、Grok 4.7 High。
- 快捷键、文件模式（如 `*.md`、`.cursorignore`）和用户数据不会被翻译或提交。
- 官方更新覆盖安装目录后，可用计划任务在 Cursor 完全退出后再自动重打。助手不会结束 Cursor 进程，也不会拦截官方更新。

当前词库按 Cursor 3.32.4 适配。换版本后如出现全新英文，需要再补词条。

## 使用前

1. 已安装 Cursor，并在命令行参数中启用 `zh-cn`（或已安装微软「简体中文」语言包）。
2. 本机有 Node.js（脚本会先查找便携版，再回退到 `PATH` 中的 `node`）。
3. **先完全退出 Cursor**，包括系统托盘图标。脚本发现进程未退出时会拒绝写入。

路径均相对于当前用户目录，可用环境变量覆盖，不必写死用户名：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `CURSOR_INSTALL_ROOT` | `%LOCALAPPDATA%\Programs\cursor` | Cursor 安装根目录 |
| `CURSOR_I18N_WORK` | 本仓库目录，或 `%USERPROFILE%\cursor-i18n-apply` | 词库与脚本所在目录 |
| `CURSOR_I18N_BACKUP` | `%USERPROFILE%\cursor-i18n-backup-<版本>-<日期>` | 同版本官方文件备份 |

旧版 `cursor-i18n-backup-3.31.15-20261122` 备份目录会被拒绝改写。

## 手动打补丁

在仓库根目录（或你复制出的工作目录）执行：

```powershell
node apply-cursor-i18n-v3.js
```

常用参数：

```powershell
node apply-cursor-i18n-v3.js --dry-run
node apply-cursor-i18n-v3.js --backup-dir "$env:USERPROFILE\cursor-i18n-backup-3.32.4-20261125"
node apply-cursor-i18n-v3.js --adapt-new-version
```

脚本会先从同版本官方备份还原界面文件，再写入词库；若备份不存在，应先建一份带日期的新备份，再打补丁。不要对正在运行的 Cursor 强行写入。

## 更新后自动重打

说明见 [`guard/README-zh.txt`](guard/README-zh.txt) 与 [`docs/GUARD.md`](docs/GUARD.md)。安装当前用户计划任务（通常不需要管理员权限）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\guard\reapply.ps1" -InstallTask
```

登录时以及大约每 15 分钟检查一次。若 Cursor 仍在运行，会等到下次再试。可用 `-Disable` / `-Enable` 临时开关，或 `-UninstallTask` 卸载任务。

## 仓库里有什么

- `apply-cursor-i18n-v3.js`：打补丁脚本（词库、模板与 JSX 拆句、校验和）
- `hardcoded-patch-dict-v3.json`：硬编码界面词库
- `nls-delta-v3.json`：语言包增量
- `guard/`：运行检测与自动重打
- `docs/GUARD.md`：助手行为与停用方式

请勿把 Cursor 安装目录、官方备份、日志或 `guard/state.json` 提交进本仓库。

## 许可

词库与脚本以 MIT 许可发布。Cursor 是其权利人的商标；本项目与官方无隶属关系。
