#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

mod dsh_focus;

/// 设置窗口的标签（与前端 invoke 约定一致）。
const SETTINGS_WINDOW_LABEL: &str = "settings";
/// 活动托盘窗口的标签（独立窗口，不覆盖宠物窗口）。
const TRAY_WINDOW_LABEL: &str = "tray";
/// 托盘窗口与宠物窗口之间的间距（物理像素）。
const TRAY_GAP_PX: i32 = 4;
/// 设置窗显示后广播给前端的信号：前端收到才挂载设置 UI。
const SETTINGS_SHOWN_EVENT: &str = "settings-shown";
/// 设置窗隐藏（关闭被拦成 hide）后广播：前端收到即卸载设置 UI，把内存还回去。
const SETTINGS_HIDDEN_EVENT: &str = "settings-hidden";
/// 前端日志文件名与大小上限（超过即轮转，旧文件留一份 `.old`）。
const PET_LOG_FILE_NAME: &str = "dsh-pet.log";
const PET_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;

/// 打开设置窗口：显示并聚焦。
/// 窗口由 tauri.conf.json 声明（visible:false 启动隐藏），关闭时被拦截为
/// 隐藏而非销毁，因此此处始终能找到并重新显示。
///
/// 显示之后广播 `settings-shown`：设置窗前端**隐藏期间不挂载**整套设置 UI
/// （省下一个常驻的渲染进程/连接），靠这条信号在真正显示时才挂载。
#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) else {
        return Err("设置窗口不存在".into());
    };
    // 先广播再显示：前端收到即开始建 DOM，构建时间与 show 的往返重叠，
    // 缩短"窗口已上屏但内容还没建好"的空窗时间。
    let _ = window.emit(SETTINGS_SHOWN_EVENT, ());
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

/// 托盘打开会话后把承载 DSH GUI 的浏览器窗口/标签页带到前台。
///
/// 实现见 `dsh_focus`（纯逻辑与 Win32/UIA 分离，`examples/focus_probe.rs`
/// 复用同一份实现做端到端验证）。这里只是 Tauri 命令外壳：UIA 要跨进程读浏览器
/// 的标签页，浏览器忙时可能耗时数百毫秒，放工作线程里跑，别卡住 UI 线程。
#[tauri::command]
fn focus_dsh_gui(title: Option<String>) -> Result<(), String> {
    std::thread::spawn(move || {
        let _ = dsh_focus::focus_dsh_gui(title, true);
    });
    Ok(())
}

/// 把设置窗铺满当前显示器的工作区（**窗口仍隐藏时调用**）。
///
/// 不能用 `maximized` 创建：tao 创建期会先 SW_MAXIMIZE（窗口短暂可见）再
/// set_visible(false)，中间 webview 创建的消息泵会让这一帧上屏——启动瞬间全屏闪现
/// （用户录屏 GIF f-034 帧证实）。`set_size`/`set_position` 走 SetWindowPos，不显示
/// 窗口；webview 在隐藏期间完成全尺寸布局，打开设置即满屏满内容。窗口状态为
/// 「还原」而非「最大化」。
fn expand_settings_to_work_area(window: &tauri::WebviewWindow) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let wa = m.work_area();
        let _ = window.set_position(tauri::PhysicalPosition::new(wa.position.x, wa.position.y));
        let _ = window.set_size(tauri::PhysicalSize::new(wa.size.width, wa.size.height));
    }
}

/// 日志目录：Windows 用 %USERPROFILE%，其余平台用 $HOME，都取不到时落当前目录。
fn log_dir() -> std::path::PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

/// 前端日志的落盘句柄：**常驻打开**，不再每行 open/close（实测 2 小时 4.4 万行，
/// 每行一次 open+close 纯属浪费）；超过 `PET_LOG_MAX_BYTES` 先把旧文件改名
/// `dsh-pet.log.old`（只留一份）再重开，避免长期运行把日志写到几百 MB。
#[derive(Default)]
struct PetLog {
    file: Option<std::fs::File>,
    size: u64,
}

struct PetLogState(std::sync::Mutex<PetLog>);

impl PetLog {
    fn path() -> std::path::PathBuf {
        log_dir().join(PET_LOG_FILE_NAME)
    }

    fn open(&mut self) -> Result<(), String> {
        let path = Self::path();
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("无法打开日志文件 {}: {e}", path.display()))?;
        self.size = file.metadata().map(|m| m.len()).unwrap_or(0);
        self.file = Some(file);
        Ok(())
    }

    /// 追加一行；超限先轮转。
    fn append(&mut self, line: &str) -> Result<(), String> {
        use std::io::Write;
        if self.file.is_none() {
            self.open()?;
        }
        let mut bytes = Vec::with_capacity(line.len() + 1);
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
        if self.size + bytes.len() as u64 > PET_LOG_MAX_BYTES {
            self.rotate()?;
        }
        let file = self.file.as_mut().ok_or_else(|| "日志句柄未就绪".to_string())?;
        file.write_all(&bytes)
            .map_err(|e| format!("写日志失败: {e}"))?;
        self.size += bytes.len() as u64;
        Ok(())
    }

    /// 轮转：旧文件改名 `.old` 后重新打开（Windows 上句柄未释放时改名会失败，
    /// 所以先把 `self.file` 置空）。
    fn rotate(&mut self) -> Result<(), String> {
        self.file = None;
        let path = Self::path();
        let _ = std::fs::rename(&path, path.with_extension("log.old"));
        self.size = 0;
        self.open()
    }
}

/// 前端日志组件：把一行日志追加到 `dsh-pet.log`（Windows: `%USERPROFILE%`，
/// 其余平台: `$HOME`），便于事后排查桌宠 UI/动画问题（无 devtools 时）。
/// 调用方已 console.log。
#[tauri::command]
fn pet_log_append(state: tauri::State<'_, PetLogState>, line: String) -> Result<(), String> {
    let mut log = state.0.lock().map_err(|_| "日志句柄锁已中毒".to_string())?;
    log.append(&line)
}

fn main() {
    tauri::Builder::default()
        .manage(PetLogState(std::sync::Mutex::new(PetLog::default())))
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
            // 隐藏后广播 `settings-hidden`：前端据此卸载整套设置 UI（省 ~80MB）。
            if let Some(settings_window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
                let window = settings_window.clone();
                settings_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = window.emit(SETTINGS_HIDDEN_EVENT, ());
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

            // 设置窗预展开到整个工作区（仍隐藏），见 `expand_settings_to_work_area`。
            // 实测（2026-09-11）：把它推迟到首次打开再做**并不省内存**——隐藏窗口
            // 铺满工作区但内容为空时，渲染进程/GPU 与其小尺寸版本几乎无差；
            // 真正吃内存的是"隐藏窗口里挂着整套设置 UI"，已由前端懒挂载解决。
            if let Some(settings_window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
                expand_settings_to_work_area(&settings_window);
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
