use crate::diagnostics::{ProxyInfo, ProxyStatus};

#[cfg(windows)]
pub fn get_proxy_info() -> ProxyInfo {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");

    let Ok(key) = key else {
        return ProxyInfo {
            status: ProxyStatus::Unknown,
            server: None,
            pac_url: None,
        };
    };

    let proxy_enable: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    let proxy_server: Option<String> = key.get_value("ProxyServer").ok();
    let pac_url: Option<String> = key.get_value("AutoConfigURL").ok();

    let status = if proxy_enable == 1 {
        ProxyStatus::On
    } else if pac_url.as_ref().is_some_and(|s| !s.trim().is_empty()) {
        ProxyStatus::Pac
    } else {
        ProxyStatus::Off
    };

    ProxyInfo {
        status,
        server: proxy_server.and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        }),
        pac_url: pac_url.and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        }),
    }
}

#[cfg(not(windows))]
pub fn get_proxy_info() -> ProxyInfo {
    ProxyInfo {
        status: ProxyStatus::Unknown,
        server: None,
        pac_url: None,
    }
}
