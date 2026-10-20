# GitHub 发布与右键菜单

发布目标：公开仓库 `breaking153/virushelper`。应用启动时通过 Tauri 2 updater 检查 Release 的 `latest.json`，由 updater 按操作系统与架构选择更新包并比较版本。启动检查不阻塞文件计算；发现新版后点击“更新并重启”。“选项”中可以手动检查更新。开发模式不检查更新。

更新下载只使用 HTTPS，安装前必须通过内置公钥的签名校验。发布私钥仅保存在本机项目目录以外和 GitHub Actions Secrets，不进入 Git、前端代码或 Release。Windows 的更新退出当前进程后显示基础安装界面；如果其他窗口仍在运行，安装器先请求用户确认关闭，避免静默终止其他窗口的计算。macOS 完成应用替换后重启。下载或校验失败保留旧版，可以重试。

## 首次发布

仓库 Secrets 需要 `TAURI_SIGNING_PRIVATE_KEY`，内容为 Tauri signer 私钥。当前使用无额外密码的专用更新签名密钥；其安全依赖本机文件权限和 GitHub Secrets 访问权限。必须备份私钥，丢失后已安装用户无法验证新密钥签名的更新。此密钥与 Windows Authenticode / Apple Developer 签名相互独立。

本机私钥保存在 `%USERPROFILE%\.tauri\virushelper.key`，文件权限仅允许当前用户访问；公钥已写入 `src-tauri/tauri.conf.json`。请备份私钥，不要提交到仓库或放入 Release。

推送 `v<版本>` 标签后，发布工作流在三个原生 runner 上完成检查、构建和签名：

| 平台 | Rust target | 分发包 | 更新包 |
| --- | --- | --- | --- |
| Windows x64 | x86_64-pc-windows-msvc | NSIS setup.exe | setup.exe + 签名 |
| macOS Apple Silicon | aarch64-apple-darwin | dmg | app.tar.gz + 签名 |
| macOS Intel | x86_64-apple-darwin | dmg | app.tar.gz + 签名 |

各构建任务上传包和签名作为工作流产物；仅三个平台全部成功，且汇总清单覆盖三个架构后，最终任务创建草稿 Release、上传全部文件并公开发布。失败时不向已有用户推送缺少平台的更新。

后续发布同时修改 `Cargo.toml`、`package.json`、`src-tauri/tauri.conf.json` 的版本并更新两个锁文件，提交、推送，然后推送同名版本标签。工作流校验标签和三个版本一致，防止更新清单版本错误。不要修改或覆盖已经公开发布的版本。

macOS 包若未配置 Apple Developer 签名和公证，首次运行可能受到 Gatekeeper 限制。更新签名不替代系统应用签名。Windows ARM64 / Linux 暂无发布目标。

## Windows 右键菜单

安装包为当前用户注册文件和文件夹右键菜单“使用 VirusHelper 计算哈希”，更新时将菜单指向安装目录中的新程序，卸载时删除菜单。Windows 11 的经典菜单入口可能位于“显示更多选项”。每次选择一个文件或文件夹，启动新窗口并自动计算 MD5。

无需运行安装包也可手动注册稳定位置的程序：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-context-menu.ps1 -ExecutablePath 'C:\path\virus-helper.exe'
```

注册位置仅为 `HKCU\Software\Classes\*\shell\VirusHelper.Hash` 和 `HKCU\Software\Classes\Directory\shell\VirusHelper.Hash`，不需要管理员权限。命令直接调用 exe，路径使用双引号，不经过 cmd 或 PowerShell。手动移动 exe 后需要重新注册。

删除菜单：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/unregister-context-menu.ps1
```
