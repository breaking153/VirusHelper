# 验证记录 · 2026-10-17

## 已执行

环境：Windows 11 x64、Rust 1.97.1（MSVC）、Node 24.11.1、npm 11.6.2。

| 检查 | 结果 |
| --- | --- |
| `cargo test --workspace --locked` | 36 项通过（核心库 23 + Tauri 原生桥接/VT 5 + VT 客户端 8） |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 通过，无警告 |
| `cargo fmt --all -- --check` | 通过 |
| `npm test` | 15 项通过 |
| `npm run format:check` | 通过 |
| `npm run build` | TypeScript 检查与 Vite 生产构建通过 |
| `npm audit --audit-level=high` | 0 个已知漏洞 |
| `npm run tauri build -- --bundles nsis -- --locked` | Windows x64 生产可执行文件与 NSIS 安装程序构建成功，约 3.11 MiB |

安装包：`target/release/bundle/nsis/VirusHelper_0.1.0_x64-setup.exe`。

SHA-256：`7291c88c6aef840bd727780b5fe49bc2f7436bd847c1c3491191229959d45b1f`。

本轮界面改为 OpenHashTab 风格三列表格，移除侧栏和详情面板。浏览器验证使用本地开发服务器：查看 900×620 默认窗口的明暗主题、640×440 最小窗口及 320×760 窄屏，检查折叠选项与 VT 设置布局；窄屏满足 `documentElement.scrollWidth <= documentElement.clientWidth`。最小高度下展开选项允许纵向滚动。控制台未发现 error / warn。为 macOS 12 的 Safari 15 添加 `100vh` 高度回退。文件操作在浏览器预览中明确禁用。

前端交互测试覆盖计算、原生错误重试、取消、MD5 单算法导出、追加文件保留清单、手动比对、哈希/校验行复制、100 行分页，以及 VT Key 保存后清空输入框、无自动查询、只提交哈希、免费网页入口、未收录/额度错误和切换文件后隐藏旧报告。

VT 测试通过本地 HTTP fixture 验证真实 GET 路径和 `x-apikey` 请求头，无文件请求体；覆盖 200 报告、404 未收录、401 Key 错误、429 额度、302 不跟随、无效 JSON 和报告大小限制。另验证输入哈希、滑动限流、缓存有效期与额度、清除 Key 和原生设置返回值不含 Key。没有使用真实 VT Key，也没有调用线上接口；后续可在应用内配置自己的 Key 进行实测。

独立代码复审发现的 SFV 文件名歧义、注释样式文件名丢失、清单目录条目绕过校验，均已添加失败复现并修复；复审确认已解决。

本轮紧凑界面和 VT 集成独立复审通过；`git diff --check` 和 Impeccable 一次性静态检测通过。Webview CSP 没有新增外网权限，网络和固定网页跳转由 Rust 命令处理。

## 平台限制

本机没有执行 macOS 构建或实机交互验证。Windows、macOS Intel 和 Apple Silicon 的 GitHub Actions 配置已写入仓库，尚未推送或触发远程工作流。macOS 清单符号链接越界测试仅在 Unix 平台启用，留待 macOS CI 执行。

本机已验证原生任务命令与 Channel 的序列化、互斥、取消和清理；原生文件选择/保存对话框的人工交互、实际安装过程和签名分发仍应在发布前进行平台验收。
