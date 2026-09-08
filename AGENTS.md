## Agent skills

### Issue tracker

本仓库的 issue 以 markdown 文件形式存放在 `.scratch/<feature>/` 下。参见 `docs/agents/issue-tracker.md`。

### Triage labels

默认词汇表 — 五个标准角色，标签字符串与角色名相同（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。参见 `docs/agents/triage-labels.md`。

### Domain docs

多上下文布局：根目录 `CONTEXT-MAP.md` 指向每个插件各自的 `CONTEXT.md`；根级 `docs/adr/` 存放系统级决策，各插件内可再有自己的 `docs/adr/`。参见 `docs/agents/domain.md`。

## Windows 桌面宠物构建（WSL → Windows）

> 实测验证（2026-08-30 首测；2026-09-07 起 MinGW 交叉编译为本机日常主力）。目标：在 Windows 上原生运行 `apps/desktop-pet`（Tauri 2 桌宠）。
> **结论：日常主力是 WSL 内 MinGW 交叉编译**（`--features tauri/custom-protocol` 自包含构建，验证通过：透明窗口 + 完整宠物 + 正常运行）。
> 原 interop 脚本路线（scripts/build-win.sh，调 Windows 原生 Rust 工具链）已于 2026-09-08 删除：本机 Windows 侧无
> Rust/VS2022 工具链，且该链路环节多、历史坑多；MSVC target 不可行（WSL 无 link.exe + Windows SDK）；
> 安装器打包（NSIS/WiX）出现需求时走 CI（windows-latest）或临时装 Windows 工具链跑 `tauri build`。

### 前置条件

- **WSL 侧（构建机）**：node/npm（nvm）、rustup（`rustup target add x86_64-pc-windows-gnu`）、
  `sudo apt install mingw-w64`；gnu 链接器配置随仓库提交（`apps/desktop-pet/src-tauri/.cargo/config.toml`），
  无需手工重建。
- **Windows 侧（运行机）**：仅需 WebView2 运行时；没有 Rust/VS2022 完全不影响构建。

### 构建与部署（直接命令）

```bash
cd apps/desktop-pet
npx vite build                                                    # ① 前端 → dist（必须先于 cargo，见下）
cd src-tauri
cargo build --release --target x86_64-pc-windows-gnu \
  --features tauri/custom-protocol -j 8                           # ② 自包含 release exe
cp target/x86_64-pc-windows-gnu/release/desktop-pet.exe \
   target/x86_64-pc-windows-gnu/release/WebView2Loader.dll \
   /mnt/c/Users/<user>/desktop-pet/                               # ③ 部署：exe+dll 必须成对同目录
```

- **改前端后必须重跑 ①**：tauri-build 的 rerun-if-changed 只含 `tauri.conf.json` 与 `capabilities`，
  不追踪 dist；重编译时 proc-macro 才重嵌 dist。若 cargo 显示 fresh 而 dist 已变，`touch src/main.rs` 强制。
- 全量编译约 20-30s；`-j 8` 是 7.6G 内存机器的经验值（16 核全开可能 OOM）。
- release 为 windows 子系统（无终端窗口、无 Rust 日志）；排障时可构建 debug 版（console 子系统带日志；
  WebView2 调试端口须用 tauri.conf.json 的 `additionalBrowserArgs`，
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量会被 wry 显式传参覆盖而失效）。

### 关键注意事项

- **图标**：Windows 构建必须 `src-tauri/icons/icon.ico`（生成 Windows 资源文件）。缺失时 `build` 会自动用
  `npx tauri icon src-tauri/icons/icon.png` 生成。WSL/Linux 构建不需要它。当前是 Twemoji 🐾 矢量渲染的
  中调暖棕 `#A9714B`（深浅色模式均可读；256-48px 双爪、≤32px 单爪、托盘单爪）。
- **改 icon.ico 不会自动重嵌**：tauri-build 只监听 `tauri.conf.json` 和 `capabilities`（实测 2026-09-07），
  单改 ico 后重编译 exe 仍是旧图标。修法：`touch src-tauri/tauri.conf.json` 再 build，或
  `cargo clean -p desktop-pet`。
- **数据源**：Windows 桌宠通过 WSL2 `localhost` 转发连 `ws://127.0.0.1:3720`（pet server），**pet server 必须保持运行**，否则桌宠显示待机剪影形态。Vite（1420）只有 dev 模式构建（未开 custom-protocol）才需要——自包含构建不需要 Vite。
  - **连不连得到与 `PET_SERVER_HOST` 无关**：现代 WSL2（.wslconfig 含 dnsTunneling/autoProxy，
    内核 6.18+）的 localhost relay 会把 Windows 的 `127.0.0.1:3720` 直接桥接到 WSL 回环监听——
    即使 pet server 只绑 `127.0.0.1`（默认），Windows 桌宠也能连（已实测：收到真实 state 响应）。
  - **`PET_SERVER_HOST=0.0.0.0` 的作用**：让 WSL 的 pet server 也监听局域网接口，
    使浏览器通过局域网 IP 预览（`http://172.20.169.96:1420/` 连 `172.20.169.96:3720`）能连上；
    Windows 桌宠本身靠 localhost relay 即可，不设也能连。
  - **pet server 常驻（2026-09-08 起 systemd 化）**：`systemctl --user status pet-server`——
    崩溃 3s 自拉（Restart=always），linger 已开（WSL 启动即自动运行，无需登录会话），
    替代旧 setsid 手工方式。正常日志仍由 server tee 写 `~/.dsh/logs/pet-server.log`；
    崩溃遗言/启动早期错误看 `journalctl --user -u pet-server -e`。unit 在
    `~/.config/systemd/user/pet-server.service`（ExecStart 用 nvm node 绝对路径跑
    monorepo 根的 tsx）。Windows 开机自启桌宠：`shell:startup\desktop-pet-start.cmd`
    （WSL 由用户手动启动，桌宠 exe 靠自动重连等待 server）。
- **调试捕获**：验证 Windows 桌宠渲染用 `PrintWindow` 截窗口（透明区域会呈黑色假象，不代表真的黑底；
  现成脚本 `C:\Users\HM\cap-pet.ps1`，按尺寸特征定位宠物窗口）。视觉验证用
  `~/.dsh/skills/opencode-vision/glm-vision.py "<提示词>" <截图路径>`（GLM 5.3 flash）。
  运行日志三处对照：桥接 `~/.dsh/logs/pet-bridge.log`、pet server `~/.dsh/logs/pet-server.log`、
  前端 UI 事件 `%USERPROFILE%\dsh-pet.log`（petLog 落盘）。
- **MinGW 交叉编译（2026-09-07 起主力，配方见上方构建与部署）**：WSL 直接把 src-tauri 编成 Windows exe，
  实测正常运行、图标嵌入、自包含（custom-protocol）。一次性准备：`sudo apt install mingw-w64` +
  `rustup target add x86_64-pc-windows-gnu` + `.cargo/config.toml` 链接器配置（见前置条件）。
  **必须带 `--features tauri/custom-protocol`**：不开该 feature 时即使 release 也走 `devUrl`
  （http://localhost:1420），产物并非自包含——旧配方"能跑"纯粹因为当时 Vite 恰好在跑（2026-09-07
  实测踩坑：杀 Vite 后所有重启实例窗口空白零连接，CDP `/json/list` 显示页面在加载 localhost:1420）。
  产物为 exe + `WebView2Loader.dll` 一对（gnu target 走动态加载，部署必须同目录成对）。
  - 局限：安装器打包（NSIS/WiX）仍只在 Windows 侧；`--target x86_64-pc-windows-msvc` 依旧不可行（无
    link.exe；cargo-xwin 曲线路未验证，勿浪费时间）。
  - 坑：同 identifier 实例互斥——WebView2 用户数据目录按 identifier 共享（`%LOCALAPPDATA%\dev.yshark.desktop-pet`），
    旧实例未退出时新实例会"秒退"，先关旧实例再启动。
- **release 打包**：正式安装包用 `tauri build`（去掉 `--debug`），或配置 GitHub Actions `windows-latest` runner 自动构建。

## Linux 桌面基本形态（2026-09-07 起支持）

> 目标环境是**真 Linux 桌面**（X11 + 合成器，如 VMware Ubuntu / GNOME）。WSLg 受 RAIL 远程合成限制
> （透明/置顶/点击穿透不可靠、系统托盘无宿主），不作为目标环境。

- **前置系统库（Ubuntu）**：`sudo apt install libwebkit2gtk-4.1-dev build-essential libgtk-3-dev
  libayatana-appindicator3-dev`（本机 WSL 侧已装好）。
- **构建**：`apps/desktop-pet` 下 `npm run build`（重建前端 dist）→ `src-tauri` 下 `cargo build --release`
  （release 把 dist 嵌进二进制，运行时不需要 Vite）。
- **运行**：先起数据面 `npm run server`（pet server 3720），再跑 `src-tauri/target/release/desktop-pet`。
- **平台差异（cfg 门控）**：`focus_dsh_gui` 非 Windows 退化为 `xdg-open` 打开 GUI（不能聚焦既有浏览器窗口）；
  日志落 `$HOME/dsh-pet.log`（Windows 仍是 `%USERPROFILE%`）；系统托盘走 libayatana-appindicator
  （GNOME 需 AppIndicator 扩展，Ubuntu 默认带）。
- **双平台检查**：改 Rust 代码后在 WSL 里 `cargo check`（Linux）+ `cargo check --target
  x86_64-pc-windows-gnu`（MinGW 交叉）各跑一遍，Win32 代码不再能裸混进主干。
