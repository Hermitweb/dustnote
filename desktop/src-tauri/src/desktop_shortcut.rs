//! 桌面快捷方式中文名（Windows）
//!
//! NSIS 安装器以 productName（DustNote）命名桌面快捷方式，不随系统语言变化。
//! 中文系统上应用启动时把 `<product>.lnk` 文件级重命名为「尘渊笔记.lnk」
//! （.lnk 只是普通文件，重命名保留图标与目标，快捷方式立即生效）。
//! 卸载侧由 installer-hooks.nsh（NSIS_HOOK_POSTUNINSTALL）补删中文名，
//! 避免卸载残留。
//!
//! 为什么放在应用启动而不是安装钩子：NSIS 模板在 GUI 安装下，桌面快捷方式
//! 由**完成页**勾选项创建（MUI_FINISHPAGE_SHOWREADME_FUNCTION），晚于
//! NSIS_HOOK_POSTINSTALL——纯安装钩子覆盖不了 GUI 路径；静默/被动安装
//! （Section 内创建）与本方案兼容：重命名逻辑幂等。
//!
//! 只做一次判定、不与用户打架：中文快捷方式已存在（处理过）或英文快捷方式
//! 不存在（用户已手动改名/重命名/删除）→ 原样不动。

pub fn maybe_rename_desktop_shortcut(app: &tauri::AppHandle) {
    // 仅中文系统（含简/繁、zh_* 全系）
    let zh = tauri_plugin_os::locale()
        .map(|l| l.to_ascii_lowercase().starts_with("zh"))
        .unwrap_or(false);
    if !zh {
        return;
    }

    let Some(product) = app.config().product_name.clone() else {
        return;
    };
    let Some(desktop) = dirs::desktop_dir() else {
        return;
    };

    let english = desktop.join(format!("{product}.lnk"));
    let chinese = desktop.join("尘渊笔记.lnk");
    if chinese.exists() || !english.exists() {
        return;
    }
    if let Err(e) = std::fs::rename(&english, &chinese) {
        // 失败只告警（快捷方式被占用/权限问题），不阻塞启动
        eprintln!("[DustNote] 桌面快捷方式重命名失败: {e}");
    }
}
