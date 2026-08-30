#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

/// 设置窗口的标签（与前端 invoke 约定一致）。
const SETTINGS_WINDOW_LABEL: &str = "settings";

/// 打开设置窗口：已存在则显示并聚焦；已被用户关闭（销毁）则重新创建。
/// 前端右键菜单「设置」通过 invoke 调用此命令。
#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("桌宠设置")
    .inner_size(520.0, 640.0)
    .resizable(true)
    .skip_taskbar(true)
    .focused(true)
    .build()
    .map_err(|e| e.to_string())?;

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
            let mut tray = TrayIconBuilder::new()
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
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "settings" => {
                        // 托盘「设置」与右键菜单走同一命令：窗口被关后可重建。
                        let _ = open_settings_window(app.clone());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                });

            let _tray = tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_settings_window])
        .run(tauri::generate_context!())
        .expect("error while running desktop-pet");
}
