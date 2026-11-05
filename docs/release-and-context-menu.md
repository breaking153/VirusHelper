# GitHub 发布与右键菜单

发布目标：公开仓库 `breaking153/virushelper`。应用启动时通过 Tauri 2 updater 检查 Release 的 `latest.json`，由 updater 按操作系统与架构选择更新包并比较版本。启动检查不阻塞文件计算；发现新版后点击“更新并重启”。“选项”中可以手动检查更新。开发模式不检查更新。

更新下载只使用 HTTPS，安装前必须通过内置公钥的签名校验。发布私钥仅保存在本机项目目录以外和 GitHub Actions Secrets，不进入 Git、前端代码或 Release。Windows 的更新退出当前进程后显示基础安装界面；如果其他窗口仍在运行，安装器先请求用户确认关闭，避免静默终止其他窗口的计算。macOS 完成应用替换后重启。下载或校验失败保留旧版，可以重试。

## 首次发布

仓库 Secrets 需要 `TAURI_SIGNING_PRIVATE_KEY`，内容为 Tauri signer 私钥。当前使用无额外密码的专用更新签名密钥；其安全依赖本机文件权限和 GitHub Secrets 访问权限。必须备份私钥，丢失后已安装用户无法验证新密钥签名的更新。此密钥与 Windows Authenticode / Apple Developer 签名相互独立。

本机私钥保存在 `%USERPROFILE%\.tauri\virushelper.key`，文件权限仅允许当前用户访问；公钥已写入 `src-tauri/tauri.conf.json`。请备份私钥，不要提交到仓库或放入 Release。

推送 `v<版本>` 标签后，发布工作流在三个原生 runner 上完成检查、构建和签名：

| 平台                | Rust target            | 分发包         | 更新包            |
| ------------------- | ---------------------- | -------------- | ----------------- |
| Windows x64         | x86_64-pc-windows-msvc | NSIS setup.exe | setup.exe + 签名  |
| macOS Apple Silicon | aarch64-apple-darwin   | dmg + pkg      | app.tar.gz + 签名 |
| macOS Intel         | x86_64-apple-darwin    | dmg + pkg      | app.tar.gz + 签名 |

各构建任务上传包和签名作为工作流产物；仅三个平台全部成功，且汇总清单覆盖三个架构后，最终任务创建草稿 Release、上传全部文件并公开发布。失败时不向已有用户推送缺少平台的更新。

后续发布同时修改 `Cargo.toml`、`package.json`、`src-tauri/tauri.conf.json` 的版本并更新两个锁文件，提交、推送，然后推送同名版本标签。工作流校验标签和三个版本一致，防止更新清单版本错误。不要修改或覆盖已经公开发布的版本。

macOS 包若未配置 Apple Developer 签名和公证，首次运行可能受到 Gatekeeper 限制。更新签名不替代系统应用签名。Windows ARM64 / Linux 暂无发布目标。

## Windows Shell 扩展（0.2.1 起）

参考 OpenHashTab 的 `Setup/Package.wxs`，改为原生 Rust COM DLL：在 `AllFilesystemObjects\shellex` 下注册 `ContextMenuHandlers` 和 `PropertySheetHandlers`。文件/文件夹经典右键菜单“使用 VirusHelper 计算哈希”一次将全部选择交给主程序；文件属性中新增“VirusHelper 哈希”页，默认 MD5，切换算法自动重算，支持目录递归。属性页可打开完整程序使用 VT 和导出功能。

Windows 11 新版第一层菜单需要 `IExplorerCommand` 和应用包身份；本实现与 OpenHashTab 一样使用经典接口，入口在“显示更多选项”及“属性”，不声称新版第一层支持。

构建时会生成独立的 `windows-shell` DLL，并作为 `virushelper_shell-<版本>.dll` 随 NSIS 安装包分发。属性页异步计算前固定该 DLL 到宿主进程生命周期，避免线程返回到已卸载模块；版本化文件名让后续版本可独立安装。卸载后已经加载的 DLL 可能需要关闭对应资源管理器窗口或重新登录后才能删除；脚本不强制重启 Explorer。没有在 Explorer 内加载 Tauri Webview、VT Key 或发起网络请求。

无需运行完整安装包也可在当前用户下注册：先将生产 exe 和 DLL 放在同一稳定目录，再运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-context-menu.ps1 -ExecutablePath 'C:\path\virus-helper.exe' -ShellExtensionPath 'C:\path\virushelper_shell-0.3.1.dll'
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

## macOS 原生安装向导、Finder 快速操作与快捷指令

macOS 分发采用 **DMG → 安装 VirusHelper.pkg → 系统 Installer 向导**。安装包同时包含 `/Applications/VirusHelper.app` 和 `/Library/Services/使用 VirusHelper 计算哈希.workflow`，不要求用户另外运行 shell 脚本。Finder 服务随 PKG 载荷安装；`src-tauri/macos/postinstall` 是由 Installer 自动执行的安装钩子。

本机运行 `cargo xtask package-macos`，由 `xtask/src/macos.rs` 先执行 Cargo 版 Tauri CLI 生成 `.app`，再通过 Rust 标准库生成 Finder 工作流并调用系统 `pkgbuild`、`productbuild` 与 `hdiutil` 生成原生 PKG 和包含该 PKG 的压缩 DMG。首次使用需先安装 `cargo install tauri-cli --version '~2.12' --locked`。该入口不调用 npm，现有 React 前端的 TypeScript/Vite 编译由 `cargo xtask frontend` 直接调用 Node。输出位于 `target/release/bundle/pkg/` 与 `target/release/bundle/dmg/`。发布工作流在 Intel 和 Apple Silicon runner 上分别执行相同封装，上传 DMG；原有 `.app.tar.gz` 与 Tauri 更新签名仍用于自动更新，不经过 PKG。

`xtask` 是仓库内不依赖第三方库的 Rust 构建工具，有独立锁文件，便于离线测试封装逻辑。`.cargo/config.toml` 注册 `cargo xtask` 入口。Tauri 的 `build.rs` 在应用 bundle 生成前运行，不能在那里读取尚未生成的 `.app`；因此由 Rust 任务编排 Tauri 构建和之后的安装器封装。需要只重封已有应用时可运行 `cargo xtask package-macos --package-only --bundle-dir target/release/bundle`。指定架构使用 `--target aarch64-apple-darwin` 或 `--target x86_64-apple-darwin`，任务按目标架构生成安装器限制和对应输出名。

安装向导包含欢迎页、标准安装位置/认证/进度页和完成说明。组件关闭 bundle relocation，固定安装到 `/Applications/VirusHelper.app`，避免移动安装路径后 Finder 工作流失效。应用通过 `ditto` 复制以保留签名与 macOS 元数据；包版本必须与 `.app` 版本一致。设置 `APPLE_INSTALLER_SIGNING_IDENTITY` 可使用 Developer ID Installer 证书签署 PKG，应用签名、公证和 Tauri 更新签名独立配置。

Rust 使用 `xtask/templates/` 内嵌的原生 plist 模板生成 Automator 服务，无需 Node 封装脚本或 JXA。工作流仅接收 Finder 的 `public.item`（文件和文件夹），Run Shell Script 使用参数输入，通过 `/usr/bin/open -n -a <app> --args -- "$@"` 调用应用。应用路径按 shell 单引号规则编码，选中路径始终逐参数传递；新实例保证已运行应用存在时，当前选择也进入现有的启动路径处理流程。

安装钩子以 root 执行，但服务缓存刷新与快捷指令导入通过 `launchctl asuser` 和 `sudo -H -u` 切换到当前控制台用户及其 GUI 会话。没有桌面会话或安装到其他卷时，只安装载荷，不向 root 的快捷指令库写入。已存在同名快捷指令时保留用户副本，否则通过 `open -a Shortcuts <workflow>` 请求 Apple 支持的 Automator 转换；用户仍需确认系统导入界面。Finder 服务不依赖该确认，缓存刷新失败时下次登录生效；系统禁用的服务仍需启用。

`cargo test --manifest-path xtask/Cargo.toml --locked` 在 macOS 上用临时应用实际生成 PKG/DMG、校验磁盘映像并展开安装包，核对载荷、固定路径和安装钩子；同时通过真实 Automator 运行器验证生成的工作流与多文件参数。测试不安装包、不修改实际应用或服务。实际 Installer 安装、Finder 菜单和快捷指令确认仍需桌面验收。

参考：[Apple 工作流转换说明](https://support.apple.com/guide/shortcuts-mac/import-shortcuts-apd02bffbaac/mac)、[Apple Finder 快速操作说明](https://support.apple.com/guide/shortcuts-mac/run-a-shortcut-from-another-app-apd163eb9f95/mac)。

## Windows：从 Codex 桌面版执行本机安装时

打包运行环境可能重定向 AppData 文件和注册表可见范围：从 Codex 终端启动的安装器及伴随验收进程通过，不代表外部文件管理器能看到处理程序。本机正式验收时通过真实文件管理器双击安装包完成安装向导，选择 `C:\Users\15313\Apps\VirusHelper`，并在 Directory Opus 中实际验证右键启动及属性页自动 MD5 / SHA-256。手动注册脚本应在用户正常终端中执行；不要仅依赖 Codex 子进程的注册值或菜单枚举作为跨进程桌面验收。

## 0.3.x 发布检查

发布构建使用 Bun 从已提交锁文件安装前端依赖，检查和前端编译直接调用 Node；Windows 与 macOS 打包入口均为 Cargo xtask，不调用 npm。Windows 在原生测试前先执行 `cargo xtask prepare-windows-shell`，生成 Tauri 资源声明所需的 COM DLL，正式打包使用 `cargo xtask package-windows`。

Windows 发布任务在隔离 runner 中实际运行 NSIS 安装器，验证安装目录中的版本化 DLL、64 位 HKCU 的 COM/菜单/属性页注册，并通过 `verify_registration` 验证真实 COM 激活和文件系统菜单提供器；随后运行卸载程序并检查注册项已清理。这不等同于 Windows 11 新版第一层菜单或交互式安装向导的视觉验收。macOS 的两个架构均发布 DMG、独立 PKG 和带更新签名的应用归档，汇总测试拒绝缺失 PKG 的 Release。
