# VirusHelper

使用 **Rust + Tauri 2 + React + TypeScript** 编写的文件哈希、完整性校验与可选 VirusTotal 查询工具，面向 Windows 10/11 和 macOS 12 及以上（Intel / Apple Silicon）。

参考 [OpenHashTab](https://github.com/liudonghua123/open-hashtab) 的文件完整性校验场景，独立实现。首版是独立桌面应用，不包含 Windows 文件属性页扩展和 Finder 扩展。

## 功能

- 添加多个文件、递归扫描文件夹、原生文件拖放；重复文件路径自动去重。
- 支持 **MD5、SHA-1、SHA-256、SHA-512、SHA3-256、BLAKE3、CRC32、xxHash64（seed 0）**。
- 单次流式读取同时计算所选算法，使用 1 MiB 缓冲区；大文件不整体载入内存。
- 后台计算、进度显示、取消与重新计算；单个文件读取失败不影响其他文件。
- 复制单个哈希、复制所选文件全部哈希，粘贴预期值快速比对。
- 导入 GNU checksum / SFV 清单，自动计算校验所需算法；显示匹配、不匹配和读取错误。
- 导出可移植清单；中文界面、明暗主题、键盘操作和窄窗口布局。
- OpenHashTab 风格的紧凑三列表格：文件名、算法、哈希值；选项默认折叠。
- VirusTotal 免费网页检验，以及配置个人 API Key 后在应用中查询已有检测报告。
- 哈希计算离线完成；仅点击 VT 按钮时联网查询哈希，不上传文件内容，不保存文件历史。

MD5 / SHA-1 用于兼容旧清单；CRC32 / xxHash64 用于非密码学校验。普通哈希比对只能检查是否与给定摘要一致，不能替代可信来源、数字签名或恶意软件检测。

## 开发环境

- Node.js **24 LTS** 和 npm。
- Rust **stable**（本机验证版本为 1.97.1）。
- Windows：Microsoft C++ Build Tools / Visual Studio 的“使用 C++ 的桌面开发”、WebView2。
- macOS：Xcode Command Line Tools：`xcode-select --install`。

完整系统依赖见 [Tauri 2 前置要求](https://v2.tauri.app/start/prerequisites/)。

在项目根目录执行：

```sh
npm ci
npm run tauri dev
```

`npm run dev` 仅启动浏览器界面预览，本地文件操作需要通过 Tauri 桌面应用使用。Rust 原生文件对话框和剪贴板不由浏览器模拟。

## 使用

1. 点击“添加文件”或“添加文件夹”，也可直接拖入文件。需要更改算法时展开“选项”。
2. 点击“开始计算”，每个文件的每种算法显示为一行。选中行后点击“复制哈希”或“复制全部”。双击哈希复制摘要，双击文件名或算法复制 GNU 校验行。
3. 将预期哈希粘贴到“哈希比对”，自动与所选文件全部已计算的哈希匹配。
4. 校验现有清单时，点击“导入清单”，导入后开始计算。需要指定算法时先在“选项”中选择“清单算法”。表格中的 ✓ / ✗ 表示与清单一致 / 不符，悬停可查看预期值。
5. 在底部选择已计算的算法并导出清单。**保存目录应是所有源文件的共同上级目录**，以保证导出的相对路径能够重新导入。

更改算法后请重新计算。导入记录中的算法会自动参与校验，即使之后在选项中取消勾选，预期摘要仍会被验证。取消会保留已完成结果，未完成文件标为“已取消”。目录中的符号链接会被跳过，直接添加的常规文件链接会解析到其目标。

## VirusTotal

1. 至少计算 MD5、SHA-1 或 SHA-256 中的一种，选中一个文件。
2. 点击“免费网页检验”，在默认浏览器打开该文件的 VT 报告页；此方式不需要在应用中配置 Key。
3. 使用应用内查询时，展开“选项”，粘贴自己的 VT API Key 并点击“保存 Key”，然后点击“API 查询”。可通过“获取 Key”打开官方账户页面。

API 使用 [VT v3 文件报告接口](https://docs.virustotal.com/reference/file-info)。对所选文件优先使用 SHA-256，其次 SHA-1、MD5；显示恶意检出数 / 引擎统计总数、可疑数和报告日期。未收录、暂无统计、无效 Key、网络失败和额度不足会分别提示。0 检出不代表文件安全，旧报告也不能替代最新检测。本项目不提供文件上传或重新扫描。

Key 通过 Rust 后端保存到当前系统用户的 **Windows 凭据管理器 / macOS 钥匙串**，下次启动自动加载，无需重新填写。保存后输入框清空，仅显示“Key 已保存”；点击“清除 Key”会同时删除系统中保存的凭据，下次启动也不再加载。应用不会将 Key 写入明文配置文件、localStorage、导出清单或日志，也不会把已保存的 Key 回传到界面。系统凭据存储读取/写入失败会明确提示；解锁后可点击“重新加载”。普通本地哈希计算仍可使用。

凭据标识：service 为 `io.virushelper.desktop`，account 为 `virustotal-api-key`。旧会话版本的 Key 没有持久化，需要在此版本中保存一次。底层使用 [keyring 的系统凭据后端](https://docs.rs/keyring/3.6.3/keyring/)，没有单独的应用明文密钥文件。

[VT 公共 API 官方限制](https://docs.virustotal.com/reference/public-vs-premium-api)为 **4 次/分钟、500 次/天**。应用采用 4 次/60 秒的本地滑动窗口，以及 10 分钟会话缓存；缓存命中不消耗请求额度。每日和账户其他客户端的共享额度由 VT 服务端控制。公共 API 禁止用于商业产品/服务，也限制未贡献新文件的业务工作流；请按实际用途确认适用的 VT 授权。

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

在 Windows 上生成 NSIS 安装程序：

```sh
npm run tauri build -- --bundles nsis
```

输出：`target/release/virus-helper.exe` 和 `target/release/bundle/nsis/` 下的安装程序。Windows 的 WebView2 使用 Tauri 默认引导安装方式；离线环境应预先安装 WebView2。

在 macOS 对应架构机器上生成 `.app` 与 `.dmg`：

```sh
npm run tauri build -- --bundles app,dmg
```

输出：`target/release/bundle/macos/VirusHelper.app` 和 `target/release/bundle/dmg/`。

仓库附带两套 GitHub Actions：

- `ci.yml`：每次 push / PR，在 Windows、macOS Apple Silicon 和 macOS Intel 上运行测试、类型检查、格式检查与 Clippy。
- `build.yml`：手动触发或推送 `v*` 标签后，在各平台构建安装包，保存为 Actions artifacts；不会自动发布 GitHub Release。

工作流采用 GitHub 当前支持的 [runner 标签](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)，通过 npm 与 Cargo 锁文件安装依赖。

当前构建配置不包含分发证书。公开分发前，请按 Tauri 文档配置 [macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/) 或 [Windows 签名](https://v2.tauri.app/distribute/sign/windows/)。Windows 环境无法确认 macOS 实际运行效果；以 macOS CI 结果和实机检查为准。

## 验证命令

```sh
npm test
npm run format:check
npm run build
npm audit
cargo test --workspace --locked
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
```

## 项目结构

```text
crates/hash-core/       算法、流式读取、目录批次、清单解析与安全导出
crates/vt-client/       VT 会话 Key、限流、缓存、HTTP 与报告解析
src-tauri/             系统凭据持久化、原生对话框、任务状态与取消、Tauri IPC、安装包配置
src/                   React 界面、类型化桥接、状态与交互测试
.github/workflows/     Windows/macOS 检查与构建
docs/superpowers/      已确认的设计与实现计划
CONSTRAINTS.md         项目质量要求
```

Webview 只授予主窗口事件与写入剪贴板权限；文件操作、固定 VT 网络查询和浏览器页面入口由特定 Rust 命令处理，未暴露通用 shell/文件系统或任意 URL 打开接口。生产 CSP 禁止远程脚本与 Webview 外部连接，VT 请求由后端发起。
