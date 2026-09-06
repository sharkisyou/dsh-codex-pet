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
/// 置于后台；这里扫描常见浏览器的顶层窗口做层叠匹配：
/// ① 标题同时含 “deepseek” 与会话标题 → 精确聚焦该窗口；
/// ② 没有则退回所有标题含 “deepseek” 的窗口；
/// ③ 仍没有 → 用默认浏览器打开 GUI 地址（持久 cookie 已认证，可直开）。
///
/// 纯 Win32 实现（枚举窗口 + ShellExecuteW 开 URL）：不派生子进程——
/// GUI 进程派生控制台子进程（powershell）会让 Windows 新建控制台窗口，
/// 每次点击都肉眼可见地闪一下终端；也不再有数百毫秒的运行时冷启动。
#[cfg(windows)]
#[tauri::command]
fn focus_dsh_gui(title: Option<String>) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOWNORMAL,
    };

    /// 只认常见浏览器的进程映像名（与旧 PowerShell 实现的名单一致），
    /// 避免把标题碰巧含 “deepseek” 的资源管理器/编辑器窗口误判为 DSH GUI。
    const BROWSERS: [&str; 6] = [
        "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe",
    ];
    unsafe fn process_image_name(pid: u32) -> String {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize]).to_lowercase()
    }
    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: isize) -> i32 {
        let matches = &mut *(lparam as *mut Vec<(isize, String)>);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let mut title = [0u16; 512];
        let len = GetWindowTextW(hwnd, title.as_mut_ptr(), 512);
        if len == 0 {
            return 1;
        }
        let title_lower = String::from_utf16_lossy(&title[..len as usize]).to_lowercase();
        if !title_lower.contains("deepseek") {
            return 1;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return 1;
        }
        let image = process_image_name(pid);
        if BROWSERS.iter().any(|b| image.ends_with(b)) {
            matches.push((hwnd as isize, title_lower));
        }
        1
    }
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe {
        let mut matches: Vec<(isize, String)> = Vec::new();
        EnumWindows(Some(enum_proc), &mut matches as *mut _ as isize);
        // 层叠匹配：优先「DeepSeek + 会话标题」都在标题里的窗口；没有则退回
        // 所有 DeepSeek 窗口（网页切会话不保证同步改标签标题）。
        let needle = title
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_lowercase);
        let targets: Vec<isize> = match &needle {
            Some(needle) => {
                let exact: Vec<isize> = matches
                    .iter()
                    .filter(|(_, t)| t.contains(needle))
                    .map(|(h, _)| *h)
                    .collect();
                if exact.is_empty() {
                    matches.iter().map(|(h, _)| *h).collect()
                } else {
                    exact
                }
            }
            None => matches.iter().map(|(h, _)| *h).collect(),
        };
        if targets.is_empty() {
            // 没有已认证的浏览器窗口：用默认浏览器打开 DSH GUI。
            // ShellExecuteW 由 shell 处理，不经子进程，无控制台闪现。
            let verb = wide("open");
            let url = wide("http://127.0.0.1:3080/");
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL as i32,
            );
            return Ok(());
        }
        for hwnd in targets {
            let hwnd = hwnd as HWND;
            // 仅最小化时还原：最大化中的浏览器保持最大化（旧实现无条件
            // SW_RESTORE 会把最大化浏览器打回小窗）。
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd);
        }
    }
    Ok(())
}

/// 非 Windows 平台的降级实现：无法枚举/聚焦窗口，退化为 Windows 实现的
/// 分支③——用默认浏览器打开 DSH GUI（持久 cookie 已认证，可直开）。
/// xdg-open 由桌面会话提供，spawn 失败（无桌面环境）时静默忽略。
#[cfg(not(windows))]
#[tauri::command]
fn focus_dsh_gui(_title: Option<String>) -> Result<(), String> {
    let _ = std::process::Command::new("xdg-open")
        .arg("http://127.0.0.1:3080/")
        .spawn();
    Ok(())
}

/// 日志目录：Windows 用 %USERPROFILE%，其余平台用 $HOME，都取不到时落当前目录。
fn log_dir() -> std::path::PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

/// 前端日志组件：把一行日志追加到 `dsh-pet.log`（Windows: `%USERPROFILE%`，
/// 其余平台: `$HOME`），便于事后排查桌宠 UI/动画问题（无 devtools 时）。
/// 调用方已 console.log。
#[tauri::command]
fn pet_log_append(line: String) -> Result<(), String> {
    let path = log_dir().join("dsh-pet.log");
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

            // 设置窗预展开到整个工作区（仍隐藏）。不能用 maximized 创建：
            // tao 创建期会先 SW_MAXIMIZE（窗口短暂可见）再 set_visible(false)，
            // 中间 webview 创建的消息泵会让这一帧上屏——启动瞬间全屏闪现
            // （用户录屏 GIF f-034 帧证实）。set_size/set_position 走
            // SetWindowPos，不显示窗口；webview 在隐藏期间完成全尺寸布局，
            // 打开设置即满屏满内容。窗口状态为「还原」而非「最大化」。
            if let Some(settings_window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
                let monitor = settings_window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .or_else(|| settings_window.primary_monitor().ok().flatten());
                if let Some(m) = monitor {
                    let wa = m.work_area();
                    let _ = settings_window.set_position(tauri::PhysicalPosition::new(
                        wa.position.x, wa.position.y,
                    ));
                    let _ = settings_window.set_size(tauri::PhysicalSize::new(
                        wa.size.width, wa.size.height,
                    ));
                }
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
