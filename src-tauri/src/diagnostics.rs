use serde::Serialize;
use std::time::Duration;
use url::Url;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct SiteInput {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyInfo {
    pub status: ProxyStatus,
    pub server: Option<String>,
    pub pac_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyStatus {
    Off,
    On,
    Pac,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiteCheck {
    pub name: String,
    pub url: String,
    pub host: Option<String>,
    pub status: SiteStatus,
    pub message: String,
    pub http_status: Option<u16>,
    pub dns_ok: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SiteStatus {
    Ok,
    InvalidUrl,
    DnsFailed,
    Timeout,
    TlsError,
    ConnectFailed,
    HttpError,
    RequestFailed,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsReport {
    pub generated_at: String,
    pub basics: NetworkBasics,
    pub proxy: ProxyInfo,
    pub sites: Vec<SiteCheck>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetworkBasics {
    pub adapters: Vec<AdapterBasics>,
    pub ip_ok: bool,
    pub ip_address: Option<String>,
    pub dns_ok: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdapterBasics {
    pub name: String,
    pub ok: bool,
}

pub async fn run(
    sites: Vec<SiteInput>,
    proxy: ProxyInfo,
) -> DiagnosticsReport {
    let client = reqwest::Client::builder()
        .user_agent("kazu-diagnostics/0.1")
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(8))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(_e) => {
            let generated_at = iso_now_local();
            let basics = collect_network_basics().await;
            return DiagnosticsReport {
                generated_at,
                basics,
                proxy,
                sites: vec![],
            };
        }
    };

    let generated_at = iso_now_local();

    let basics = collect_network_basics().await;

    let mut results = Vec::with_capacity(sites.len());
    for site in sites {
        results.push(check_one(&client, &site.name, &site.url).await);
    }

    DiagnosticsReport {
        generated_at,
        basics,
        proxy,
        sites: results,
    }
}

async fn collect_network_basics() -> NetworkBasics {
    // 出力対象は「ローカルエリア接続」「WiFi」のみ
    let mut found_lan = false;
    let mut found_wifi = false;

    let mut candidate_ip: Option<String> = None;
    let mut any_ip = false;

    #[cfg(windows)]
    {
        // ipconfig crate uses Windows APIs to enumerate adapters
        match ipconfig::get_adapters() {
            Ok(list) => {
                for adapter in list {
                    let name = adapter.friendly_name();
                    let kind = classify_adapter(name);
                    if kind.is_none() {
                        continue;
                    }

                    match kind {
                        Some(AdapterKind::Lan) => found_lan = true,
                        Some(AdapterKind::Wifi) => found_wifi = true,
                        None => {}
                    }

                    for ip in adapter.ip_addresses() {
                        any_ip = true;
                        if candidate_ip.is_none() {
                            if let Some(best) = select_best_ip(*ip) {
                                candidate_ip = Some(best);
                            }
                        }
                    }
                }
            }
            Err(_) => {
                // adapters stays empty
            }
        }
    }

    #[cfg(not(windows))]
    {
        // 非Windowsは現状未対応（このアプリのターゲットはWindows11）
    }

    // DNS: google.com を引けるか
    let dns_ok = lookup_host("google.com", 443).await;

    // IP取得: 使えるIPが取れているか（リンクローカル/APIPAだけならNG）
    let ip_ok = candidate_ip.is_some();
    let ip_address = if ip_ok {
        candidate_ip
    } else if any_ip {
        // 何かしらのIPはあるが、リンクローカル等しか無い場合はNGのまま、値は出さない
        None
    } else {
        None
    };

    let adapters = vec![
        AdapterBasics {
            name: "ローカルエリア接続".to_string(),
            ok: found_lan,
        },
        AdapterBasics {
            name: "WiFi".to_string(),
            ok: found_wifi,
        },
    ];

    NetworkBasics {
        adapters,
        ip_ok,
        ip_address,
        dns_ok,
    }
}

#[derive(Debug, Clone, Copy)]
enum AdapterKind {
    Lan,
    Wifi,
}

fn classify_adapter(name: &str) -> Option<AdapterKind> {
    let lower = name.to_lowercase();

    // WiFi
    if lower.contains("wi-fi")
        || lower.contains("wifi")
        || lower.contains("wireless")
        || name.contains("無線")
    {
        return Some(AdapterKind::Wifi);
    }

    // LAN (Ethernet)
    if lower.contains("ethernet")
        || lower.contains("local area")
        || name.contains("イーサネット")
        || name.contains("ローカル")
    {
        return Some(AdapterKind::Lan);
    }

    None
}

fn select_best_ip(ip: std::net::IpAddr) -> Option<String> {
    match ip {
        std::net::IpAddr::V4(v4) => {
            if v4.is_loopback() {
                return None;
            }
            let o = v4.octets();
            // APIPA (169.254.x.x) は「IPはあるが通信できない」ことが多いので候補から外す
            if o[0] == 169 && o[1] == 254 {
                return None;
            }
            Some(v4.to_string())
        }
        std::net::IpAddr::V6(v6) => {
            if v6.is_loopback() {
                return None;
            }
            // IPv6リンクローカル fe80::/10 も候補から外す
            if v6.is_unicast_link_local() {
                return None;
            }
            Some(v6.to_string())
        }
    }
}

async fn check_one(client: &reqwest::Client, name: &str, url: &str) -> SiteCheck {
    let parsed = match Url::parse(url) {
        Ok(u) => u,
        Err(_) => {
            return SiteCheck {
                name: name.to_string(),
                url: url.to_string(),
                host: None,
                status: SiteStatus::InvalidUrl,
                message: "URLが不正です".to_string(),
                http_status: None,
                dns_ok: None,
            };
        }
    };

    let host = parsed.host_str().map(|s| s.to_string());

    let mut dns_ok = None;
    if let Some(hostname) = parsed.host_str() {
        let port = match parsed.scheme() {
            "http" => 80,
            _ => 443,
        };
        dns_ok = Some(lookup_host(hostname, port).await);
        if dns_ok == Some(false) {
            return SiteCheck {
                name: name.to_string(),
                url: url.to_string(),
                host,
                status: SiteStatus::DnsFailed,
                message: "DNS（名前の変換）がうまくいっていません".to_string(),
                http_status: None,
                dns_ok,
            };
        }
    }

    let resp = client.get(url).send().await;
    match resp {
        Ok(r) => {
            let status = r.status();
            if status.is_success() || status.is_redirection() {
                SiteCheck {
                    name: name.to_string(),
                    url: url.to_string(),
                    host,
                    status: SiteStatus::Ok,
                    message: "OK".to_string(),
                    http_status: Some(status.as_u16()),
                    dns_ok,
                }
            } else {
                let code = status.as_u16();
                let msg = if (500..600).contains(&code) {
                    "サイト側が混雑/障害の可能性（5xx）"
                } else if (400..500).contains(&code) {
                    "アクセスが拒否された可能性（4xx）"
                } else {
                    "HTTPエラー"
                };

                SiteCheck {
                    name: name.to_string(),
                    url: url.to_string(),
                    host,
                    status: SiteStatus::HttpError,
                    message: format!("{}: {}", msg, code),
                    http_status: Some(code),
                    dns_ok,
                }
            }
        }
        Err(e) => {
            if e.is_timeout() {
                return SiteCheck {
                    name: name.to_string(),
                    url: url.to_string(),
                    host,
                    status: SiteStatus::Timeout,
                    message: "タイムアウト（回線が不安定/混雑の可能性）".to_string(),
                    http_status: None,
                    dns_ok,
                };
            }

            let msg_lower = e.to_string().to_lowercase();
            if msg_lower.contains("certificate")
                || msg_lower.contains("tls")
                || msg_lower.contains("invalid") && msg_lower.contains("cert")
            {
                return SiteCheck {
                    name: name.to_string(),
                    url: url.to_string(),
                    host,
                    status: SiteStatus::TlsError,
                    message: "証明書/TLSエラーの可能性（PC時刻ずれ等）".to_string(),
                    http_status: None,
                    dns_ok,
                };
            }

            if e.is_connect() {
                return SiteCheck {
                    name: name.to_string(),
                    url: url.to_string(),
                    host,
                    status: SiteStatus::ConnectFailed,
                    message: "接続できません（回線/プロキシ/VPN等の影響の可能性）".to_string(),
                    http_status: None,
                    dns_ok,
                };
            }

            SiteCheck {
                name: name.to_string(),
                url: url.to_string(),
                host,
                status: SiteStatus::RequestFailed,
                message: format!("リクエスト失敗: {}", e),
                http_status: None,
                dns_ok,
            }
        }
    }
}

async fn lookup_host(host: &str, port: u16) -> bool {
    use tokio::net::lookup_host;

    let target = (host, port);
    match lookup_host(target).await {
        Ok(mut addrs) => addrs.next().is_some(),
        Err(_) => false,
    }
}

fn iso_now_local() -> String {
    // chronoを増やさないため、標準ライブラリで人間が読める形にする（電話読み上げ用）
    // 例: 2026-03-14 12:34:56
    let now = std::time::SystemTime::now();
    let datetime: chrono::DateTime<chrono::Local> = now.into();
    datetime.format("%Y-%m-%d %H:%M:%S").to_string()
}
