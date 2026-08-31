## Agent skills

### Issue tracker

本仓库的 issue 以 markdown 文件形式存放在 `.scratch/<feature>/` 下。参见 `docs/agents/issue-tracker.md`。

### Triage labels

默认词汇表 — 五个标准角色，标签字符串与角色名相同（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。参见 `docs/agents/triage-labels.md`。

### Domain docs

多上下文布局：根目录 `CONTEXT-MAP.md` 指向每个插件各自的 `CONTEXT.md`；根级 `docs/adr/` 存放系统级决策，各插件内可再有自己的 `docs/adr/`。参见 `docs/agents/domain.md`。

## Windows 桌面宠物构建（WSL → Windows）

> 实测验证（2026-08-30）。目标：在 Windows 上原生运行 `apps/desktop-pet`（Tauri 2 桌宠）。
> 结论：**WSL 里直接交叉编译到 Windows 不可行**（缺 MSVC/MinGW 链接器、无 sudo 装不了工具链）；
> **正确做法是 WSL 通过 interop 调用 Windows 原生 Rust 工具链编译**。已验证成功：透明窗口 + 完整宠物 + 正常运行。

### 前置条件

Windows 侧一次性环境已装好（Node、Rust MSVC、VS2022、WebView2），**勿重装**；装 Rust 勿用 winget（源不可用），用 rustup-init.exe。

### 构建（封装脚本）

> 已封装为 `scripts/build-win.sh`，在 WSL 仓库根目录执行。

```bash
./scripts/build-win.sh sync     # 导出干净源码到 Windows（git archive）
./scripts/build-win.sh extract  # 导出 + Windows 解压
./scripts/build-win.sh deps     # 解压 + 首次装依赖/构建 TS 包
./scripts/build-win.sh build    # 构建前端 + 编译 Tauri exe（增量复用 target）
./scripts/build-win.sh run      # 启动 Windows 桌宠
./scripts/build-win.sh all      # 全流程（默认）：sync→extract→deps→build→run
```

日常迭代（改代码后出 Windows 版）用 `all` 一键完成，全量编译约 2 分钟、增量约 7s。

### 关键注意事项

- **图标**：Windows 构建必须 `src-tauri/icons/icon.ico`（生成 Windows 资源文件）。缺失时 `build` 会自动用
  `npx tauri icon src-tauri/icons/icon.png` 生成。WSL/Linux 构建不需要它。
- **增量编译**：`extract` 会重建工作目录，因此日常改代码后用 `build`（复用 Windows 侧已有 target/node_modules）
  而非 `all`，可跳过 deps 直接增量编译。
- **数据源**：Windows 桌宠通过 WSL2 `localhost` 转发连 `ws://127.0.0.1:3720`（pet server）。
  WSL 的 Vite（1420）+ pet server（3720）需保持运行，否则窗口空白。
  - **连不连得到与 `PET_SERVER_HOST` 无关**：现代 WSL2（.wslconfig 含 dnsTunneling/autoProxy，
    内核 6.18+）的 localhost relay 会把 Windows 的 `127.0.0.1:3720` 直接桥接到 WSL 回环监听——
    即使 pet server 只绑 `127.0.0.1`（默认），Windows 桌宠也能连（已实测：收到真实 state 响应）。
  - **`PET_SERVER_HOST=0.0.0.0` 的作用**：让 WSL 的 pet server 也监听局域网接口，
    使浏览器通过局域网 IP 预览（`http://172.20.169.96:1420/` 连 `172.20.169.96:3720`）能连上；
    Windows 桌宠本身靠 localhost relay 即可，不设也能连。
- **调试捕获**：验证 Windows 桌宠渲染用 `PrintWindow` 截窗口（透明区域会呈黑色假象，不代表真的黑底）。
  视觉验证用 `~/.dsh/skills/vision.md` 的 Muse Spark 多模态模型分析截图。
- **WSL 交叉编译不可行**：勿浪费时间尝试 `--target x86_64-pc-windows-msvc`（无 link.exe）或 MinGW（无 sudo）。
- **release 打包**：正式安装包用 `tauri build`（去掉 `--debug`），或配置 GitHub Actions `windows-latest` runner 自动构建。
