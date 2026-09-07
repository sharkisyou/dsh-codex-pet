## Agent skills

### Issue tracker

本仓库的 issue 以 markdown 文件形式存放在 `.scratch/<feature>/` 下。参见 `docs/agents/issue-tracker.md`。

### Triage labels

默认词汇表 — 五个标准角色，标签字符串与角色名相同（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。参见 `docs/agents/triage-labels.md`。

### Domain docs

多上下文布局：根目录 `CONTEXT-MAP.md` 指向每个插件各自的 `CONTEXT.md`；根级 `docs/adr/` 存放系统级决策，各插件内可再有自己的 `docs/adr/`。参见 `docs/agents/domain.md`。

## Windows 桌面宠物构建（WSL → Windows）

> 实测验证（2026-08-30，MinGW 交叉编译 2026-09-07 补测）。目标：在 Windows 上原生运行 `apps/desktop-pet`（Tauri 2 桌宠）。
> 结论：**日常主力是 WSL 通过 interop 调用 Windows 原生 Rust 工具链编译**（已验证成功：透明窗口 + 完整宠物 + 正常运行）。
> 交叉编译方面：MSVC target 不可行（WSL 无 link.exe + Windows SDK）；**MinGW 交叉编译实测可行**（见下方关键注意事项），定位为备选路。

### 前置条件

Windows 侧一次性环境已装好（Node、Rust MSVC、VS2022、WebView2），**勿重装**；装 Rust 勿用 winget（源不可用），用 rustup-init.exe。

### 构建（封装脚本）

> 已封装为 `scripts/build-win.sh`，在 WSL 仓库根目录执行。

```bash
./scripts/build-win.sh sync          # 导出干净源码到 Windows（git archive）
./scripts/build-win.sh extract       # 导出 + Windows 解压
./scripts/build-win.sh deps          # 解压 + 首次装依赖/构建 TS 包
./scripts/build-win.sh build         # 构建前端 + 编译 debug exe（增量复用 target）
./scripts/build-win.sh build-release # 构建前端 + 编译 release exe（增量复用 target/release）
./scripts/build-win.sh run           # 启动 debug 版桌宠
./scripts/build-win.sh run-release   # 启动 release 版桌宠
./scripts/build-win.sh all           # 全流程 debug（默认）：sync→extract→deps→build→run
./scripts/build-win.sh release       # 全流程 release：sync→extract→deps→build→run
```

日常迭代（改代码后出 Windows 版）用 `all` 一键完成，全量编译约 2 分钟、增量约 7s。
日常自用/出正式包用 `release`：release 是 windows 子系统（**不创建终端窗口、无 Rust
日志**），性能更好；首次 release 全量编译 2-3 分钟，之后复用 `target/release` 增量。
排障时用 debug 版（有控制台日志；WebView2 调试端口须用 tauri.conf.json 的 `additionalBrowserArgs`，
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量会被 wry 显式传参覆盖而失效）。

### 关键注意事项

- **图标**：Windows 构建必须 `src-tauri/icons/icon.ico`（生成 Windows 资源文件）。缺失时 `build` 会自动用
  `npx tauri icon src-tauri/icons/icon.png` 生成。WSL/Linux 构建不需要它。
- **增量编译**：`extract` 会重建工作目录，因此日常改代码后用 `build`（复用 Windows 侧已有 target/node_modules）
  而非 `all`，可跳过 deps 直接增量编译。
- **数据源**：Windows 桌宠通过 WSL2 `localhost` 转发连 `ws://127.0.0.1:3720`（pet server），**pet server 必须保持运行**，否则桌宠显示待机剪影形态。Vite（1420）只有 dev 模式构建（未开 custom-protocol）才需要——自包含构建不需要 Vite。
  - **连不连得到与 `PET_SERVER_HOST` 无关**：现代 WSL2（.wslconfig 含 dnsTunneling/autoProxy，
    内核 6.18+）的 localhost relay 会把 Windows 的 `127.0.0.1:3720` 直接桥接到 WSL 回环监听——
    即使 pet server 只绑 `127.0.0.1`（默认），Windows 桌宠也能连（已实测：收到真实 state 响应）。
  - **`PET_SERVER_HOST=0.0.0.0` 的作用**：让 WSL 的 pet server 也监听局域网接口，
    使浏览器通过局域网 IP 预览（`http://172.20.169.96:1420/` 连 `172.20.169.96:3720`）能连上；
    Windows 桌宠本身靠 localhost relay 即可，不设也能连。
- **调试捕获**：验证 Windows 桌宠渲染用 `PrintWindow` 截窗口（透明区域会呈黑色假象，不代表真的黑底；
  现成脚本 `C:\Users\HM\cap-pet.ps1`，按尺寸特征定位宠物窗口）。视觉验证用
  `~/.dsh/skills/opencode-vision/glm-vision.py "<提示词>" <截图路径>`（GLM 5.3 flash）。
  运行日志三处对照：桥接 `~/.dsh/logs/pet-bridge.log`、pet server `~/.dsh/logs/pet-server.log`、
  前端 UI 事件 `%USERPROFILE%\dsh-pet.log`（petLog 落盘）。
- **MinGW 交叉编译实测可行（2026-09-07，备选路）**：WSL 可直接把 src-tauri 编成 Windows exe（debug 冷编译
  1m37s，实测正常运行、图标已嵌入；release 亦验证）。一次性准备：`sudo apt install mingw-w64` +
  `rustup target add x86_64-pc-windows-gnu`；`apps/desktop-pet/src-tauri/.cargo/config.toml`（未跟踪，不进
  git archive）指定 `[target.x86_64-pc-windows-gnu] linker = "x86_64-w64-mingw32-gcc"`，然后
  `cargo build --target x86_64-pc-windows-gnu --features tauri/custom-protocol [--release]`（需 `apps/desktop-pet/dist` 已存在）。
  **必须带 `--features tauri/custom-protocol`**：不开该 feature 时即使 release 也走 `devUrl`
  （http://localhost:1420），产物并非自包含——旧配方"能跑"纯粹因为当时 Vite 恰好在跑（2026-09-07
  实测踩坑：杀 Vite 后所有重启实例窗口空白零连接，CDP `/json/list` 显示页面在加载 localhost:1420）。
  产物为 exe + `WebView2Loader.dll` 一对（gnu target 走动态加载，部署必须同目录成对）。
  - 局限：安装器打包（NSIS/WiX）仍只在 Windows 侧；`--target x86_64-pc-windows-msvc` 依旧不可行（无
    link.exe；cargo-xwin 曲线路未验证，勿浪费时间）。
  - 坑：同 identifier 实例互斥——WebView2 用户数据目录按 identifier 共享（`%LOCALAPPDATA%\dev.yshark.desktop-pet`），
    旧实例未退出时新实例会"秒退"，先关旧实例再启动。
- **release 打包**：正式安装包用 `tauri build`（去掉 `--debug`），或配置 GitHub Actions `windows-latest` runner 自动构建。
