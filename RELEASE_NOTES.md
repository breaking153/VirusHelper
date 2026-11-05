VirusHelper 0.3.2

- 表格支持类似 WPS 的列标题下拉筛选：搜索、勾选值、多列联动、升降序排序；多选、分页和复制遵循筛选后的显示顺序。
- 文件格式根据文件内容识别，并显示在文件名后的第二列；支持 PE32/PE32+ EXE、DLL 及常见图片、文档、压缩包等格式。
- VT 查询支持 1、2、4、8、16 路并发，默认 4 路；额度仅根据 VT 接口响应判断。新增 HTTP(S)、SOCKS5 代理配置和无 Key 的连接测试。
- 显示 VT 返回的威胁标签与分类，支持筛选和复制。双击复制对应单元格，Command/Ctrl+C 复制四列校验行，复制成功显示渐隐提示。
- macOS 提供 DMG 内嵌原生 PKG 安装向导，也可直接下载 PKG；安装时注册 Finder 快速操作，并在桌面会话中引导导入快捷指令。
- 修正 Windows Shell 验证对系统短路径别名的处理，并为较慢的 CI 环境提供足够的分页交互测试时间。
- Windows 提供 x64 NSIS 安装向导，安装或升级时自动注册经典右键菜单和“VirusHelper 哈希”属性页，卸载时清理对应注册项，无需另行运行注册脚本。

下载说明：

- Windows：选择 `Windows-x64-setup.exe`。Windows 11 的右键入口位于“显示更多选项”；文件属性页也提供哈希功能。
- Apple Silicon Mac：选择 `macOS-arm64.dmg` 或 `macOS-arm64.pkg`。
- Intel Mac：选择 `macOS-x64.dmg` 或 `macOS-x64.pkg`。
- `.app.tar.gz`、`.sig` 和 `latest.json` 用于应用自动更新；`SHA256SUMS.txt` 提供下载文件校验值。

安装包未配置 Windows Authenticode 或 Apple Developer 公证，操作系统可能显示来源确认提示。自动更新包使用独立的 Tauri 更新签名。
