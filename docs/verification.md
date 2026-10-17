# 验证记录 · 2026-10-17

## 已执行

环境：Windows 11 x64、Rust 1.97.1（MSVC）、Node 24.11.1、npm 11.6.2。

| 检查 | 结果 |
| --- | --- |
| `cargo test --workspace --locked` | 26 项通过（核心库 23 + Tauri 原生桥接 3） |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 通过，无警告 |
| `cargo fmt --all -- --check` | 通过 |
| `npm test` | 12 项通过 |
| `npm run format:check` | 通过 |
| `npm run build` | TypeScript 检查与 Vite 生产构建通过 |
| `npm audit --audit-level=high` | 0 个已知漏洞 |
| `npm run tauri build -- --bundles nsis -- --locked` | Windows x64 生产可执行文件与 NSIS 安装程序构建成功，约 2.22 MiB |

安装包：`target/release/bundle/nsis/VirusHelper_0.1.0_x64-setup.exe`。

SHA-256：`9e45b311bedc40443b97198ba88c2eff325172215fdb90a00029eb921945172b`。

浏览器验证使用本地开发服务器：实际查看明暗主题、清单页面及空状态；检查 1280×820、860×680、768×900、320×760 视口；窄屏检查以 `documentElement.scrollWidth <= documentElement.clientWidth` 为准；确认算法控件可用 Tab 导航。控制台未发现 error / warn。文件操作在浏览器预览中明确禁用，未使用伪造哈希结果冒充桌面功能。

独立代码复审发现的 SFV 文件名歧义、注释样式文件名丢失、清单目录条目绕过校验，均已添加失败复现并修复；复审确认已解决。

## 平台限制

本机没有执行 macOS 构建或实机交互验证。Windows、macOS Intel 和 Apple Silicon 的 GitHub Actions 配置已写入仓库，尚未推送或触发远程工作流。macOS 清单符号链接越界测试仅在 Unix 平台启用，留待 macOS CI 执行。

本机已验证原生任务命令与 Channel 的序列化、互斥、取消和清理；原生文件选择/保存对话框的人工交互、实际安装过程和签名分发仍应在发布前进行平台验收。
