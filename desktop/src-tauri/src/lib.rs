//! DustNote Desktop 入口库
//!
//! - 注册系统托盘（显示同步状态）
//! - 注册全局快捷键（Ctrl+Shift+M 唤起主窗口）
//! - 注册 autostart 启动项
//! - 启动时静默运行（如果传了 --silent）
//! - 应用内更新（检查走自建 manifest，下载 NSIS 包 + SHA-256 校验后启动向导）
//! - 与 Web 端共享前端 bundle

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::ShortcutState;

/// 系统托盘句柄（供 set_tray_tooltip 命令更新 tooltip，展示同步状态）
struct TrayState(Mutex<Option<TrayIcon>>);

// ============================================================================
// 应用内更新（v2.5.19 起，替代 Velopack）
//
// 策略：检查走自建服务器 /api/v1/update-manifest（web 层 useUpdateCheck 已接），
// 下载走 GitHub Releases 直链（releases/download 域走 CDN，不受 api.github.com
// 未认证 60 次/小时限流约束）。下载完成后校验 SHA-256（manifest 携带哈希，
// 供应链防护：文件被替换时拒绝执行），再启动 NSIS 安装向导由用户接管升级。
// ============================================================================

/// 允许的安装包下载地址前缀（白名单防 SSRF/任意 URL 下载）
const INSTALLER_URL_PREFIX: &str =
    "https://github.com/Hermitweb/dustnote/releases/download/";

/// 当前应用版本（tauri.conf.json 的 version 经 CARGO_PKG_VERSION 注入）
#[tauri::command]
fn app_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

/// 流式下载更新安装包到临时目录，校验 SHA-256 后启动 NSIS 安装向导。
/// 进度经 `updater://download-progress` 事件（0-100）推送给前端。
#[tauri::command]
async fn download_and_run_installer(
    app: tauri::AppHandle,
    url: String,
    expected_sha256: Option<String>,
) -> Result<String, String> {
    use std::io::Write;

    if !url.starts_with(INSTALLER_URL_PREFIX) {
        return Err("非法的下载地址".into());
    }

    let resp = reqwest::get(&url).await.map_err(|e| format!("下载失败：{}", e))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败：HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let tmp = std::env::temp_dir().join("DustNote-setup.exe");
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("写入临时文件失败：{}", e))?;
    let mut hasher = sha2::Sha256::new();
    let mut stream = resp;
    let mut received: u64 = 0;
    while let Some(chunk) = stream.chunk().await.map_err(|e| format!("下载中断：{}", e))? {
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| format!("写入临时文件失败：{}", e))?;
        received += chunk.len() as u64;
        if total > 0 {
            let pct = ((received as f64 / total as f64) * 100.0) as i16;
            let _ = app.emit("updater://download-progress", pct);
        }
    }
    file.flush().ok();
    drop(file);

    // SHA-256 校验：manifest 携带期望哈希（"sha256:<hex>"），不匹配即删除并拒绝
    if let Some(expected) = expected_sha256 {
        let expected_hex = expected
            .strip_prefix("sha256:")
            .unwrap_or(&expected)
            .to_lowercase();
        let actual_hex = format!("{:x}", hasher.finalize());
        if actual_hex != expected_hex {
            let _ = std::fs::remove_file(&tmp);
            return Err("安装包校验失败（SHA-256 不匹配），已取消更新".into());
        }
    }

    // 启动 NSIS 安装向导；当前应用保持运行，用户完成向导后手动重启生效
    std::process::Command::new(&tmp)
        .spawn()
        .map_err(|e| format!("启动安装程序失败：{}", e))?;

    Ok(tmp.to_string_lossy().to_string())
}

// ============================================================================
// 应用内更新（替代 Velopack）结束
// ============================================================================


// ============================================================================
// 既有命令
// ============================================================================

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

    // S83: 校验 filename，防止路径穿越
    let filename = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export.bin")
        .to_string();
    // S84: 限制导出文件大小
    if content.len() > 500 * 1024 * 1024 {
        return Err("file too large (max 500MB)".into());
    }

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

/// 更新系统托盘 tooltip（roadmap M4「托盘显示已同步 N 条」）。
/// 前端在待同步计数变化时调用；失败静默（不影响主流程）。
#[cfg(desktop)]
#[tauri::command]
fn set_tray_tooltip(app: tauri::AppHandle, tooltip: String) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(tray) = guard.as_ref() {
        tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    }
    Ok(())
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
        .setup(|app| {
            // 原生菜单栏
            let new_note_i = MenuItem::with_id(app, "file_new_note", "新建笔记", true, Some("CommandOrControl+N"))?;
            let file_quit_i = MenuItem::with_id(app, "file_quit", "退出 尘心笔记", true, Some("CommandOrControl+Q"))?;
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

            let zoom_in_i = MenuItem::with_id(app, "view_zoom_in", "放大", true, Some("CommandOrControl+="))?;
            let zoom_out_i = MenuItem::with_id(app, "view_zoom_out", "缩小", true, Some("CommandOrControl+-"))?;
            let zoom_reset_i = MenuItem::with_id(app, "view_zoom_reset", "重置缩放", true, Some("CommandOrControl+0"))?;
            let fullscreen_i = MenuItem::with_id(app, "view_toggle_fullscreen", "全屏", true, Some("F11"))?;
            let sidebar_i = MenuItem::with_id(app, "view_toggle_sidebar", "侧边栏", true, Some("CommandOrControl+B"))?;
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

            let tray = tray_builder.build(app)?;
            app.manage(TrayState(Mutex::new(Some(tray))));

            // 全局快捷键：Ctrl+Shift+M 唤起主窗口（仅桌面平台生效）
            // 若快捷键被其他程序占用，仅打印警告，不阻止启动
            #[cfg(desktop)]
            {
                let shortcut_result: Result<(), tauri_plugin_global_shortcut::Error> = (|| {
                    let builder = tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts(["CommandOrControl+Shift+M"])?
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
            show_main_window,
            save_file_dialog,
            set_tray_tooltip,
            app_version,
            download_and_run_installer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
