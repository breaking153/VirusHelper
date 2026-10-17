# 验证记录 · 2026-10-17

## 已执行

环境：Windows 11 x64、Rust 1.97.1（MSVC）、Node 24.11.1、npm 11.6.2。

| 检查 | 结果 |
| --- | --- |
| `cargo test --workspace --locked` | 44 项通过（核心库 23 + Tauri 原生桥接/凭据/VT 13 + VT 客户端 8） |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 通过，无警告 |
| `cargo fmt --all -- --check` | 通过 |
| `npm test` | 19 项通过 |
| `npm run format:check` | 通过 |
| `npm run build` | TypeScript 检查与 Vite 生产构建通过 |
| `npm audit --audit-level=high` | 0 个已知漏洞 |
| `npm run tauri build -- --bundles nsis -- --locked` | Windows x64 生产可执行文件与 NSIS 安装程序构建成功，约 3.14 MiB |

安装包：`target/release/bundle/nsis/VirusHelper_0.1.0_x64-setup.exe`。

SHA-256：`26f6a8b24de3713a058ca98d1802afb035164975e443b647619e15b4e0772b3a`。

本轮界面改为 OpenHashTab 风格三列表格，移除侧栏和详情面板。浏览器验证使用本地开发服务器：查看 900×620 默认窗口的明暗主题、640×440 最小窗口及 320×760 窄屏，检查折叠选项与 VT 设置布局；窄屏满足 `documentElement.scrollWidth <= documentElement.clientWidth`。最小高度下展开选项允许纵向滚动。控制台未发现 error / warn。为 macOS 12 的 Safari 15 添加 `100vh` 高度回退。文件操作在浏览器预览中明确禁用。

前端交互测试覆盖计算、原生错误重试、取消、MD5 单算法导出、追加文件保留清单、手动比对、哈希/校验行复制、100 行分页，以及 VT Key 保存后清空输入框、无自动查询、只提交哈希、免费网页入口、未收录/额度错误和切换文件后隐藏旧报告。

Key 持久化新增验证：实际 Windows 凭据管理器使用独立随机测试账户，保存测试 Key 后启动独立子进程，确认能自动读取；随后验证覆盖、清除及新会话不再加载，测试账户在结束时删除。未访问用户已有凭据。内存存储 fixture 验证保存/删除失败、无效输入、读取失败后重试、底层删除返回成功但凭据未消失，以及删除成功但确认读取失败后重新加载与会话同步。macOS 依赖存在忽略删除状态的路径，因此应用对清除操作额外读取确认；macOS 实际钥匙串交互仍待实机验证。

前端新增验证：启动自动识别已保存 Key、清除后状态更新、保存失败提示、初始加载期间禁止编辑，以及折叠选项时也能看到读取错误并重新加载。浏览器确认设置区已改为系统凭据存储说明，控制台无 error / warn。

VT 测试通过本地 HTTP fixture 验证真实 GET 路径和 `x-apikey` 请求头，无文件请求体；覆盖 200 报告、404 未收录、401 Key 错误、429 额度、302 不跟随、无效 JSON 和报告大小限制。另验证输入哈希、滑动限流、缓存有效期与额度、清除 Key 和原生设置返回值不含 Key。没有使用真实 VT Key，也没有调用线上接口；后续可在应用内配置自己的 Key 进行实测。

独立代码复审发现的 SFV 文件名歧义、注释样式文件名丢失、清单目录条目绕过校验，均已添加失败复现并修复；复审确认已解决。

本轮紧凑界面和 VT 集成独立复审通过；`git diff --check` 和 Impeccable 一次性静态检测通过。Webview CSP 没有新增外网权限，网络和固定网页跳转由 Rust 命令处理。

追加的 Key 持久化功能独立复审通过。复审发现的 macOS 删除状态忽略，以及删除确认读取失败后的会话同步问题，均有失败复现、修复及回归验证。

## 平台限制

本机没有执行 macOS 构建或实机交互验证。Windows、macOS Intel 和 Apple Silicon 的 GitHub Actions 配置已写入仓库，尚未推送或触发远程工作流。macOS 清单符号链接越界测试仅在 Unix 平台启用，留待 macOS CI 执行。

本机已验证原生任务命令与 Channel 的序列化、互斥、取消和清理；原生文件选择/保存对话框的人工交互、实际安装过程和签名分发仍应在发布前进行平台验收。
