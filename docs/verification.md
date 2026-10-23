# 验证记录

## 2026-10-20 · v0.2.0 右键菜单与签名更新

- 本机 Windows：Rust 46 项测试、Clippy（警告视为错误）、Rust/前端格式检查、TypeScript 与 Vite 生产构建通过。前端 33 项与发布清单 4 项测试通过，npm audit 无已知漏洞。
- 三个平台的[云端质量检查](https://github.com/breaking153/VirusHelper/actions/runs/39372387507)全部通过：Windows x64、macOS Intel、macOS Apple Silicon；包含各平台 Rust 测试、Clippy、前端检查与依赖审计。
- [签名发布工作流](https://github.com/breaking153/VirusHelper/actions/runs/39372388537)的版本验证、三平台构建和最终发布全部成功，[v0.2.0 Release](https://github.com/breaking153/VirusHelper/releases/tag/v0.2.0)已公开。下载全部 10 个公开资源，核对 `SHA256SUMS.txt` 的 9 个文件校验值，并分别验证 Windows、macOS arm64、macOS x64 更新包的 minisign 签名和签名版本；均通过。应用配置的匿名 `releases/latest/download/latest.json` 地址无需登录即可取得完整三平台清单，版本为 0.2.0。
- Windows x64 NSIS 签名安装包已在本机生成，约 3.38 MiB；本地包 SHA-256 为 `b62f4b5394b699e41525e41ee3bb08388a4cc56e6f58959069fa86519234bd02`。使用与 updater 相同的 minisign 验证库，确认签名、内置公钥与签名版本 0.2.0 一致；篡改测试包后校验失败。
- 已把可执行文件复制到当前用户 `AppData\Local\Programs\VirusHelper\virus-helper.exe` 并注册文件、文件夹两个固定 HKCU 菜单。检查实际注册命令后，使用系统 Shell 的 `VirusHelper.Hash` verb 打开含中文、空格和 `&` 的测试路径；进程保持运行，命令行中的选中文件路径完整，未经过 cmd/PowerShell。未运行完整安装程序。
- 前端验证启动路径加载和自动 MD5、StrictMode 不重复计算、读取失败后手动选择可恢复；更新测试覆盖启动检查、手动重查、计算中禁用安装、失败重试、不提前重启和过期 updater 资源清理。
- 发布测试验证三个架构必须完整、更新包名称不冲突、签名不为空、版本标签一致，以及旧版本后完成时不得替换较新 Latest。
- 浏览器检查更新选项与 760×500 布局，无横向溢出，控制台无 error/warn；展开选项时可纵向滚动。浏览器预览不连接更新服务。
- 独立审查通过。审查发现的多窗口静默退出问题改为 Windows `basicUi` 安装模式：安装器先询问是否关闭其他实例；发布阶段跨版本串行并按数值版本决定 Latest，防止 Latest 回退。

## 2026-10-18 历史验证

## 已执行

环境：Windows 11 x64、Rust 1.97.1（MSVC）、Node 24.11.1、npm 11.6.2。

| 检查 | 结果 |
| --- | --- |
| `cargo test --workspace --locked` | 44 项通过（核心库 23 + Tauri 原生桥接/凭据/VT 13 + VT 客户端 8） |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 通过，无警告 |
| `cargo fmt --all -- --check` | 通过 |
| `npm test` | 26 项通过 |
| `npm run format:check` | 通过 |
| `npm run build` | TypeScript 检查与 Vite 生产构建通过 |
| `npm audit --audit-level=high` | 0 个已知漏洞 |
| `npm run tauri build -- --bundles nsis -- --locked` | Windows x64 生产可执行文件与 NSIS 安装程序构建成功，约 3.14 MiB |

安装包：`target/release/bundle/nsis/VirusHelper_0.1.0_x64-setup.exe`。

SHA-256：`94101d01928ed36f0cc1cd2e41c772374f28709c9db789015ab34e98078f20b8`。

界面采用 OpenHashTab 风格三列表格，无侧栏和独立详情面板。本轮默认窗口由 900×620 缩小至 760×500；浏览器检查 760×500 默认布局与 640×440 最小窗口的折叠选项，最小窗口满足 `documentElement.scrollWidth <= documentElement.clientWidth`。此前已验证明暗主题与 320×760 窄屏。最小高度下展开选项允许纵向滚动。控制台未发现 error / warn。macOS 12 的 Safari 15 使用 `100vh` 高度回退。文件操作在浏览器预览中明确禁用。

2026-10-18 自动计算验证：默认仅 MD5，选文件后自动计算；改变算法自动重算，计算期间也能更改，快速变更只执行最新待处理配置。必须等待旧任务与取消确认均结束后才开始下一任务；旧任务晚到事件不能污染新结果。手动取消清空待处理请求，取消 IPC 临时失败后可再次尝试。测试还覆盖卸载组件时取消任务、主题变化不重算、清单期望不丢失及原有错误重试/导出/VT 交互。

前端交互测试覆盖计算、原生错误重试、取消、MD5 单算法导出、追加文件保留清单、手动比对、哈希/校验行复制、100 行分页，以及 VT Key 保存后清空输入框、无自动查询、只提交哈希、免费网页入口、未收录/额度错误和切换文件后隐藏旧报告。

Key 持久化新增验证：实际 Windows 凭据管理器使用独立随机测试账户，保存测试 Key 后启动独立子进程，确认能自动读取；随后验证覆盖、清除及新会话不再加载，测试账户在结束时删除。未访问用户已有凭据。内存存储 fixture 验证保存/删除失败、无效输入、读取失败后重试、底层删除返回成功但凭据未消失，以及删除成功但确认读取失败后重新加载与会话同步。macOS 依赖存在忽略删除状态的路径，因此应用对清除操作额外读取确认；macOS 实际钥匙串交互仍待实机验证。

前端新增验证：启动自动识别已保存 Key、清除后状态更新、保存失败提示、初始加载期间禁止编辑，以及折叠选项时也能看到读取错误并重新加载。浏览器确认设置区已改为系统凭据存储说明，控制台无 error / warn。

VT 测试通过本地 HTTP fixture 验证真实 GET 路径和 `x-apikey` 请求头，无文件请求体；覆盖 200 报告、404 未收录、401 Key 错误、429 额度、302 不跟随、无效 JSON 和报告大小限制。另验证输入哈希、滑动限流、缓存有效期与额度、清除 Key 和原生设置返回值不含 Key。没有使用真实 VT Key，也没有调用线上接口；后续可在应用内配置自己的 Key 进行实测。

独立代码复审发现的 SFV 文件名歧义、注释样式文件名丢失、清单目录条目绕过校验，均已添加失败复现并修复；复审确认已解决。

本轮紧凑界面和 VT 集成独立复审通过；`git diff --check` 和 Impeccable 一次性静态检测通过。Webview CSP 没有新增外网权限，网络和固定网页跳转由 Rust 命令处理。

追加的 Key 持久化功能独立复审通过。复审发现的 macOS 删除状态忽略，以及删除确认读取失败后的会话同步问题，均有失败复现、修复及回归验证。

自动计算与任务切换独立复审通过；取消失败后不可重试的问题已通过失败复现修复。新版 Windows 可执行文件已直接启动，未执行安装程序。

## 平台限制

本机为 Windows，没有执行 macOS 实机交互验证。macOS Intel 和 Apple Silicon 的原生测试、清单符号链接越界测试与其他质量检查已在对应 GitHub Actions runner 上通过；这不等同于 macOS 图形界面、钥匙串和实际升级过程的实机验收。

本机已验证原生任务命令与 Channel 的序列化、互斥、取消和清理，以及右键 verb 的进程启动和签名校验。完整安装/卸载及跨版本升级未在本机执行，遵循用户先不安装的要求。没有真实 VT API Key 的线上接口验证。

## 2026-10-23 OpenHashTab 风格 Shell 注册修复（0.2.1）

更正：此前的静态 verb 注册与 ShellExecute 启动验证，仅能证明注册值/进程参数，不能证明菜单实际显示；10 月 23 日用户报告及桌面检查确认旧入口没有出现在完整菜单。当前已将旧静态 verb 替换为独立 Rust COM DLL，采用 OpenHashTab 的 AllFilesystemObjects / ContextMenuHandlers / PropertySheetHandlers 注册方式。

本次本机验证：

- Rust 全工作区 52 项测试通过；包含 6 项新 Shell 测试，覆盖真实 CF_HDROP 中文多选、命令 ID、空选择、页面接受/拒绝，以及测试自建隐藏原生窗口中自动 MD5、切换 SHA-256 后更新结果。
- Clippy 全工作区所有目标（warnings denied）、Rust 格式检查通过。前端 33 项和 Node 发布脚本 5 项测试通过；Prettier、TypeScript/Vite 生产构建、git diff --check 通过。
- Windows 0.2.1 x64 NSIS 安装包与 Tauri 更新签名构建成功，3.55 MiB；生成的 installer.nsi 确认安装 virushelper_shell-0.2.1.dll 并按相同 VERSION 注册。
- 当前用户稳定目录放入新版 exe 和 DLL，未运行完整安装程序。手动注册、卸载清理、重新注册通过，卸载检查确认自己的 CLSID 与两类 handler 键均删除。
- 独立进程使用 CoCreateInstance 成功加载已注册生产 DLL，初始化两个含中文/空格/& 的实际文件路径，生成正确命令 ID，并成功创建/释放属性页。
- 使用 SHBindToParent 获取真实文件系统文件夹，调用其 IContextMenu 组装未显示的测试菜单，确认包含“使用 VirusHelper 计算哈希”；.txt 多选、无扩展名文件和文件夹分别通过。直接对 Desktop 文件夹传入完整 PIDL 不会组装出同等菜单，验收工具已改为实际父文件夹与相对 PIDL。
- 调用已注册 IContextMenu::InvokeCommand 成功启动稳定目录中的 Tauri 程序；进程元数据确认两个测试路径完整传入同一窗口。未使用 cmd/PowerShell 作为文件启动中间层。
- 独立代码复审通过；复审指出的 Win32 同步重入导致重叠 &mut 问题已改为 Rc/RefCell，并补上隐藏窗口交互测试。构建与发布增加版本化 DLL 文件名校验及回归测试。

本次安装包 SHA-256：08fc887ed4d53f5b83d02f50c8e48a1e80e24d45284d292c85825245993c5f55。

限制：本次没有接管桌面验证实际菜单截图或属性页视觉布局；上述菜单证据来自真实文件系统菜单提供器的未显示菜单。Windows 11 新版第一层菜单没有实现，经典菜单和属性页才是本轮入口。完整安装/卸载、真实跨版本升级仍未执行。macOS 本轮只有条件编译隔离，尚未获得 0.2.1 CI/实机结果。发布 GitHub 的本机网络返回 EOF，0.2.1 尚未公开发布；不能用已有 0.2.0 CI 结果作为本次验证。
