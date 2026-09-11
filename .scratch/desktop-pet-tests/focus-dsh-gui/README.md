# focus-dsh-gui（Windows 端到端验证环）

验证「点托盘会话 → 把承载 DSH GUI 的浏览器标签页切到前台」这条 Windows 路径。
2026-09-11 的 bug（用户实测）就出在这里：只按「窗口标题含 deepseek」匹配窗口，
用户同窗口里打开的 DeepSeek 官网/搜索标签页也含 deepseek → 被误判成 GUI 窗口 →
点托盘只把浏览器窗口置前，**停在别的标签页上**，用户报「不会切换到 DSH 页面」。

## 组成

| 文件 | 作用 |
| --- | --- |
| `loop.sh` | 验证环本体：起夹具 → 切到「非 GUI 标签页」→ 跑真实实现 → 断言切回 GUI 标签页 |
| `fixture-state.ps1` | 读夹具窗口状态（标签页列表 / 活动标签页 / 是否最小化 / 是否前台）；`-ActivateOther` 切到非目标标签页 |
| `fixture/*.html` | 夹具页面：`dsh.html`（标题 `测试会话 probe-7 · DeepSeek Harness`，模拟 GUI 标签页）、`other-deepseek.html`（标题含 deepseek 的干扰页）、`plain.html`（不含 deepseek 的干扰页） |
| `fixture/server.mjs` | 夹具页面服务（127.0.0.1:3099，`loop.sh` 会自动拉起） |

被验证的实现是**生产代码本身**：`apps/desktop-pet/src-tauri/src/dsh_focus.rs`
（`examples/focus_probe.rs` 用 `#[path]` 直接复用该模块，不经 Tauri/托盘 UI）。

## 用法

```bash
cd .scratch/desktop-pet-tests/focus-dsh-gui

./loop.sh setup          # 起夹具 Chrome 窗口（独立 --user-data-dir，不动用户浏览器）
./loop.sh                # 变体 A：其他标签页标题也含 deepseek（旧 bug 的致命分支）
./loop.sh setup plain && ./loop.sh plain   # 变体 B：其他标签页标题不含 deepseek

# 模块纯逻辑测试（任意平台；Linux 下无需 GTK/dbus 依赖）
rustc --edition 2021 --test --crate-name dsh_focus \
  ../../apps/desktop-pet/src-tauri/src/dsh_focus.rs -o /tmp/dsh_focus_test && /tmp/dsh_focus_test
# 或经 example 目标：
cd ../../apps/desktop-pet/src-tauri && cargo test --target x86_64-pc-windows-gnu --example focus_probe
```

退出码：`0` 通过（GUI 标签页被激活且窗口在前台）；`1` 失败（用户症状复现）；
`2` 夹具窗口不存在（先 `setup`）；`3` 构建失败；`4` 夹具页面服务起不来。

## 环境要求

- WSL + Windows 侧装有 Chrome；`cargo build --target x86_64-pc-windows-gnu` 可用。
- 需要能跑 Windows 程序（验证环直接执行 `focus_probe.exe`，经 WSL interop）。
- `fixture-state.ps1` **必须保持纯 ASCII**：Windows PowerShell 5.1 读无 BOM 的
  `.ps1` 按 ANSI 解码，中文注释会把脚本解析坏（实测踩过）。
- 夹具窗口是独立 Chrome 实例，但 UIA 会枚举**所有**浏览器窗口：验证时用户自己的
  GUI 标签页也可能被扫到——环里靠会话标题（`测试会话 probe-7`）消歧，所以别改标题。

## 为什么这样测

Win32/UIA 行为没法单测：不能没有浏览器窗口、也不能依赖用户手点。夹具窗口给出一个
可控的「多标签页浏览器窗口」；探针跑生产实现；断言落在**活动标签页**上——正是用户
报的症状。纯逻辑（选哪个窗口 / 哪个标签页）另有一组跨平台单测。
