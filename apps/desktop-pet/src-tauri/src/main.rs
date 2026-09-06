#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// 设置窗口的标签（与前端 invoke 约定一致）。
const SETTINGS_WINDOW_LABEL: &str = "settings";
/// 活动托盘窗口的标签（独立窗口，不覆盖宠物窗口）。
const TRAY_WINDOW_LABEL: &str = "tray";
/// 托盘窗口与宠物窗口之间的间距（物理像素）。
const TRAY_GAP_PX: i32 = 4;

/// 打开设置窗口：显示并聚焦。
/// 窗口由 tauri.conf.json 声明（visible:false 启动隐藏），关闭时被拦截为
/// 隐藏而非销毁，因此此处始终能找到并重新显示。
#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) else {
        return Err("设置窗口不存在".into());
    };
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// 把托盘窗口定位到宠物窗口正上方（水平与宠物对齐）；上方放不下时放下方。
/// 永远不与宠物窗口重叠，且不做左右翻边。
fn position_tray_window(app: &tauri::AppHandle) {
    let Some(pet) = app.get_webview_window("pet") else { return };
    let Some(tray) = app.get_webview_window(TRAY_WINDOW_LABEL) else { return };
    let Ok(pet_pos) = pet.outer_position() else { return };
    let Ok(pet_size) = pet.outer_size() else { return };
    let Ok(tray_size) = tray.outer_size() else { return };

    // 用宠物窗口所在显示器的边界做约束。
    let (screen_x, screen_y, screen_w, screen_h) = match pet.current_monitor() {
        Ok(Some(monitor)) => {
            let p = monitor.position();
            let s = monitor.size();
            (p.x, p.y, s.width as i32, s.height as i32)
        }
        _ => (0, 0, 0, 0),
    };
    let right_limit = if screen_w > 0 { screen_x + screen_w } else { i32::MAX };
    let bottom_limit = if screen_h > 0 { screen_y + screen_h } else { i32::MAX };

    let tray_w = tray_size.width as i32;
    let tray_h = tray_size.height as i32;

    // 垂直：优先在宠物上方；上方放不下时放下方；都不行则钳制在屏幕内。
    let above_y = pet_pos.y - tray_h - TRAY_GAP_PX;
    let below_y = pet_pos.y + pet_size.height as i32 + TRAY_GAP_PX;
    let mut y = above_y;
    if y < screen_y {
        y = below_y;
    }
    if y + tray_h > bottom_limit {
        y = bottom_limit - tray_h;
    }
    if y < screen_y {
        y = screen_y;
    }

    // 水平：与宠物左对齐，钳制在屏幕内。
    let mut x = pet_pos.x;
    if x + tray_w > right_limit {
        x = right_limit - tray_w;
    }
    if x < screen_x {
        x = screen_x;
    }

    let _ = tray.set_position(tauri::PhysicalPosition::new(x, y));
}

/// 调整托盘窗口高度（逻辑像素，随活动列表增减）并重新定位。
#[tauri::command]
fn resize_tray_window(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    let Some(tray) = app.get_webview_window(TRAY_WINDOW_LABEL) else {
        return Err("托盘窗口不存在".into());
    };
    let height = height.clamp(80.0, 420.0);
    // 保留当前逻辑宽度，只改高度。
    let scale = tray.scale_factor().unwrap_or(1.0);
    let width = tray
        .inner_size()
        .map(|s| s.width as f64 / scale)
        .unwrap_or(300.0);
    let _ = tray.set_size(tauri::LogicalSize::new(width, height));
    position_tray_window(&app);
    Ok(())
}

/// 显示/隐藏托盘窗口；显示前先定位，保证不覆盖宠物窗口。
#[tauri::command]
fn set_tray_window_visible(app: tauri::AppHandle, visible: bool) -> Result<bool, String> {
    let Some(tray) = app.get_webview_window(TRAY_WINDOW_LABEL) else {
        return Err("托盘窗口不存在".into());
    };
    if visible {
        position_tray_window(&app);
        tray.show().map_err(|e| e.to_string())?;
        let _ = tray.set_focus();
    } else {
        tray.hide().map_err(|e| e.to_string())?;
    }
    Ok(visible)
}

/// 切换托盘窗口显示/隐藏。
#[tauri::command]
fn toggle_tray_window(app: tauri::AppHandle) -> Result<bool, String> {
    let Some(tray) = app.get_webview_window(TRAY_WINDOW_LABEL) else {
        return Err("托盘窗口不存在".into());
    };
    let visible = tray.is_visible().unwrap_or(false);
    set_tray_window_visible(app, !visible)
}

/// 托盘打开会话后把承载 DSH GUI 的浏览器窗口还原并置顶。
///
/// 会话切换发生在网页内部（client sessions.open），但浏览器可能被最小化或
/// 置于后台；这里扫描常见浏览器、把窗口标题含 “DeepSeek” 的窗口还原+置顶。
/// 找不到时用默认浏览器打开 GUI 地址（持久 cookie 已认证，可直开）。
#[tauri::command]
fn focus_dsh_gui() -> Result<(), String> {
    const PS: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PetWin32 {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$found = $false
foreach ($name in @('chrome','msedge','firefox','brave','opera','vivaldi')) {
  $procs = Get-Process -Name $name -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'DeepSeek' }
  foreach ($p in $procs) {
    [PetWin32]::ShowWindow($p.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
    [PetWin32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    $found = $true
  }
  if ($found) { break }
}
if (-not $found) {
  Start-Process 'http://127.0.0.1:3080/'
}
"#;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", PS])
        .output()
        .map_err(|e| format!("focus_dsh_gui: 无法执行 powershell: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "focus_dsh_gui: powershell 失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// 前端日志组件：把一行日志追加到 `%USERPROFILE%\dsh-pet.log`，便于事后排查
/// Windows 桌宠 UI/动画问题（无 devtools 时）。调用方已 console.log。
#[tauri::command]
fn pet_log_append(line: String) -> Result<(), String> {
    let profile = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    let path = std::path::Path::new(&profile).join("dsh-pet.log");
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("无法打开日志文件 {}: {e}", path.display()))?;
    let _ = writeln!(file, "{line}");
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "唤醒/隐藏", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &settings, &quit])?;

            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            let tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("桌宠")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => {
                        if let Some(window) = app.get_webview_window("pet") {
                            let visible = window.is_visible().unwrap_or(true);
                            if visible {
                                let _ = window.hide();
                                // 隐藏宠物时一起收起托盘窗口
                                if let Some(tray_win) = app.get_webview_window(TRAY_WINDOW_LABEL) {
                                    let _ = tray_win.hide();
                                }
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "settings" => {
                        // 托盘「设置」与右键菜单走同一命令。
                        let _ = open_settings_window(app.clone());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                });

            let _tray = tray.build(app)?;

            // 设置窗口「关闭」改为隐藏而非销毁：这样右键菜单/托盘再次打开时
            // 窗口仍存在（get_webview_window 可命中），避免动态重建的 URL 问题。
            if let Some(settings_window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
                let window = settings_window.clone();
                settings_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
            }

            // 托盘窗口跟随宠物窗口移动：宠物被拖动时，保持托盘紧贴其旁边。
            if let Some(pet_window) = app.get_webview_window("pet") {
                let app_handle = app.handle().clone();
                pet_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Moved(_) = event {
                        if let Some(tray_win) = app_handle.get_webview_window(TRAY_WINDOW_LABEL) {
                            if tray_win.is_visible().unwrap_or(false) {
                                position_tray_window(&app_handle);
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_settings_window,
            set_tray_window_visible,
            toggle_tray_window,
            resize_tray_window,
            focus_dsh_gui,
            pet_log_append
        ])
        .run(tauri::generate_context!())
        .expect("error while running desktop-pet");
}
