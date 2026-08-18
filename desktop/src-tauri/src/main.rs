// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Velopack 仅桌面平台编译；mobile target 不引入
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use velopack::VelopackApp;

fn main() {
    // Velopack 必须最先执行：处理 install/update/uninstall 钩子时会
    // fast-exit，不进入后续 Tauri 启动逻辑。dev 期无定位文件时为 no-op。
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    VelopackApp::build().run();

    dustnote_desktop_lib::run();
}
