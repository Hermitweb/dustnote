//! DustNote Desktop 入口库
//!
//! - 注册系统托盘（显示同步状态）
//! - 注册全局快捷键（Ctrl+Shift+M 唤起主窗口）
//! - 注册 autostart 启动项
//! - 启动时静默运行（如果传了 --silent）
//! - Velopack 自动更新命令（检查/下载/应用）
//! - 与 Web 端共享前端 bundle

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::ShortcutState;

// ============================================================================
// Velopack 自动更新（仅桌面平台编译）
// ============================================================================

/// GitHub Releases 仓库地址（Velopack 从此读取更新源）
const GITHUB_REPO_URL: &str = "https://github.com/Hermitweb/dustnote";

/// 返回给前端的更新检查结果
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub update_available: bool,
    pub target_version: Option<String>,
    pub current_version: String,
    pub is_downgrade: bool,
}

/// 结构化错误（前端据此区分 dev 期 NotInstalled 等）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterError {
    pub kind: &'static str, // "NotInstalled" | "Network" | "Unknown"
    pub message: String,
}

// ---- 桌面平台：完整 Velopack 实现 ----

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod velopack_impl {
    use super::{UpdaterError, UpdateCheckResult, GITHUB_REPO_URL};
    use std::sync::mpsc;
    use tauri::{AppHandle, Emitter};
    use velopack::{sources::GithubSource, UpdateCheck, UpdateManager};

    /// GitHub API 端点 — 获取最新 release 信息
    const GITHUB_API_RELEASES: &str = "https://api.github.com/repos/Hermitweb/dustnote/releases/latest";

    /// 构造 UpdateManager（dev 期未安装时返回 NotInstalled 错误）
    fn build_manager() -> Result<UpdateManager, velopack::Error> {
        let source = GithubSource::new(GITHUB_REPO_URL, None, false);
        UpdateManager::new(source, None, None)
    }

    /// 把 velopack::Error 映射为前端可读的 UpdaterError
    fn map_err(e: velopack::Error) -> UpdaterError {
        let kind = match &e {
            velopack::Error::NotInstalled(_) => "NotInstalled",
            velopack::Error::Network(_) => "Network",
            _ => "Unknown",
        };
        UpdaterError {
            kind,
            message: e.to_string(),
        }
    }

    /// 自动检测本地代理（Clash 7890 / SOCKS 1080 / HTTP 8080）
    ///
    /// 部分用户网络环境无法直连 github.com（GFW / 企业防火墙等），
    /// 但本机可能运行了代理软件。此函数尝试 TCP 连接常见代理端口，
    /// 若可达则返回代理 URL。
    fn detect_local_proxy() -> Option<String> {
        // 优先尊重已设置的 env var
        if let Ok(proxy) = std::env::var("HTTPS_PROXY").or_else(|_| std::env::var("HTTP_PROXY")) {
            if !proxy.is_empty() {
                return Some(proxy);
            }
        }
        // 尝试常见本地代理端口（300ms 超时，最多 ~1s）
        for port in [7890, 1080, 8080] {
            let addr: std::net::SocketAddr = match format!("127.0.0.1:{}", port).parse() {
                Ok(a) => a,
                Err(_) => continue,
            };
            if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300))
                .is_ok()
            {
                return Some(format!("http://127.0.0.1:{}", port));
            }
        }
        None
    }

    /// 为 Velopack 内部的 reqwest 客户端设置代理 env var
    ///
    /// Velopack 的 download_updates / apply_updates 也会发起网络请求，
    /// 需要通过 env var 让其走代理。
    fn set_proxy_env(proxy: &str) {
        // SAFETY: env var 写入非线程安全，但此处仅在 spawn_blocking 线程内执行，
        // 且在 Velopack 构造 HTTP client 之前调用。Rust 1.85+ 要求 unsafe。
        unsafe {
            std::env::set_var("HTTPS_PROXY", proxy);
            std::env::set_var("HTTP_PROXY", proxy);
        }
    }

    /// 通过 GitHub API 检查最新 release 版本号
    ///
    /// 使用 reqwest blocking 客户端，支持代理 + 5s 超时。
    /// 相比 Velopack 内置的 check_for_updates，此方法可显式配置代理，
    /// 避免在无代理环境下长时间卡住。
    fn fetch_latest_version(proxy: Option<&str>) -> Result<String, UpdaterError> {
        let mut builder = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .user_agent("DustNote-Updater");

        if let Some(p) = proxy {
            builder = builder
                .proxy(reqwest::Proxy::all(p).map_err(|e| UpdaterError {
                    kind: "Network",
                    message: format!("代理配置错误: {}", e),
                })?);
        }

        let client = builder.build().map_err(|e| UpdaterError {
            kind: "Network",
            message: format!("HTTP 客户端初始化失败: {}", e),
        })?;

        let resp = client
            .get(GITHUB_API_RELEASES)
            .send()
            .map_err(|e| UpdaterError {
                kind: "Network",
                message: format!("无法连接 GitHub: {}", e),
            })?;

        if !resp.status().is_success() {
            return Err(UpdaterError {
                kind: "Network",
                message: format!("GitHub API 返回错误: HTTP {}", resp.status()),
            });
        }

        let json: serde_json::Value = resp.json().map_err(|e| UpdaterError {
            kind: "Network",
            message: format!("解析 GitHub 响应失败: {}", e),
        })?;

        let tag = json["tag_name"].as_str().ok_or_else(|| UpdaterError {
            kind: "Network",
            message: "GitHub 响应中缺少 tag_name".into(),
        })?;

        // "v2.4.1" → "2.4.1"
        Ok(tag.strip_prefix('v').unwrap_or(tag).to_string())
    }

    /// 简单语义版本比较：latest > current 时返回 true
    fn is_newer_version(latest: &str, current: &str) -> bool {
        let parse = |s: &str| -> Vec<u32> {
            s.split('.').filter_map(|p| p.parse().ok()).collect()
        };
        let l = parse(latest);
        let c = parse(current);
        for i in 0..l.len().max(c.len()) {
            let lv = *l.get(i).unwrap_or(&0);
            let cv = *c.get(i).unwrap_or(&0);
            if lv > cv {
                return true;
            }
            if lv < cv {
                return false;
            }
        }
        false
    }

    /// 检查是否有可用更新（不下载）
    ///
    /// 实现策略：
    /// 1. 自动检测本地代理（Clash 7890 等），设置 HTTPS_PROXY env var
    /// 2. 使用 reqwest 直接查询 GitHub API（5s 超时 + 代理支持）
    /// 3. 与 Velopack 当前版本比较
    /// 4. 外层 8s tokio 超时兜底
    ///
    /// 相比原来的 Velopack check_for_updates，此方案：
    /// - 支持代理自动检测（解决 GFW 环境下直连超时问题）
    /// - 超时时间更可控（reqwest 5s + tokio 8s 双保险）
    /// - 错误信息更精确（区分代理/连接/API 错误）
    #[tauri::command]
    pub async fn vp_check_for_updates() -> Result<UpdateCheckResult, UpdaterError> {
        let timeout_dur = tokio::time::Duration::from_secs(8);
        let inner = tokio::time::timeout(timeout_dur, async {
            tokio::task::spawn_blocking(move || {
                // 1. 检测代理并设置 env var（Velopack download 也会用到）
                let proxy = detect_local_proxy();
                if let Some(ref p) = proxy {
                    set_proxy_env(p);
                }

                // 2. 获取当前版本（dev 期未安装时返回 NotInstalled）
                let mgr = build_manager().map_err(map_err)?;
                let current = mgr.get_current_version_as_string();

                // 3. 通过 GitHub API 查询最新版本
                let latest = fetch_latest_version(proxy.as_deref())?;

                // 4. 比较版本
                let update_available = is_newer_version(&latest, &current);

                Ok(UpdateCheckResult {
                    update_available,
                    target_version: if update_available {
                        Some(latest)
                    } else {
                        None
                    },
                    current_version: current,
                    is_downgrade: false,
                })
            })
            .await
            .map_err(|e| UpdaterError {
                kind: "Unknown",
                message: format!("update check task failed: {}", e),
            })?
        })
        .await;
        match inner {
            Ok(result) => result,
            Err(_) => Err(UpdaterError {
                kind: "Network",
                message: "检查更新超时，请检查网络或代理设置".into(),
            }),
        }
    }

    /// 下载更新；进度通过 event `vp://download-progress` 推送
    #[tauri::command]
    pub fn vp_download_updates(app: AppHandle) -> Result<bool, UpdaterError> {
        // 确保 Velopack 内部 HTTP 客户端走代理（与 check 阶段一致）
        let proxy = detect_local_proxy();
        if let Some(ref p) = proxy {
            set_proxy_env(p);
        }

        let mgr = build_manager().map_err(map_err)?;
        let check = mgr.check_for_updates().map_err(map_err)?;
        let info = match check {
            UpdateCheck::UpdateAvailable(info) => *info, // dereference Box<UpdateInfo>
            _ => return Ok(false),                       // 没有更新可下载
        };

        // 进度转发：channel → Tauri event
        let (tx, rx) = mpsc::channel::<i16>();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            while let Ok(pct) = rx.recv() {
                let _ = app_clone.emit("vp://download-progress", pct);
            }
        });

        let updates = &info;
        mgr.download_updates(updates, Some(tx)).map_err(map_err)?;
        Ok(true)
    }

    /// 应用已下载的更新并立即重启
    #[tauri::command]
    pub fn vp_apply_and_restart() -> Result<(), UpdaterError> {
        let mgr = build_manager().map_err(map_err)?;
        if let Some(pending) = mgr.get_update_pending_restart() {
            mgr.apply_updates_and_restart(&pending).map_err(map_err)?;
            Ok(())
        } else {
            Err(UpdaterError {
                kind: "Unknown",
                message: "No pending update to apply".into(),
            })
        }
    }

    /// 查询是否有已下载待应用的更新
    #[tauri::command]
    pub fn vp_get_pending_update() -> Result<Option<String>, UpdaterError> {
        let mgr = build_manager().map_err(map_err)?;
        Ok(mgr.get_update_pending_restart().map(|a| a.Version))
    }

    /// 返回当前应用版本
    #[tauri::command]
    pub fn vp_current_version() -> Result<String, UpdaterError> {
        let mgr = build_manager().map_err(map_err)?;
        Ok(mgr.get_current_version_as_string())
    }
}

// ---- Mobile 平台：占位 stub（不引入 velopack crate） ----

#[cfg(any(target_os = "android", target_os = "ios"))]
mod velopack_impl {
    use super::UpdaterError;

    const NOT_SUPPORTED: UpdaterError = UpdaterError {
        kind: "Unknown",
        message: "Velopack not supported on mobile",
    };

    #[tauri::command]
    pub fn vp_check_for_updates() -> Result<serde_json::Value, UpdaterError> {
        Err(NOT_SUPPORTED)
    }
    #[tauri::command]
    pub fn vp_download_updates() -> Result<bool, UpdaterError> {
        Err(NOT_SUPPORTED)
    }
    #[tauri::command]
    pub fn vp_apply_and_restart() -> Result<(), UpdaterError> {
        Err(NOT_SUPPORTED)
    }
    #[tauri::command]
    pub fn vp_get_pending_update() -> Result<Option<String>, UpdaterError> {
        Err(NOT_SUPPORTED)
    }
    #[tauri::command]
    pub fn vp_current_version() -> Result<String, UpdaterError> {
        Err(NOT_SUPPORTED)
    }
}

use velopack_impl::{
    vp_apply_and_restart, vp_check_for_updates, vp_current_version, vp_download_updates,
    vp_get_pending_update,
};

// ============================================================================
// 既有命令
// ============================================================================

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to DustNote 🌿", name)
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// 弹出原生保存对话框，将内容写入用户选择的路径
///
/// 供前端导出备份/批量导出使用：避免 fs 插件 scope 配置的复杂性，
/// 直接在 Rust 侧完成「对话框 + 写文件」全流程。
///
/// 返回值：
/// - `Some(path)` — 用户选择了路径并写入成功
/// - `None` — 用户取消了保存对话框
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
async fn save_file_dialog(
    app: tauri::AppHandle,
    filename: String,
    content: Vec<u8>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let path = app_clone
            .dialog()
            .file()
            .add_filter("DustNote", &["json", "zip", "md", "html"])
            .set_file_name(&filename)
            .blocking_save_file();

        match path {
            Some(file_path) => {
                // FilePath → PathBuf：dialog 插件返回 FilePath 枚举（Path 或 Url 变体），
                // 需调用 into_path() 转换为 PathBuf 才能传给 std::fs::write
                let path = file_path.into_path().map_err(|e| e.to_string())?;
                let path_str = path.to_string_lossy().into_owned();
                std::fs::write(&path, &content).map_err(|e| e.to_string())?;
                Ok(Some(path_str))
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| format!("save dialog task failed: {}", e))?
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
async fn save_file_dialog(
    _app: tauri::AppHandle,
    _filename: String,
    _content: Vec<u8>,
) -> Result<Option<String>, String> {
    Err("save dialog not supported on mobile".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 单实例运行（仅桌面平台）：第二个实例启动时唤起并聚焦已有窗口
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.show();
                let _ = w.set_focus();
            });
        }));
    }

    builder
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--silent"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 原生菜单栏
            let new_note_i = MenuItem::with_id(app, "file_new_note", "新建笔记", true, Some("Ctrl+N"))?;
            let file_quit_i = MenuItem::with_id(app, "file_quit", "退出 尘心笔记", true, Some("Ctrl+Q"))?;
            let file_menu = Submenu::with_items(app, "文件", true, &[&new_note_i, &file_quit_i])?;

            let undo_i = PredefinedMenuItem::undo(app, Some("撤销"))?;
            let redo_i = PredefinedMenuItem::redo(app, Some("重做"))?;
            let cut_i = PredefinedMenuItem::cut(app, Some("剪切"))?;
            let copy_i = PredefinedMenuItem::copy(app, Some("复制"))?;
            let paste_i = PredefinedMenuItem::paste(app, Some("粘贴"))?;
            let select_all_i = PredefinedMenuItem::select_all(app, Some("全选"))?;
            let edit_menu = Submenu::with_items(app, "编辑", true, &[
                &undo_i, &redo_i, &cut_i, &copy_i, &paste_i, &select_all_i
            ])?;

            let zoom_in_i = MenuItem::with_id(app, "view_zoom_in", "放大", true, Some("Ctrl+="))?;
            let zoom_out_i = MenuItem::with_id(app, "view_zoom_out", "缩小", true, Some("Ctrl+-"))?;
            let zoom_reset_i = MenuItem::with_id(app, "view_zoom_reset", "重置缩放", true, Some("Ctrl+0"))?;
            let fullscreen_i = MenuItem::with_id(app, "view_toggle_fullscreen", "全屏", true, Some("F11"))?;
            let sidebar_i = MenuItem::with_id(app, "view_toggle_sidebar", "侧边栏", true, Some("Ctrl+B"))?;
            let view_menu = Submenu::with_items(app, "视图", true, &[
                &zoom_in_i, &zoom_out_i, &zoom_reset_i, &fullscreen_i, &sidebar_i
            ])?;

            let about_i = MenuItem::with_id(app, "help_about", "关于 尘心笔记", true, None::<&str>)?;
            let check_update_i = MenuItem::with_id(app, "help_check_update", "检查更新", true, None::<&str>)?;
            let help_menu = Submenu::with_items(app, "帮助", true, &[&about_i, &check_update_i])?;

            let main_menu = Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &help_menu])?;
            app.set_menu(main_menu)?;

            // 禁用 webview 右键菜单：三重防御
            //   1. Rust eval 注入 document 级 contextmenu preventDefault（此处，SPA 永久生效）
            //   2. 前端 web/src/main.tsx 的 window 级 capture 监听
            //   3. 前端 web/src/main.tsx 的 document 级 capture 监听
            // 但在可编辑元素中保留右键菜单（剪切/复制/粘贴/全选），
            // 否则用户无法在输入框/文本域中使用右键编辑功能。
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval(
                    "document.addEventListener('contextmenu', e => {\
                        const t = e.target;\
                        if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;\
                        e.preventDefault();\
                    });"
                );
                // 防截屏：窗口内容设为 content_protected 后，系统截图、录屏、Recent Apps 预览将得到黑屏
                // macOS: NSWindow.sharingType = NSWindowSharingNone
                // Windows: SetWindowDisplayAffinity(WDA_MONITOR)
                // Linux: 取决于窗口管理器支持
                // Tauri 2.11 方法名为 set_content_protected（早期文档/示例误写 set_protected）
                // 失败时仅日志告警，不阻塞启动（部分 Linux WM 不支持）
                if let Err(e) = w.set_content_protected(true) {
                    eprintln!("[DustNote] 防截屏 set_content_protected 失败: {e}");
                }
            }

            // 系统托盘
            let quit_i = MenuItem::with_id(app, "quit", "退出 尘心笔记", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            // 系统托盘：default_window_icon 在极少数情况下可能为 None
            //（如配置缺失或资源加载失败），用 unwrap() 会导致启动 panic。
            // 若图标存在则设置到托盘，否则仅打印警告，托盘仍可使用（显示系统默认图标）。
            let mut tray_builder = TrayIconBuilder::with_id("main")
                .tooltip("尘心笔记")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            } else {
                eprintln!("[DustNote] 警告：default_window_icon 为空，托盘将使用系统默认图标");
            }

            let _tray = tray_builder.build(app)?;

            // 全局快捷键：Ctrl+Shift+M 唤起主窗口（仅桌面平台生效）
            // 若快捷键被其他程序占用，仅打印警告，不阻止启动
            #[cfg(desktop)]
            {
                let shortcut_result: Result<(), tauri_plugin_global_shortcut::Error> = (|| {
                    let builder = tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts(["Ctrl+Shift+M"])?
                        .with_handler(|app, _shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        });
                    app.handle().plugin(builder.build())?;
                    Ok(())
                })();
                if let Err(e) = shortcut_result {
                    eprintln!("[DustNote] 全局快捷键注册失败（可能被其他程序占用）: {e}");
                }
            }

            // 静默启动
            let args: Vec<String> = std::env::args().collect();
            if args.contains(&"--silent".to_string()) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮最小化到托盘
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "file_new_note" => {
                let _ = app.emit("menu://action", "file_new_note");
            }
            "file_quit" => {
                app.exit(0);
            }
            "view_zoom_in" => {
                let _ = app.emit("menu://action", "view_zoom_in");
            }
            "view_zoom_out" => {
                let _ = app.emit("menu://action", "view_zoom_out");
            }
            "view_zoom_reset" => {
                let _ = app.emit("menu://action", "view_zoom_reset");
            }
            "view_toggle_fullscreen" => {
                if let Some(w) = app.get_webview_window("main") {
                    let is_fs = w.is_fullscreen().unwrap_or(false);
                    let _ = w.set_fullscreen(!is_fs);
                }
            }
            "view_toggle_sidebar" => {
                let _ = app.emit("menu://action", "view_toggle_sidebar");
            }
            "help_about" => {
                let _ = app.emit("menu://action", "help_about");
            }
            "help_check_update" => {
                let _ = app.emit("menu://action", "help_check_update");
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            show_main_window,
            save_file_dialog,
            vp_check_for_updates,
            vp_download_updates,
            vp_apply_and_restart,
            vp_get_pending_update,
            vp_current_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
