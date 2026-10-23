VirusHelper 0.2.1 修复 Windows Shell 集成。

- 参考 OpenHashTab，新增原生 Rust COM 扩展，通过 AllFilesystemObjects 注册经典右键菜单和文件属性页。
- 右键支持多个文件/文件夹一次传入程序；属性页默认自动计算 MD5，切换算法自动重算。
- 属性页使用后台流式计算，支持目录递归，可打开完整程序使用 VT、校验和导出。
- 安装/更新注册版本化 DLL，卸载清理自己的注册，替换旧的静态右键项。
- 保留 Windows x64、macOS Apple Silicon、macOS Intel 的 GitHub Release 签名自动更新。

Windows 11 新版第一层菜单未实现；与 OpenHashTab 相同，使用“显示更多选项”以及文件“属性”入口。

Windows 下载 Windows-x64-setup.exe；Apple Silicon Mac 下载 macOS-arm64.dmg；Intel Mac 下载 macOS-x64.dmg。

当前未配置 Windows Authenticode 证书或 Apple Developer 签名/公证。更新包具有独立的 Tauri 更新签名。
