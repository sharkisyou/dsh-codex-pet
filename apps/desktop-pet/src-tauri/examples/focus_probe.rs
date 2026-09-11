//! 端到端验证用探针：直接调用生产实现 `dsh_focus::focus_dsh_gui`，
//! 不经过 Tauri/托盘 UI，便于在真实桌面上跑「点托盘会话 → 切到 DSH 标签页」
//! 这条路径（见 `.scratch/desktop-pet-tests/focus-dsh-gui/`）。
//!
//! 用法（Windows）：
//! ```text
//! focus_probe.exe --title "会话标题" [--no-shell-fallback]
//! ```
//! 退出码：0 = 切到了 DSH GUI 标签页；1 = 只置前了窗口（没切标签页）；
//! 2 = 用默认浏览器打开了 GUI 地址；3 = 什么都没做。

#[path = "../src/dsh_focus.rs"]
mod dsh_focus;

use dsh_focus::FocusOutcome;

fn main() {
    let mut title: Option<String> = None;
    let mut open_url_on_miss = true;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--title" => title = args.next(),
            "--no-shell-fallback" => open_url_on_miss = false,
            "--dump" => {
                for line in dsh_focus::describe_windows() {
                    println!("{line}");
                }
                return;
            }
            other => {
                eprintln!("unknown arg: {other}");
                std::process::exit(64);
            }
        }
    }

    let outcome = dsh_focus::focus_dsh_gui(title, open_url_on_miss);
    println!("{outcome:?}");
    let fg = dsh_focus::foreground_window();
    println!("FOREGROUND={fg}");
    println!(
        "TARGET_FOREGROUND={}",
        matches!(outcome, FocusOutcome::ActivatedTab { hwnd, .. } | FocusOutcome::RaisedWindow { hwnd } if hwnd == fg)
    );
    std::process::exit(match outcome {
        FocusOutcome::ActivatedTab { .. } => 0,
        FocusOutcome::RaisedWindow { .. } => 1,
        FocusOutcome::OpenedUrl => 2,
        FocusOutcome::Missed => 3,
    });
}
