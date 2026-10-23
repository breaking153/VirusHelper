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

## Windows Shell 扩展（0.2.1 起）

参考 OpenHashTab 的 `Setup/Package.wxs`，改为原生 Rust COM DLL：在 `AllFilesystemObjects\shellex` 下注册 `ContextMenuHandlers` 和 `PropertySheetHandlers`。文件/文件夹经典右键菜单“使用 VirusHelper 计算哈希”一次将全部选择交给主程序；文件属性中新增“VirusHelper 哈希”页，默认 MD5，切换算法自动重算，支持目录递归。属性页可打开完整程序使用 VT 和导出功能。

Windows 11 新版第一层菜单需要 `IExplorerCommand` 和应用包身份；本实现与 OpenHashTab 一样使用经典接口，入口在“显示更多选项”及“属性”，不声称新版第一层支持。

构建时会生成独立的 `windows-shell` DLL，并作为 `virushelper_shell-<版本>.dll` 随 NSIS 安装包分发。属性页异步计算前固定该 DLL 到宿主进程生命周期，避免线程返回到已卸载模块；版本化文件名让后续版本可独立安装。卸载后已经加载的 DLL 可能需要关闭对应资源管理器窗口或重新登录后才能删除；脚本不强制重启 Explorer。没有在 Explorer 内加载 Tauri Webview、VT Key 或发起网络请求。

无需运行完整安装包也可在当前用户下注册：先将生产 exe 和 DLL 放在同一稳定目录，再运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-context-menu.ps1 -ExecutablePath 'C:\path\virus-helper.exe' -ShellExtensionPath 'C:\path\virushelper_shell-0.2.1.dll'
```

位置为 64 位 `HKCU\Software\Classes\CLSID\{6F5D6C28-415B-48EE-B3E8-BAAD03A18D41}\InprocServer32`（`ThreadingModel=Apartment`），以及 `AllFilesystemObjects\shellex` 的两种处理程序分类。不需要管理员权限。注册、更新和卸载均发送 `SHCNE_ASSOCCHANGED` 通知；旧 `*\shell\VirusHelper.Hash` / `Directory\shell\VirusHelper.Hash` 菜单被清理，避免重复。

删除注册（只删除 VirusHelper 自己的键）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/unregister-context-menu.ps1
```

只支持 64 位 Windows 宿主；32 位文件管理器需要额外的 x86 DLL，本轮未提供。一次启动使用 Windows 原生命令行传递选择路径，受到 32,767 UTF-16 字符总长度限制；超出限制时不会部分启动，可在主程序中选择大批量文件。主程序内部仍支持最多 100,000 文件。

非交互验收（使用测试文件，不显示菜单、不操作用户窗口）：

```powershell
cargo run -p windows-shell --example verify_registration -- 'C:\absolute\test.txt'
```

该工具验证注册后的真实 COM 激活、文件选择初始化、菜单 ID、属性页创建/释放，并向实际文件系统菜单提供器请求组装菜单，确认包含 VirusHelper。它不能替代 Windows 11 第一层菜单或属性页视觉验收。

每次升级除三个主版本和锁文件外，还需将 `src-tauri/tauri.windows.conf.json` 的资源目的名改为对应版本；构建钩子和发布版本检查均校验此对应关系，遗漏时中止构建。

参考源码：[OpenHashTab 安装注册](https://github.com/liudonghua123/open-hashtab/blob/main/Setup/Package.wxs)。
