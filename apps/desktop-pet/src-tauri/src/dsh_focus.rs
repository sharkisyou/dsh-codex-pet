//! 托盘打开会话后，把承载 DSH GUI 的浏览器窗口/标签页带到前台。
//!
//! DSH GUI 的页面标题形如 `<会话标题> — DeepSeek Harness`（见 dsh-client-ui-layout
//! 的 DocumentTitle）；而**窗口标题只反映当前活动标签页的标题**。于是“窗口标题里
//! 没有产品名”既可能是“没开 GUI”，也可能只是“GUI 在后台标签页”。
//!
//! 2026-09-11 用户实测的坑：只按“窗口标题含 deepseek”匹配，会把用户另外打开的
//! DeepSeek 官网/搜索页标签误判成 GUI——点托盘只会把浏览器窗口置前，不会切回
//! GUI 标签页（正是用户报的“浏览器到前台了，但显示的还是其他网页”）。
//!
//! 现在的分层做法（`focus_dsh_gui`）：
//! ① 窗口标题同时含产品名与会话标题（目标会话就在活动标签页上）→ 置前，不动 UIA；
//! ② 否则用 UI Automation 读浏览器标签页，选中含产品名（且优先含会话标题）的那个
//!    —— 这才是真正“切到 DSH 页面”；
//! ③ UIA 不可用（非 Chromium 等）但有窗口的活动标签页是 GUI → 退回置前该窗口；
//! ④ 都没有产品名 → 按会话标题找窗口置前；
//! ⑤ 浏览器里根本没有 GUI → 用默认浏览器打开 GUI 地址。
//!
//! 纯逻辑（`pick_*`）与平台实现分离：纯逻辑在任意平台可测，Win32/UIA 部分仅
//! Windows 编译；`examples/focus_probe.rs` 复用本模块做端到端验证（Windows 端到端
//! 验证环见 `.scratch/desktop-pet-tests/focus-dsh-gui/`）。

/// DSH GUI 页面标题里的产品名标记（小写比较）。窗口标题或标签页名含它，
/// 基本可以断定那是 GUI 页面——用户的其它 DeepSeek 页面（官网/搜索）不含它。
pub const DSH_MARKER: &str = "deepseek harness";

/// 托盘条目的会话标题 → 匹配用小写针（空白/空串视为没有）。
pub fn normalize_needle(title: Option<&str>) -> Option<String> {
    title
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase)
}

/// 一次聚焦尝试的结果（probe/排障用；生产路径只关心副作用）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusOutcome {
    /// 切换到了 DSH GUI 标签页（UIA）。
    ActivatedTab { hwnd: isize, tab: String },
    /// 只置前了候选窗口（活动标签页本来就是 GUI，或只能做到这些）。
    RaisedWindow { hwnd: isize },
    /// 没有候选窗口，改为用默认浏览器打开 GUI 地址。
    OpenedUrl,
    /// 没有候选窗口，且调用方禁止打开新页面。
    Missed,
}

fn marked_indices(titles: &[String]) -> Vec<usize> {
    (0..titles.len())
        .filter(|&i| titles[i].contains(DSH_MARKER))
        .collect()
}

fn prefer_needle(indices: &[usize], titles: &[String], needle: Option<&str>) -> Vec<usize> {
    if let Some(needle) = needle {
        let exact: Vec<usize> = indices
            .iter()
            .copied()
            .filter(|&i| titles[i].contains(needle))
            .collect();
        if !exact.is_empty() {
            return exact;
        }
    }
    indices.to_vec()
}

/// 纯逻辑：**目标会话**已经在活动标签页上的窗口下标（窗口标题同时含产品名与
/// 会话标题）。没有会话标题时退化为“活动标签页是任意会话的 GUI”。
pub fn pick_exact_gui_windows(titles: &[String], needle: Option<&str>) -> Vec<usize> {
    let marked = marked_indices(titles);
    match needle {
        Some(needle) => marked
            .into_iter()
            .filter(|&i| titles[i].contains(needle))
            .collect(),
        None => marked,
    }
}

/// 纯逻辑：活动标签页是 GUI（任意会话）的窗口下标；多个时优先含会话标题的那个。
pub fn pick_active_gui_windows(titles: &[String], needle: Option<&str>) -> Vec<usize> {
    prefer_needle(&marked_indices(titles), titles, needle)
}

/// 纯逻辑：挑 DSH GUI 标签页，返回它在 `tabs` 里的下标。
/// 标签页**必须**含产品名标记；有会话标题时优先匹配它（多窗口多 GUI 标签页时消歧）。
pub fn pick_dsh_tab(tabs: &[String], needle: Option<&str>) -> Option<usize> {
    let marked = marked_indices(tabs);
    if marked.is_empty() {
        return None;
    }
    prefer_needle(&marked, tabs, needle).first().copied()
}

/// 纯逻辑：兜底——标题里出现会话标题的窗口（UIA 不可用且 GUI 在后台标签页时）。
/// 只在拿到会话标题时才有候选；没有任何窗口标题能匹配时返回空。
pub fn pick_windows_by_needle(titles: &[String], needle: Option<&str>) -> Vec<usize> {
    let Some(needle) = needle else {
        return Vec::new();
    };
    (0..titles.len())
        .filter(|&i| titles[i].contains(needle))
        .collect()
}

#[cfg(windows)]
mod win {
    use super::{
        normalize_needle, pick_active_gui_windows, pick_dsh_tab, pick_exact_gui_windows,
        pick_windows_by_needle, FocusOutcome,
    };
    use windows_sys::Win32::Foundation::{CloseHandle, HWND};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOWNORMAL,
    };

    /// 只认常见浏览器的进程映像名，避免把标题碰巧含产品名的编辑器/资源管理器
    /// 窗口误判为 DSH GUI。
    const BROWSERS: [&str; 6] = [
        "chrome.exe",
        "msedge.exe",
        "firefox.exe",
        "brave.exe",
        "opera.exe",
        "vivaldi.exe",
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

    /// 枚举可见的浏览器顶层窗口 → (hwnd, 小写标题)。
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

    fn browser_windows() -> Vec<(isize, String)> {
        let mut windows: Vec<(isize, String)> = Vec::new();
        unsafe {
            EnumWindows(Some(enum_proc), &mut windows as *mut _ as isize);
        }
        windows
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 还原（仅最小化时）并置前。
    fn raise_window(hwnd: isize) {
        unsafe {
            // 仅最小化时还原：最大化中的浏览器保持最大化（旧实现无条件
            // SW_RESTORE 会把最大化浏览器打回小窗）。
            if IsIconic(hwnd as HWND) != 0 {
                ShowWindow(hwnd as HWND, SW_RESTORE);
            }
            SetForegroundWindow(hwnd as HWND);
        }
    }

    fn open_gui_url() {
        unsafe {
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
        }
    }

    /// 用 UI Automation 读出各浏览器窗口的标签页，选中 DSH GUI 标签页并置前该窗口。
    ///
    /// 只有“活动标签页不是 GUI”时才会走到这里。UIA 需要跨进程访问浏览器的辅助
    /// 功能树，Chromium 首次应答可能花上几百毫秒；调用方应在工作线程里跑。
    /// 失败（非 Chromium、辅助功能不可用）返回 None，由调用方兜底。
    fn activate_dsh_tab(windows: &[(isize, String)], needle: Option<&str>) -> Option<(isize, String)> {
        use windows::Win32::Foundation::HWND as UiaHwnd;
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::System::Variant::VARIANT;
        use windows::Win32::UI::Accessibility::{
            CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationSelectionItemPattern,
            TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_SelectionItemPatternId,
            UIA_TabItemControlTypeId,
        };

        struct Tab {
            hwnd: isize,
            name: String,
            element: IUIAutomationElement,
        }

        /// 收集 + 选中；COM 初始化/反初始化由外层配对负责。
        unsafe fn scan_and_select(
            windows: &[(isize, String)],
            needle: Option<&str>,
        ) -> Option<(isize, String)> {
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let condition = uia
                .CreatePropertyCondition(
                    UIA_ControlTypePropertyId,
                    &VARIANT::from(UIA_TabItemControlTypeId.0),
                )
                .ok()?;

            let mut tabs: Vec<Tab> = Vec::new();
            for (hwnd, _) in windows {
                let Ok(root) = uia.ElementFromHandle(UiaHwnd(*hwnd as *mut core::ffi::c_void)) else {
                    continue;
                };
                let Ok(array) = root.FindAll(TreeScope_Descendants, &condition) else {
                    continue;
                };
                let Ok(count) = array.Length() else { continue };
                for index in 0..count {
                    let Ok(element) = array.GetElement(index) else { continue };
                    let Ok(name) = element.CurrentName() else { continue };
                    tabs.push(Tab {
                        hwnd: *hwnd,
                        name: name.to_string().to_lowercase(),
                        element,
                    });
                }
            }

            let names: Vec<String> = tabs.iter().map(|tab| tab.name.clone()).collect();
            let index = pick_dsh_tab(&names, needle)?;
            let tab = &tabs[index];
            let pattern: IUIAutomationSelectionItemPattern = tab
                .element
                .GetCurrentPatternAs(UIA_SelectionItemPatternId)
                .ok()?;
            pattern.Select().ok()?;
            raise_window(tab.hwnd);
            Some((tab.hwnd, tab.name.clone()))
        }

        // 工作线程通常是全新线程：这里自己初始化 COM 公寓；已在同一模型上初始化过
        // （S_FALSE）也要配对 CoUninitialize，换了模型（RPC_E_CHANGED_MODE）则不动它。
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        let outcome = unsafe { scan_and_select(windows, needle) };
        if hr.is_ok() {
            unsafe { CoUninitialize() };
        }
        outcome
    }

    /// 排障用：列出候选窗口（“hwnd=… title=…”）。生产代码不用，probe 用。
    #[allow(dead_code)]
    pub fn describe_windows() -> Vec<String> {
        browser_windows()
            .into_iter()
            .map(|(hwnd, title)| format!("hwnd={hwnd} title={title}"))
            .collect()
    }

    /// 排障用：当前前台窗口句柄。生产代码不用，probe 用。
    #[allow(dead_code)]
    pub fn foreground_window() -> isize {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        unsafe { GetForegroundWindow() as isize }
    }

    pub fn focus_dsh_gui(title: Option<String>, open_url_on_miss: bool) -> FocusOutcome {
        let needle = normalize_needle(title.as_deref());
        let windows = browser_windows();
        let titles: Vec<String> = windows.iter().map(|(_, t)| t.clone()).collect();

        let raise_all = |indices: &[usize]| -> isize {
            let first = windows[indices[0]].0;
            for &idx in indices {
                raise_window(windows[idx].0);
            }
            first
        };

        // ① 目标会话就在活动标签页上（窗口标题同时含产品名与会话标题）→ 置前即可。
        let exact = pick_exact_gui_windows(&titles, needle.as_deref());
        if !exact.is_empty() {
            return FocusOutcome::RaisedWindow { hwnd: raise_all(&exact) };
        }

        // ② 目标会话的 GUI 在后台标签页（或开在另一个窗口里）→ UIA 选中它，
        //    这才是用户说的“切到 DSH 页面”。
        if let Some((hwnd, tab)) = activate_dsh_tab(&windows, needle.as_deref()) {
            return FocusOutcome::ActivatedTab { hwnd, tab };
        }

        // ③ UIA 拿不到标签页（非 Chromium 等），但有窗口的活动标签页就是某个
        //    会话的 GUI → 退回旧行为：置前该窗口。
        let marked = pick_active_gui_windows(&titles, None);
        if !marked.is_empty() {
            return FocusOutcome::RaisedWindow { hwnd: raise_all(&marked) };
        }

        // ④ 连产品名都没有：按会话标题找窗口（会话标题只出现在 GUI 标签页名里）。
        let fallback = pick_windows_by_needle(&titles, needle.as_deref());
        if !fallback.is_empty() {
            return FocusOutcome::RaisedWindow { hwnd: raise_all(&fallback) };
        }

        // ⑤ 浏览器里根本没有 GUI 页面：用默认浏览器打开它。
        if open_url_on_miss {
            open_gui_url();
            return FocusOutcome::OpenedUrl;
        }
        FocusOutcome::Missed
    }
}

/// 排障用：列出候选浏览器窗口（仅 Windows 有实现；生产 bin 用不到，probe 用）。
#[cfg(windows)]
#[allow(unused_imports)]
pub use win::describe_windows;
/// 排障用：当前前台窗口句柄（仅 Windows 有实现；生产 bin 用不到，probe 用）。
#[cfg(windows)]
#[allow(unused_imports)]
pub use win::foreground_window;
#[cfg(windows)]
pub use win::focus_dsh_gui;

/// 非 Windows 平台没有可枚举的候选窗口。
#[cfg(not(windows))]
pub fn describe_windows() -> Vec<String> {
    Vec::new()
}

/// 非 Windows 平台没有前台窗口概念。
#[cfg(not(windows))]
pub fn foreground_window() -> isize {
    0
}

/// 非 Windows 平台的降级实现：无法枚举/聚焦窗口，退化为用默认浏览器打开
/// DSH GUI（持久 cookie 已认证，可直开）。xdg-open 由桌面会话提供，
/// spawn 失败（无桌面环境）时静默忽略。
#[cfg(not(windows))]
pub fn focus_dsh_gui(_title: Option<String>, open_url_on_miss: bool) -> FocusOutcome {
    if !open_url_on_miss {
        return FocusOutcome::Missed;
    }
    let _ = std::process::Command::new("xdg-open")
        .arg("http://127.0.0.1:3080/")
        .spawn();
    FocusOutcome::OpenedUrl
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn needle_is_normalized() {
        assert_eq!(normalize_needle(Some("  A B ")), Some("a b".into()));
        assert_eq!(normalize_needle(Some("   ")), None);
        assert_eq!(normalize_needle(None), None);
    }

    /// 回归：用户的“DeepSeek 官网/搜索”标签页标题也含 deepseek，但窗口标题里
    /// 没有产品名，不能被当成 GUI 窗口（这正是 bug 的根源）。
    #[test]
    fn deepseek_website_window_is_not_a_gui_window() {
        let titles = v(&[
            "deepseek | 深度求索 - google chrome",
            "some session — deepseek harness - google chrome",
        ]);
        assert_eq!(pick_active_gui_windows(&titles, Some("some session")), vec![1]);
        assert_eq!(pick_active_gui_windows(&titles, None), vec![1]);
        assert!(pick_windows_by_needle(&titles, Some("probe-7")).is_empty());
    }

    #[test]
    fn tab_requires_product_marker() {
        let tabs = v(&[
            "deepseek | 深度求索 - 内存节省 - 63.9 mb",
            "deepseek 开放平台",
            "example domain",
        ]);
        assert_eq!(pick_dsh_tab(&tabs, None), None);
        assert_eq!(pick_dsh_tab(&tabs, Some("深度求索")), None);
    }

    #[test]
    fn tab_prefers_session_title() {
        let tabs = v(&[
            "会话 a — deepseek harness - 内存节省 - 27.0 mb",
            "会话 b — deepseek harness",
            "deepseek | 深度求索",
        ]);
        assert_eq!(pick_dsh_tab(&tabs, Some("会话 b")), Some(1));
        assert_eq!(pick_dsh_tab(&tabs, Some("会话 a")), Some(0));
        // 会话标题对不上时退回第一个 GUI 标签页
        assert_eq!(pick_dsh_tab(&tabs, Some("会话 z")), Some(0));
        assert_eq!(pick_dsh_tab(&tabs, None), Some(0));
    }
}
