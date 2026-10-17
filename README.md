# VirusHelper

使用 **Rust + Tauri 2 + React + TypeScript** 编写的离线文件哈希与校验工具，面向 Windows 10/11 和 macOS 12 及以上（Intel / Apple Silicon）。

参考 [OpenHashTab](https://github.com/liudonghua123/open-hashtab) 的文件完整性校验场景，独立实现。首版是独立桌面应用，不包含 Windows 文件属性页扩展和 Finder 扩展。

## 功能

- 添加多个文件、递归扫描文件夹、原生文件拖放；重复文件路径自动去重。
- 支持 **MD5、SHA-1、SHA-256、SHA-512、SHA3-256、BLAKE3、CRC32、xxHash64（seed 0）**。
- 单次流式读取同时计算所选算法，使用 1 MiB 缓冲区；大文件不整体载入内存。
- 后台计算、进度显示、取消与重新计算；单个文件读取失败不影响其他文件。
- 复制单个哈希、复制所选文件全部哈希，粘贴预期值快速比对。
- 导入 GNU checksum / SFV 清单，自动计算校验所需算法；显示匹配、不匹配和读取错误。
- 导出可移植清单；中文界面、明暗主题、键盘操作和窄窗口布局。
- 全程离线，不上传文件，不保存文件历史；只保存主题偏好。

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

1. 选择左侧需要的算法，点击“添加文件”或“添加文件夹”，也可直接拖入文件。
2. 点击“开始计算”，选中文件查看详情；点击对应复制按钮或“复制全部”。
3. 将预期哈希粘贴到“快速比对”，自动与该文件已计算的算法匹配。
4. 校验现有清单时，进入“清单校验”，选择清单算法或自动识别，导入后开始计算。
5. 在底部选择已计算的算法并导出清单。**保存目录应是所有源文件的共同上级目录**，以保证导出的相对路径能够重新导入。

更改算法后请重新计算。导入记录中的算法会自动参与校验，即使之后在侧栏取消勾选，预期摘要仍会被验证。取消会保留已完成结果，未完成文件标为“已取消”。目录中的符号链接会被跳过，直接添加的常规文件链接会解析到其目标。

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
src-tauri/             原生对话框、任务状态与取消、Tauri IPC、安装包配置
src/                   React 界面、类型化桥接、状态与交互测试
.github/workflows/     Windows/macOS 检查与构建
docs/superpowers/      已确认的设计与实现计划
CONSTRAINTS.md         项目质量要求
```

运行时只授予主窗口事件与写入剪贴板权限；文件操作由特定 Rust 命令处理，未暴露通用 shell/文件系统接口。生产 CSP 禁止远程脚本与外部连接。
