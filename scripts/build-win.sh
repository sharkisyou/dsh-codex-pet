#!/usr/bin/env bash
# build-win.sh — WSL 驱动 Windows 原生编译桌面宠物（apps/desktop-pet）
#
# 原理：WSL 直接交叉编译到 Windows 不可行（缺 MSVC/MinGW 链接器）。
# 正确做法：通过 WSL interop 调用 Windows 原生 Rust 工具链编译，产出
# 可运行的 desktop-pet.exe（透明窗口 + 完整宠物）。
#
# 用法（在 WSL 仓库根目录执行）：
#   ./scripts/build-win.sh sync     # 导出干净源码到 Windows（git archive）
#   ./scripts/build-win.sh extract  # 导出 + Windows 解压
#   ./scripts/build-win.sh deps     # 解压 + 首次装依赖/构建 TS 包
#   ./scripts/build-win.sh build    # 构建前端 + 编译 Tauri exe
#   ./scripts/build-win.sh run      # 启动 Windows 桌宠
#   ./scripts/build-win.sh all      # 全流程（默认）
#
# 前置条件：Windows 已装 Node/Rust(MSVC)/VS2022/WebView2；WSL 的
# Vite(1420) + pet server(3720) 需保持运行（桌宠数据源）。
#
# 注意：WSL interop 启动的 powershell.exe 不继承 WSL export 的环境变量，
# 因此配置值以内联方式拼入 PowerShell 命令（见 ps() 包装）。

set -euo pipefail

# ---------- 配置 ----------
SRC_TAR="/tmp/dsh-pet-plugin-src.tar.gz"
WIN_DIR="dsh-pet-plugin-win"             # Windows 工作目录名（%USERPROFILE%\dsh-pet-plugin-win）
WIN_TAR="dsh-pet-plugin-src.tar.gz"
EXE_REL="apps\\desktop-pet\\src-tauri\\target\\debug\\desktop-pet.exe"

# ps(): 包装 powershell 调用。内部可用 $WD（win 工作目录）、$EXE_REL。
ps() {
  local script="\$WD = Join-Path \$env:USERPROFILE '$WIN_DIR'
\$EXE_REL = '$EXE_REL'
$1"
  powershell.exe -NoProfile -Command "$script"
}

# ---------- 1. 导出源码到 Windows ----------
sync_source() {
  echo "▶ 1/5 导出干净源码（git archive，排除 node_modules/target）..."
  git archive --format=tar HEAD | gzip > "$SRC_TAR"
  echo "   打包: $(du -h "$SRC_TAR" | cut -f1)"
  local tar_base="$(basename "$SRC_TAR")"
  ps "\$src = '\\\\wsl.localhost\\Ubuntu-24.04\\tmp\\$tar_base'
\$dst = Join-Path \$env:USERPROFILE '$WIN_TAR'
Copy-Item \$src \$dst -Force
Write-Output ('   → ' + \$dst + ' (' + (Get-Item \$dst).Length + ' bytes)')"
}

# ---------- 2. Windows 解压 ----------
extract_win() {
  echo "▶ 2/5 Windows 解压到 %USERPROFILE%\$WIN_DIR ..."
  ps "Remove-Item \$WD -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path \$WD | Out-Null
tar -xzf (Join-Path \$env:USERPROFILE '$WIN_TAR') -C \$WD
Write-Output ('   → ' + \$WD + ' (' + (Get-ChildItem \$WD | Measure-Object).Count + ' items)')"
}

# ---------- 3. 首次依赖 + TS 包 ----------
install_deps() {
  echo "▶ 3/5 Windows 装依赖 + 构建 TS 包（首次，之后可跳过）..."
  ps "\$env:Path = \"\$env:USERPROFILE\\.cargo\\bin;\" + \$env:Path
Set-Location \$WD
cmd /c \"npm install --no-audit --no-fund 2>&1\"
Set-Location \"\$WD\\packages\\pet-core\";     cmd /c \"npm run build 2>&1\"
Set-Location \"\$WD\\packages\\pet-protocol\"; cmd /c \"npm run build 2>&1\"
Set-Location \"\$WD\\apps\\desktop-pet\";      cmd /c \"npm install --no-audit --no-fund 2>&1\"
Write-Output '   deps done'"
}

# ---------- 4. 构建前端 + 编译 Tauri ----------
build_win() {
  echo "▶ 4/5 Windows 构建前端 + 编译 Tauri..."
  ps "\$env:Path = \"\$env:USERPROFILE\\.cargo\\bin;\" + \$env:Path
\$icons = \"\$WD\\apps\\desktop-pet\\src-tauri\\icons\"
if (-not (Test-Path \"\$icons\\icon.ico\")) {
  Write-Output '   缺 icon.ico，用 tauri icon 生成...'
  Set-Location \"\$WD\\apps\\desktop-pet\"
  cmd /c \"npx tauri icon src-tauri/icons/icon.png 2>&1\" | Out-Null
}
Set-Location \"\$WD\\apps\\desktop-pet\"
cmd /c \"npm run build 2>&1\"
cmd /c \"npm run tauri -- build --debug 2>&1\"
Write-Output ('   → ' + \$PWD + '\\src-tauri\\target\\debug\\desktop-pet.exe')"
}

# ---------- 5. 运行 ----------
run_win() {
  echo "▶ 5/5 启动 Windows 桌宠..."
  ps "\$exe = Join-Path \$WD \$EXE_REL
if (-not (Test-Path \$exe)) { Write-Error \"exe 不存在: \$exe（先 build）\"; exit 1 }
Start-Process \$exe
Start-Sleep -Seconds 4
\$p = Get-Process 'desktop-pet' -ErrorAction SilentlyContinue
if (\$p) { Write-Output ('   running PID=' + \$p.Id + ' 窗口=' + \$p.MainWindowTitle + ' 响应=' + \$p.Responding) }
else    { Write-Output '   启动失败：未检测到 desktop-pet 进程' }"
}

# ---------- 主流程 ----------
CMD="${1:-all}"
case "$CMD" in
  sync)    sync_source ;;
  extract) sync_source; extract_win ;;
  deps)    sync_source; extract_win; install_deps ;;
  build)   build_win ;;
  run)     run_win ;;
  all)     sync_source; extract_win; install_deps; build_win; run_win ;;
  *)
    echo "用法: $0 {sync|extract|deps|build|run|all}" >&2
    echo "  sync    —— 导出源码到 Windows" >&2
    echo "  extract —— 导出 + Windows 解压" >&2
    echo "  deps    —— 导出 + 解压 + 首次装依赖/构建 TS 包" >&2
    echo "  build   —— 构建前端 + 编译 Tauri（增量复用 target）" >&2
    echo "  run     —— 启动 Windows 桌宠" >&2
    echo "  all     —— 全流程（默认）" >&2
    exit 1 ;;
esac
