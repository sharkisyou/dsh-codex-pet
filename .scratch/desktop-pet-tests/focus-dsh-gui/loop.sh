#!/usr/bin/env bash
# 端到端验证环：夹具浏览器窗口 + 真实 focus_dsh_gui 实现（examples/focus_probe）。
#
#   场景（用户 2026-09-11 报告）：Chrome 同一窗口里切到别的标签页（窗口标题不再
#   指向 DSH GUI），点托盘会话应把 DSH GUI 标签页切到前台。
#
#   「别的标签页」两种变体（都覆盖真实用户场景）：
#     other-deepseek.html —— 标题也含 deepseek（用户的 DeepSeek 官网/搜索标签页，
#                            旧实现在这里最致命：误判成 GUI 窗口只置前不切标签页）
#     plain.html          —— 标题不含 deepseek（旧实现落到「开新标签页」兜底）
#
#   用法：
#     loop.sh setup [other-deepseek|plain]   # （重新）起夹具 Chrome 窗口
#     loop.sh [other-deepseek|plain]         # 跑一轮：切到「非 DSH 标签页」→ 跑探针 → 断言切回 DSH 标签页
#
#   退出码：0 = 通过（DSH 标签页被激活且窗口在前台）；1 = 失败（用户症状复现）；
#          2 = 夹具窗口不存在（先跑 setup）；其余 = 环境/构建错误。
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
probe="$repo/apps/desktop-pet/src-tauri/target/x86_64-pc-windows-gnu/debug/examples/focus_probe.exe"
ps="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
win_home="$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')"
win_scratch="$win_home\\dsh-focus-diag"
win_scratch_unix="$(wslpath -u "$win_home" 2>/dev/null || echo /mnt/c/Users/HM)/dsh-focus-diag"
mkdir -p "$win_scratch_unix"
cp "$here/fixture-state.ps1" "$win_scratch_unix/fixture-state.ps1"
chrome="$(ls "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" 2>/dev/null || ls "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" 2>/dev/null)"

TARGET_NEEDLE="probe-7"    # 夹具 DSH 标签页标题里的标记
SESSION_TITLE="测试会话 probe-7"
variant="${1:-}"
[[ "$variant" == "setup" ]] && variant="${2:-}"
case "$variant" in
  plain) OTHER_PAGE="plain.html" ;;
  *)     OTHER_PAGE="other-deepseek.html" ;;
esac

ensure_fixture_server() {
  if curl -s --max-time 2 -o /dev/null "http://127.0.0.1:3099/dsh.html"; then return 0; fi
  ( cd "$here/fixture" && nohup node server.mjs >/tmp/focus-fixture-server.log 2>&1 & )
  sleep 1
  curl -s --max-time 2 -o /dev/null "http://127.0.0.1:3099/dsh.html" || { echo "夹具页面服务起不来（port 3099）"; exit 4; }
}

state() {
  "$ps" -NoProfile -ExecutionPolicy Bypass -File "$win_scratch\\fixture-state.ps1" "$@" 2>&1 | tr -d '\r'
}

field() { sed -n "s/^$1=//p" <<<"$2" | head -1 | awk '{print $1}' | tr 'A-Z' 'a-z'; }

setup() {
  "$ps" -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*dsh-focus-diag\profile*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
  sleep 1
  "$ps" -NoProfile -Command "Start-Process -FilePath '$(wslpath -w "$chrome")' -ArgumentList '--user-data-dir=$win_scratch\\profile','--no-first-run','--no-default-browser-check','--new-window','http://127.0.0.1:3099/$OTHER_PAGE','http://127.0.0.1:3099/dsh.html'" >/dev/null 2>&1
  sleep 4
  state -ActivateOther | sed -n '1,3p'
}

if [[ "${1:-}" == "setup" ]]; then
  ensure_fixture_server
  setup
  exit 0
fi
ensure_fixture_server

# ① 构建真实实现
if ! (cd "$repo/apps/desktop-pet/src-tauri" && cargo build --target x86_64-pc-windows-gnu --example focus_probe >/tmp/focus-probe-build.log 2>&1); then
  echo "BUILD FAILED:"; tail -20 /tmp/focus-probe-build.log; exit 3
fi
[[ -x "$probe" ]] || { echo "probe binary missing: $probe"; exit 3; }

# ② 把夹具窗口切到「别的标签页活动」——用户报告的场景
before="$(state -ActivateOther)"
if [[ "$(field FOUND "$before")" != "true" ]]; then
  echo "夹具窗口不存在（先跑：$(basename "$0") setup）"; echo "$before"; exit 2
fi
echo "== variant: $OTHER_PAGE =="
echo "== before =="; echo "$before"

# ③ 跑生产实现（真实入口 focus_dsh_gui；禁止兜底开新页，避免打扰用户浏览器）
set +e
out="$("$probe" --title "$SESSION_TITLE" --no-shell-fallback 2>&1)"
code=$?
set -e
out="$(tr -d '\r' <<<"$out")"
echo "== probe (exit=$code) =="; echo "$out"

# ④ 断言：DSH 标签页变成活动标签页，且夹具窗口在前台（前台由探针就地读取，
#    避免 PowerShell 控制台抢占前台污染测量结果）
after="$(state)"
echo "== after =="; echo "$after"
sel_is_target="$(field TARGET_SELECTED "$after")"
probe_front="$(field TARGET_FOREGROUND "$out")"

if [[ "$sel_is_target" == "true" && "$probe_front" == "true" && "$code" == "0" ]]; then
  echo "PASS：点托盘会话 → DSH GUI 标签页被切到前台"
  exit 0
fi
echo "FAIL：DSH 标签页没被激活（TARGET_SELECTED=$sel_is_target TARGET_FOREGROUND=$probe_front probe_exit=$code）"
exit 1
