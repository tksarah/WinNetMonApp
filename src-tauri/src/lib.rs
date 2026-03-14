mod diagnostics;
mod windows_proxy;

use tauri::{Manager, PhysicalPosition};
use diagnostics::{DiagnosticsReport, SiteInput};

#[tauri::command]
async fn run_diagnostics(sites: Vec<SiteInput>) -> DiagnosticsReport {
    let proxy = windows_proxy::get_proxy_info();

    diagnostics::run(sites, proxy).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 起動位置: 画面の「中央の上の方」へ寄せる
            if let Some(window) = app.get_webview_window("main") {
                // 取得に失敗してもアプリ自体は起動できるので、ここではエラーを握りつぶす
                if let Ok(Some(monitor)) = window.current_monitor() {
                    if let (Ok(window_size), monitor_size) = (window.outer_size(), monitor.size()) {
                        let x = ((monitor_size.width.saturating_sub(window_size.width)) / 2) as i32;

                        // 上から少し余白（8%）。極端にならないよう最小/最大を設ける。
                        let mut y = ((monitor_size.height as f64) * 0.08) as i32;
                        y = y.clamp(40, 180);

                        let _ = window.set_position(PhysicalPosition::new(x, y));
                    }
                } else if let Ok(Some(monitor)) = window.primary_monitor() {
                    if let (Ok(window_size), monitor_size) = (window.outer_size(), monitor.size()) {
                        let x = ((monitor_size.width.saturating_sub(window_size.width)) / 2) as i32;
                        let mut y = ((monitor_size.height as f64) * 0.08) as i32;
                        y = y.clamp(40, 180);
                        let _ = window.set_position(PhysicalPosition::new(x, y));
                    }
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![run_diagnostics])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
