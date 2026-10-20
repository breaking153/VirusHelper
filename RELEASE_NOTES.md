文件哈希与校验工具，支持 Windows x64、macOS Apple Silicon 和 macOS Intel。

- 简洁表格界面，选择文件或文件夹后自动计算 MD5；修改算法后自动重新计算。
- 支持 MD5、SHA-1、SHA-256、SHA-512、SHA3-256、BLAKE3、CRC32、xxHash64，以及清单校验和导出。
- Windows 文件和文件夹右键菜单“使用 VirusHelper 计算哈希”，安装时注册、卸载时移除。
- VirusTotal 免费网页检查及 API 查询，API Key 保存在系统凭据库，下次自动加载。
- 启动时自动检查 GitHub Release，按本机系统与架构选择更新包；点击“更新并重启”下载、校验签名并安装。

Windows 下载 `Windows-x64-setup.exe`；Apple Silicon Mac 下载 `macOS-arm64.dmg`；Intel Mac 下载 `macOS-x64.dmg`。`.app.tar.gz`、`.sig` 和 `latest.json` 供自动更新使用。

当前未配置 Windows Authenticode 证书或 Apple Developer 签名/公证，系统首次运行可能提示未知发布者。自动更新包具有独立的 Tauri 更新签名。
