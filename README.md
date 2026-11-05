# VirusHelper

使用 **Rust + Tauri 2 + React + TypeScript** 编写的文件哈希、完整性校验与可选 VirusTotal 查询工具，面向 Windows 10/11 和 macOS 12 及以上（Intel / Apple Silicon）。

参考 [OpenHashTab](https://github.com/liudonghua123/open-hashtab) 的文件完整性校验场景，独立实现。首版是独立桌面应用，不包含 Windows 文件属性页扩展和 Finder 扩展。

## 功能

- 添加多个文件、递归扫描文件夹、原生文件拖放；重复文件路径自动去重。
- 支持 **MD5、SHA-1、SHA-256、SHA-512、SHA3-256、BLAKE3、CRC32、xxHash64（seed 0）**。
- 单次流式读取同时计算所选算法，使用 1 MiB 缓冲区；大文件不整体载入内存。
- 添加文件/文件夹或拖放后自动计算，默认只计算 MD5；更改计算算法后自动重新计算。
- 后台进度、取消与手动重算；计算中也可更改算法，程序取消旧任务后按最新配置计算，单个文件读取失败不影响其他文件。
- 网格表格的第二个数据列显示根据文件内容识别的格式，算法及后续列右移；展示哈希、状态、VT 结果及 VT 威胁类型；每个数据列支持筛选和排序；复选框、Cmd/Ctrl 多选、Shift 连选，跨页全选。
- 复制所选哈希、可粘贴到电子表格的 TSV、文件名/文件类型/哈希/VT 校验行、文件路径及 VT 链接；提供右键菜单与复制快捷键。
- 导入 GNU checksum / SFV 清单，自动计算校验所需算法；显示匹配、不匹配和读取错误。
- 导出可移植清单；中文界面、明暗主题、键盘操作和窄窗口布局。
- OpenHashTab 风格的紧凑表格；选项默认折叠。
- VirusTotal 免费网页检验，以及配置个人 API Key 后在应用中查询已有检测报告。
- 哈希计算离线完成；仅点击 VT 按钮时向 VT 查询哈希，不上传文件内容，不保存文件历史。
- Windows 文件/文件夹右键菜单，打开选中路径并自动计算 MD5。
- macOS 原生安装向导自动注册 Finder 快速操作，并打开快捷指令 App 转换导入。
- 启动检查 GitHub Release，按系统和架构下载签名更新包；选项中可手动检查更新。

MD5 / SHA-1 用于兼容旧清单；CRC32 / xxHash64 用于非密码学校验。普通哈希比对只能检查是否与给定摘要一致，不能替代可信来源、数字签名或恶意软件检测。

## 开发环境

- Node.js **24 LTS** 和 Bun **1.4.4**（仅安装锁定的前端依赖；打包由 Cargo 执行）。
- Rust **stable**（本机验证版本为 1.99.1）。
- Windows：Microsoft C++ Build Tools / Visual Studio 的“使用 C++ 的桌面开发”、WebView2。
- macOS：Xcode Command Line Tools：`xcode-select --install`。

完整系统依赖见 [Tauri 2 前置要求](https://v2.tauri.app/start/prerequisites/)。

在项目根目录执行：

```sh
bun install --frozen-lockfile --ignore-scripts
cargo tauri dev
```

`node node_modules/vite/bin/vite.js --host 127.0.0.1` 仅启动浏览器界面预览，本地文件操作需要通过 Tauri 桌面应用使用。Rust 原生文件对话框和剪贴板不由浏览器模拟。

## 使用

1. 点击“添加文件”或“添加文件夹”，也可直接拖入文件，程序立即自动计算 MD5。默认窗口为 1200×640。
2. 需要其他算法时展开“选项”勾选，程序自动重新计算；取消勾选 MD5、勾选 SHA-256 即可切换。每个文件的每种算法显示为一行。勾选或使用 Cmd/Ctrl、Shift 多选后，点击“复制哈希”按行复制摘要，“复制表格”生成带表头的 TSV，可直接粘贴到电子表格；“复制全部”复制所选文件在当前筛选结果中的所有算法。双击单元格复制对应列的内容；复制校验行的格式为 `文件名<TAB>内容识别格式<TAB>hash<TAB>恶意检出数\引擎总数`，无 VT 统计时为字面值 `0\0`，无法识别时填写“未知格式”。右键可复制校验行、路径、VT 链接，或对所选文件执行 VT 操作。表格获得焦点时支持 Cmd/Ctrl+A 全选、Cmd/Ctrl+C 复制校验行、Cmd/Ctrl+Shift+C 复制表格，Shift+F10 打开右键菜单。
3. 将预期哈希粘贴到“哈希比对”，自动与所选文件全部已计算的哈希匹配。
4. 校验现有清单时，点击“导入清单”，导入后自动计算和校验。需要指定算法时先在“选项”中选择“清单算法”。表格中的 ✓ / ✗ 表示与清单一致 / 不符，悬停可查看预期值。
5. 在底部选择已计算的算法并导出清单。**保存目录应是所有源文件的共同上级目录**，以保证导出的相对路径能够重新导入。

各列标题右侧提供类似 WPS 的筛选下拉按钮，打开后可搜索、勾选值并点击“确定”，或选择升序、降序、取消排序。取消、Esc 或点击面板外部会放弃未应用的改动；“清除此列筛选”只移除该列条件，生效中的列显示漏斗标记。多列条件同时生效，候选值根据其他列的筛选结果联动。需要包含文本条件时，可在下拉面板中展开“文本筛选”；“数字 / 状态筛选”中的 VT 检出数支持 `>0`、`>=5`、`=0` 等条件，也可输入 `3/70` 或“未查询”等状态。点击列标题可依次切换升序、降序与原始顺序；文件名按自然顺序排列，VT 结果按检出数量排序，未知结果置于末尾。筛选与排序在分页前应用，“全选”、复制及批量 VT 操作只使用当前可见结果，Shift 连选与复制遵循显示顺序。“重置筛选与排序”恢复完整列表。

文件格式在 Rust 哈希流中复用最多前 64 KiB 内容进行识别，不依赖文件名或后缀、不额外读取整份文件。支持常见图片、文档、压缩包、ELF、Mach-O，以及根据 PE 头区分的 PE32 / PE32+ EXE、DLL；文本识别支持 UTF-8 与带 BOM 的 UTF-16。文件头采样用于格式识别，不是完整格式验证；容器内部信息不足时显示容器格式，无法识别时显示“未知格式”，空文件显示“空文件”。UI、复制表格和复制校验行均使用同一个识别结果。

更改计算算法会自动重算，主题、API Key 等不影响摘要的设置不会触发重算。导入记录中的算法会自动参与校验，即使之后在选项中取消勾选，预期摘要仍会被验证。取消会保留已完成结果并停止排队重算；如需继续可点击“重新计算”。目录中的符号链接会被跳过，直接添加的常规文件链接会解析到其目标。

## VirusTotal

1. 至少计算 MD5、SHA-1 或 SHA-256 中的一种，在表格中选择一个或多个文件的结果行。同一文件的多种算法行会合并为一次查询，优先使用 SHA-256，其次 SHA-1、MD5；相同哈希也会去重。
2. 点击“免费网页检验”或多选时的“网页检验（数量）”，在默认浏览器打开所选哈希的 VT 报告页；此方式不需要在应用中配置 Key，也可右键复制报告链接。
3. 使用应用内查询时，展开“选项”，粘贴自己的 VT API Key 并点击“保存 Key”，然后点击“API 查询”。多选时使用并发池查询并将结果显示在各行，默认同时进行 4 个请求，可在 VT 区选择 1、2、4、8、16 路并发；VT 接口返回 HTTP 429 且提供明确等待时间时，所有工作请求共享等待截止时间，暂停后续发送，可点击“停止查询”取消后续请求。认证失败、每日额度不足或连续限流会停止队列，已返回结果保留。可通过“获取 Key”打开官方账户页面。
4. 网络需要代理时，在“选项 → VT 代理”填写并保存 `socks5h://127.0.0.1:8890`（由代理解析域名）、`socks5://127.0.0.1:8890` 或 `http://127.0.0.1:端口`，也支持 HTTPS 代理和 `socks://`（等同于 `socks5h://`）。地址需包含协议，不包含用户名、密码或额外路径。代理设置独立保存到系统凭据存储，重启后自动恢复。留空保存或点击“直连”可取消代理。VT 查询与连接测试使用此设置，不读取终端的代理环境变量。
5. 点击“测试连接”可检查已保存设置能否通过 HTTPS 连接 VT 网站；测试不发送 API Key 或文件哈希，不消耗 API 查询额度。连接成功只表示网络可达，API Key 权限与额度仍以实际 API 返回为准。

“VT 威胁类型”列使用接口返回的 [popular_threat_classification](https://docs.virustotal.com/reference/file-object-popular-threat-classification)：优先显示 `suggested_threat_label`，缺失时显示 `popular_threat_category` 的 `value`；没有分类时显示“未提供”，不根据检出数量推断类别。悬停可查看建议标签与分类，双击可复制显示值；该列可按建议标签和原始分类值筛选，“复制表格”也包含 VT 结果及威胁类型。校验行维持四列格式。

API 使用 [VT v3 文件报告接口](https://docs.virustotal.com/reference/file-info)。对所选文件优先使用 SHA-256，其次 SHA-1、MD5；显示恶意检出数 / 引擎统计总数、可疑数和报告日期。未收录、暂无统计、无效 Key、网络失败和额度不足会分别提示。0 检出不代表文件安全，旧报告也不能替代最新检测。本项目不提供文件上传或重新扫描。

Key 通过 Rust 后端保存到当前系统用户的 **Windows 凭据管理器 / macOS 钥匙串**，下次启动自动加载，无需重新填写。保存后输入框清空，仅显示“Key 已保存”；点击“清除 Key”会同时删除系统中保存的凭据，下次启动也不再加载。应用不会将 Key 写入明文配置文件、localStorage、导出清单或日志，也不会把已保存的 Key 回传到界面。系统凭据存储读取/写入失败会明确提示；解锁后可点击“重新加载”。普通本地哈希计算仍可使用。

凭据标识：service 为 `io.virushelper.desktop`，account 为 `virustotal-api-key`。旧会话版本的 Key 没有持久化，需要在此版本中保存一次。底层使用 [keyring 的系统凭据后端](https://docs.rs/keyring/3.6.3/keyring/)，没有单独的应用明文密钥文件。

[VT 公共 API 官方限制](https://docs.virustotal.com/reference/public-vs-premium-api)为 **4 次/分钟、500 次/天**。应用不设置本地请求次数、每分钟窗口或每日额度限制，实际额度由 VT 接口根据账户判断；只有服务端返回 HTTP 429 才标记限流，提供 `Retry-After` 时按该时间等待。保留 10 分钟会话缓存以避免重复请求；缓存命中不调用接口。公共 API 禁止用于商业产品/服务，也限制未贡献新文件的业务工作流；请按实际用途确认适用的 VT 授权。

所有查询都由 Rust 发往固定 HTTPS 域名 `www.virustotal.com`，Key 放在 `x-apikey` 请求头中；不跟随重定向，20 秒超时，报告上限 4 MiB。网页入口也只允许固定 VT 页面与经过校验的哈希。普通本地计算不会调用 VT。

## 清单兼容性与边界

- GNU 格式：`<hex>  <relative filename>` 或 `<hex> *<relative filename>`；支持 GNU 文件名反斜杠、换行和回车转义。
- SFV 格式：`<relative filename> <CRC32>`，分号注释；CRC32 导出使用 SFV，其他算法使用 GNU 格式。SFV 导出以 `./` 开头，避免特殊文件名被当作注释或哈希。
- 默认按摘要长度推断 MD5 / SHA-1 / SHA-256 / SHA-512 / CRC32 / xxHash64；扩展名也用于识别。SHA3-256、BLAKE3 与 SHA-256 的摘要长度相同，外部纯文本清单请在导入前指定算法。应用导出的清单带算法注释。
- 支持 UTF-8（含 BOM）、中文文件名与空格。暂不支持 BSD 格式、Base64 摘要、corz `.hash` 或 UTF-16/ANSI 清单。
- 清单路径以清单目录为根，不允许绝对路径、`..`、盘符/数据流、符号链接越界；缺失文件会进入结果并报告错误。
- 单份清单上限 8 MiB，单批次上限 100,000 个文件；扫描和每个读取块之间响应取消。
- 导出先验证全部条目，再写临时文件并原子替换清单；拒绝覆盖本批次的源文件。
- 为保证跨平台，清单中的目录分隔符请使用 `/`。SFV 无法可靠表示包含换行或末尾空白的文件名，此时请改用其他算法导出 GNU 清单。

## 构建

生成签名更新包前，设置环境变量 `TAURI_SIGNING_PRIVATE_KEY` 为项目维护者的签名私钥路径或内容。密钥生成、备份及 GitHub Secrets 配置见[发布文档](docs/release-and-context-menu.md)。普通本地开发使用 `cargo tauri dev`，不需要签名私钥。

在 Windows 上生成 NSIS 安装程序：

```sh
cargo tauri build --bundles nsis
```

输出：`target/release/virus-helper.exe` 和 `target/release/bundle/nsis/` 下的安装程序。Windows 的 WebView2 使用 Tauri 默认引导安装方式；离线环境应预先安装 WebView2。

在 macOS 对应架构机器上生成应用与安装向导式 DMG：

```sh
cargo xtask package-macos
```

仅在本机安装、不生成需要发布私钥签名的自动更新包时，使用 `cargo xtask package-macos --local`。该选项会对本地应用执行 ad-hoc 签名并校验完整性，无需发布证书。

输出：`target/release/bundle/macos/VirusHelper.app`、`target/release/bundle/pkg/` 下的原生安装包，以及 `target/release/bundle/dmg/` 下的 DMG。

### macOS 安装向导、Finder 快速操作与快捷指令

打开 DMG → 双击“安装 VirusHelper.pkg”→ 按 macOS 原生 Installer 向导完成安装。安装包将应用放入 `/Applications/VirusHelper.app`，同时安装“使用 VirusHelper 计算哈希”Finder 快速操作并刷新服务缓存，**无需额外执行脚本**。

安装结束时会为当前桌面用户打开快捷指令 App，转换导入工作流；此处仍需按系统提示确认添加。脚本只请求系统导入，不把打开窗口视为添加成功；若已有同名快捷指令则保留，避免升级时重复导入。Finder 快速操作可以独立使用。

在 Finder 选中一个或多个文件/文件夹，右键 →“快速操作”（部分系统显示在“服务”）→“使用 VirusHelper 计算哈希”。每次操作打开一个新的应用实例并自动计算 MD5，支持空格、中文、引号及换行文件名。若系统禁用了该操作，在系统设置中搜索“服务”或“扩展”并启用，必要时重新登录。如需使用快捷指令自身的 Finder 入口，在其详情检查“用作快速操作 → Finder”，并按系统提示允许运行脚本。

安装器使用 `/Library/Services/使用 VirusHelper 计算哈希.workflow` 提供系统级服务；安装需要正常的 macOS 管理员认证。没有桌面会话时，服务在下次登录可用，安装器不会将快捷指令导入 root 账户。已导入的快捷指令使用固定应用路径，升级后仍可调用。直接拖拽 `.app` 不会运行安装钩子，正式分发使用这里的 PKG 向导。

封装由 Rust 的 `xtask` 统一执行：先运行 `cargo tauri build --bundles app`，再生成 Finder 工作流并调用 macOS 自带的 `pkgbuild`、`productbuild` 和 `hdiutil`。封装不使用 npm、Node 打包脚本或 JXA；现有 React 前端的 TypeScript/Vite 编译由 Rust 直接调用 Node，前端依赖仍需事先安装。首次使用 Cargo 版 Tauri CLI 时执行 `cargo install tauri-cli --version '~2.12' --locked`。若设置 `APPLE_INSTALLER_SIGNING_IDENTITY`（Developer ID Installer 证书名），同时为 `.pkg` 签名；应用签名、公证与更新包签名仍按原有发布流程配置。Apple 的 [Automator 转快捷指令说明](https://support.apple.com/guide/shortcuts-mac/import-shortcuts-apd02bffbaac/mac) 和 [Finder 快速操作说明](https://support.apple.com/guide/shortcuts-mac/run-a-shortcut-from-another-app-apd163eb9f95/mac)介绍了系统侧的导入与启用步骤。

仓库附带两套 GitHub Actions：

- `ci.yml`：每次 push / PR，在 Windows、macOS Apple Silicon 和 macOS Intel 上运行测试、类型检查、格式检查与 Clippy。
- `release.yml`：推送 `v*` 标签或手动指定已有版本标签后，测试并构建三个平台的签名安装包；全部成功才公开 GitHub Release 和完整更新清单。

工作流采用 GitHub 当前支持的 [runner 标签](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)，通过 npm 与 Cargo 锁文件安装依赖。

当前构建配置不包含分发证书。公开分发前，请按 Tauri 文档配置 [macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/) 或 [Windows 签名](https://v2.tauri.app/distribute/sign/windows/)。Windows 环境无法确认 macOS 实际运行效果；以 macOS CI 结果和实机检查为准。

## 验证命令

```sh
node node_modules/vitest/vitest.mjs run
npm run format:check
cargo xtask frontend
npm audit
cargo test --workspace --locked
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --manifest-path xtask/Cargo.toml --locked
cargo fmt --manifest-path xtask/Cargo.toml -- --check
cargo clippy --manifest-path xtask/Cargo.toml --locked -- -D warnings
```

## 项目结构

```text
crates/hash-core/       算法、流式读取、目录批次、清单解析与安全导出
crates/vt-client/       VT 会话 Key、服务端额度响应、缓存、HTTP 与报告解析
crates/windows-shell/  Windows 原生 COM 右键处理程序与哈希属性页
xtask/                 Rust 构建任务、原生 PKG/DMG 封装与 Finder 工作流模板
src-tauri/             系统凭据持久化、原生对话框、任务状态与取消、Tauri IPC、安装包配置
src/                   React 界面、类型化桥接、状态与交互测试
.github/workflows/     Windows/macOS 检查与构建
docs/superpowers/      已确认的设计与实现计划
CONSTRAINTS.md         项目质量要求
```

Webview 授予主窗口事件、写入剪贴板、签名更新检查/安装和更新后重启权限；文件操作、固定 VT 网络查询和浏览器页面入口由特定 Rust 命令处理，未暴露通用 shell/文件系统或任意 URL 打开接口。生产 CSP 禁止远程脚本与 Webview 外部连接，VT 和更新请求由原生端处理。

## 发布与更新

Windows 文件/文件夹右键计算、GitHub Release 签名自动更新及发布说明见 [发布与右键菜单文档](docs/release-and-context-menu.md)。下载地址：[GitHub Releases](https://github.com/breaking153/VirusHelper/releases/latest)。
