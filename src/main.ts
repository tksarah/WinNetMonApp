import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

type ProxyStatus = "off" | "on" | "pac" | "unknown";
type SiteStatus =
  | "ok"
  | "invalid_url"
  | "dns_failed"
  | "timeout"
  | "tls_error"
  | "connect_failed"
  | "http_error"
  | "request_failed";

type SiteInput = { name: string; url: string };

type ProxyInfo = {
  status: ProxyStatus;
  server: string | null;
  pac_url: string | null;
};

type SiteCheck = {
  name: string;
  url: string;
  host: string | null;
  status: SiteStatus;
  message: string;
  http_status: number | null;
  dns_ok: boolean | null;
};

type DiagnosticsReport = {
  generated_at: string;
  basics: NetworkBasics;
  proxy: ProxyInfo;
  sites: SiteCheck[];
};

type IpStackPreference = "ipv4" | "ipv6" | "unknown";

type NetworkBasics = {
  adapters: AdapterBasics[];
  ip_ok: boolean;
  ip_address: string | null;
  ipv4_ok: boolean;
  ipv4_address: string | null;
  ipv6_ok: boolean;
  ipv6_address: string | null;
  stack_preference: IpStackPreference;
  ipv4_internet_ok: boolean;
  ipv4_rtt_ms: number | null;
  ipv6_internet_ok: boolean;
  ipv6_rtt_ms: number | null;
  dns_ok: boolean;
};

type AdapterBasics = {
  name: string;
  ok: boolean;
};

const MAX_SITES = 5;
const STORAGE_KEY = "kazu.diagnostics.sites.v1";
const FONT_SIZE_KEY = "kazu.ui.fontSize.v1";
const DEFAULT_URLS = [
  "https://example.com/",
  "",
  "",
  "",
  "",
];

type FontSizeChoice = "small" | "medium" | "large" | "xlarge";

function fontSizeToPx(choice: FontSizeChoice): string {
  switch (choice) {
    case "small":
      return "15px";
    case "large":
      return "18px";
    case "xlarge":
      return "20px";
    default:
      return "16px";
  }
}

function loadFontSize(): FontSizeChoice {
  try {
    const raw = localStorage.getItem(FONT_SIZE_KEY);
    if (raw === "small" || raw === "medium" || raw === "large" || raw === "xlarge") return raw;
    return "medium";
  } catch {
    return "medium";
  }
}

function saveFontSize(choice: FontSizeChoice): void {
  try {
    localStorage.setItem(FONT_SIZE_KEY, choice);
  } catch {
    // ignore
  }
}

function applyFontSize(choice: FontSizeChoice): void {
  document.documentElement.style.setProperty("--base-font-size", fontSizeToPx(choice));

  const smallBtn = document.querySelector<HTMLButtonElement>("#font-small");
  const mediumBtn = document.querySelector<HTMLButtonElement>("#font-medium");
  const largeBtn = document.querySelector<HTMLButtonElement>("#font-large");
  const xlargeBtn = document.querySelector<HTMLButtonElement>("#font-xlarge");
  const all = [smallBtn, mediumBtn, largeBtn, xlargeBtn].filter(Boolean) as HTMLButtonElement[];
  for (const b of all) b.classList.remove("is-active");

  if (choice === "small") smallBtn?.classList.add("is-active");
  if (choice === "medium") mediumBtn?.classList.add("is-active");
  if (choice === "large") largeBtn?.classList.add("is-active");
  if (choice === "xlarge") xlargeBtn?.classList.add("is-active");
}

function setupFontSizeControls(): void {
  const smallBtn = document.querySelector<HTMLButtonElement>("#font-small");
  const mediumBtn = document.querySelector<HTMLButtonElement>("#font-medium");
  const largeBtn = document.querySelector<HTMLButtonElement>("#font-large");
  const xlargeBtn = document.querySelector<HTMLButtonElement>("#font-xlarge");

  const initial = loadFontSize();
  applyFontSize(initial);

  smallBtn?.addEventListener("click", () => {
    applyFontSize("small");
    saveFontSize("small");
  });
  mediumBtn?.addEventListener("click", () => {
    applyFontSize("medium");
    saveFontSize("medium");
  });
  largeBtn?.addEventListener("click", () => {
    applyFontSize("large");
    saveFontSize("large");
  });

  xlargeBtn?.addEventListener("click", () => {
    applyFontSize("xlarge");
    saveFontSize("xlarge");
  });
}

function $(selector: string): HTMLElement {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el as HTMLElement;
}

function proxyLabel(proxy: ProxyInfo): string {
  switch (proxy.status) {
    case "off":
      return "OFF";
    case "on":
      return proxy.server ? `ON（${proxy.server}）` : "ON";
    case "pac":
      return proxy.pac_url ? `PAC（${proxy.pac_url}）` : "PAC";
    default:
      return "不明";
  }
}

function okNgLabel(status: SiteStatus): "OK" | "NG" {
  return status === "ok" ? "OK" : "NG";
}

function renderResultsHtml(report: DiagnosticsReport): string {
  const ipv4Ok = report.basics.ipv4_ok ? "OK" : "NG";
  const ipv6Ok = report.basics.ipv6_ok ? "OK" : "NG";
  const dnsOk = report.basics.dns_ok ? "OK" : "NG";
  const proxy = proxyLabel(report.proxy);

  const prefLabel =
    report.basics.stack_preference === "ipv4"
      ? "IPv4"
      : report.basics.stack_preference === "ipv6"
        ? "IPv6"
        : "不明";

  const adapterLines = report.basics.adapters.map((a) => {
    return `<div class="kv-row kv-sub">
      <div class="kv-key">${escapeHtml(a.name)}</div>
      <div class="kv-val"><span class="badge ${a.ok ? "ok" : "ng"}">${a.ok ? "OK" : "NG"}</span></div>
    </div>`;
  });

  const sites = report.sites.map((s) => {
    const okng = okNgLabel(s.status);
    const code = s.http_status ? `HTTP ${s.http_status}` : "";
    return `<div class="site-row-out">
      <div class="site-name">${escapeHtml(s.name)}</div>
      <div class="site-status"><span class="badge ${okng === "OK" ? "ok" : "ng"}">${okng}</span></div>
      <div class="site-msg">${escapeHtml([s.message, code].filter(Boolean).join(" / "))}</div>
    </div>`;
  });

  return `
    <div class="result-section">
      <div class="result-title">基本情報</div>

      <div class="kv">
        <div class="kv-row">
          <div class="kv-key">日時</div>
          <div class="kv-val">${escapeHtml(report.generated_at)}</div>
        </div>
        <div class="kv-row">
          <div class="kv-key">プロキシ</div>
          <div class="kv-val">${escapeHtml(proxy)}</div>
        </div>
      </div>
    </div>

    <div class="result-section">
      <div class="result-title">通信確認</div>

      <div class="kv">
        ${adapterLines.join("")}

        <div class="kv-group" aria-label="IP情報">
          <div class="kv-group-title">IP情報</div>

          <div class="kv-group-body">
            <div class="kv-row">
              <div class="kv-key">IPv4アドレス</div>
              <div class="kv-val">
                <span class="badge ${ipv4Ok === "OK" ? "ok" : "ng"}">${ipv4Ok}</span>
                <span class="kv-note">${report.basics.ipv4_address ? escapeHtml(report.basics.ipv4_address) : ""}</span>
              </div>
            </div>

            <div class="kv-row">
              <div class="kv-key">IPv6アドレス</div>
              <div class="kv-val">
                <span class="badge ${ipv6Ok === "OK" ? "ok" : "ng"}">${ipv6Ok}</span>
                <span class="kv-note">${report.basics.ipv6_address ? escapeHtml(report.basics.ipv6_address) : ""}</span>
              </div>
            </div>

            <div class="kv-row">
              <div class="kv-key">優先（推定）</div>
              <div class="kv-val">${escapeHtml(prefLabel)}</div>
            </div>
          </div>
        </div>

        <div class="kv-row">
          <div class="kv-key">DNS名前解決（google.com）</div>
          <div class="kv-val"><span class="badge ${dnsOk === "OK" ? "ok" : "ng"}">${dnsOk}</span></div>
        </div>
      </div>
    </div>

    <div class="result-section">
      <div class="result-title">サイト診断</div>
      <div class="site-list">
        <div class="site-header">
          <div>サイト</div>
          <div>結果</div>
          <div>詳細</div>
        </div>
        ${sites.join("")}
      </div>
    </div>
  `.trim();
}

function buildSiteInputs(urls: string[]): SiteInput[] {
  const inputs: SiteInput[] = [];
  for (let i = 0; i < Math.min(urls.length, MAX_SITES); i++) {
    const raw = urls[i] ?? "";
    const url = raw.trim();
    if (!url) continue;

    let name = `サイト${i + 1}`;
    try {
      const u = new URL(url);
      if (u.hostname) name = u.hostname;
    } catch {
      // keep fallback name
    }

    inputs.push({ name, url });
  }
  return inputs;
}

function loadUrls(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_URLS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_URLS];
    const urls = parsed.map((v) => (typeof v === "string" ? v : ""));
    while (urls.length < MAX_SITES) urls.push("");
    return urls.slice(0, MAX_SITES);
  } catch {
    return [...DEFAULT_URLS];
  }
}

function saveUrls(urls: string[]): void {
  const normalized = urls
    .slice(0, MAX_SITES)
    .map((s) => (typeof s === "string" ? s.trim() : ""));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

function readUrlsFromInputs(): string[] {
  const urls: string[] = [];
  for (let i = 0; i < MAX_SITES; i++) {
    const el = document.querySelector<HTMLInputElement>(`#site-url-${i}`);
    urls.push((el?.value ?? "").trim());
  }
  return urls;
}

function renderSiteSettings(container: HTMLElement, urls: string[]): void {
  const rows = urls.slice(0, MAX_SITES).map((url, i) => {
    return `
      <div class="site-row">
        <label class="site-label" for="site-url-${i}">サイト${i + 1}</label>
        <input id="site-url-${i}" class="site-input" type="url" placeholder="https://..." value="${escapeHtmlAttr(
          url
        )}" />
        <button type="button" class="site-clear" data-index="${i}" aria-label="サイト${i + 1}の入力を削除">削除</button>
      </div>
    `;
  });

  container.innerHTML = rows.join("");

  const buttons = container.querySelectorAll<HTMLButtonElement>("button.site-clear");
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.index);
      if (!Number.isFinite(index)) return;
      const input = container.querySelector<HTMLInputElement>(`#site-url-${index}`);
      if (!input) return;
      input.value = "";
      input.focus();
    });
  }
}

function escapeHtmlAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseGeneratedAt(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Prefer an ISO-like parse when possible.
  const isoLike = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const d1 = new Date(isoLike);
  if (!Number.isNaN(d1.getTime())) return d1;

  const d2 = new Date(trimmed);
  if (!Number.isNaN(d2.getTime())) return d2;

  return null;
}

function formatTimeHHMM(date: Date): string {
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function autoResizeWindowToFitContent(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    const outer = await appWindow.outerSize();
    const scale = await appWindow.scaleFactor();
    const currentWidth = outer.width / scale;
    const currentHeight = outer.height / scale;

    const maxWidth = Math.max(600, Math.floor(window.screen.availWidth * 0.96));
    const maxHeight = Math.max(500, Math.floor(window.screen.availHeight * 0.96));

    // まず横幅をある程度確保（折り返しが減って縦が縮むことがある）
    const targetWidth = Math.min(Math.max(920, currentWidth), maxWidth);
    await appWindow.setSize(new LogicalSize(targetWidth, currentHeight));

    // DOM反映後に高さが確定するのを待つ
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));

    const doc = document.documentElement;
    const body = document.body;
    const contentHeight = Math.ceil(Math.max(doc.scrollHeight, body.scrollHeight));

    // 高さが画面に収まらない場合は最大化にフォールバック（スクロール削減優先）
    const neededHeight = Math.max(600, contentHeight + 40);
    if (neededHeight > maxHeight) {
      await appWindow.maximize();
      return;
    }

    await appWindow.setSize(new LogicalSize(targetWidth, neededHeight));
  } catch (err) {
    // 失敗しても診断結果自体は表示できるので無視（ただし開発時に原因を追えるようログは残す）
    console.warn("[autoResizeWindowToFitContent] failed", err);
  }
}

async function runDiagnostics(): Promise<void> {
  const btn = $("#run-btn") as HTMLButtonElement;
  const statusEl = $("#status");
  const resultsEl = $("#results");

  btn.disabled = true;
  btn.textContent = "診断中…";
  statusEl.textContent = "診断中…";
  resultsEl.textContent = "診断中…";

  try {
    const urls = readUrlsFromInputs();
    const sites = buildSiteInputs(urls);

    if (sites.length === 0) {
      statusEl.textContent = "未設定";
      resultsEl.textContent = "診断対象のURLが未設定です（最大5件まで登録できます）";
      btn.textContent = "診断開始";
      return;
    }

    const report = await invoke<DiagnosticsReport>("run_diagnostics", {
      sites,
    });
    resultsEl.innerHTML = renderResultsHtml(report);
    const at = parseGeneratedAt(report.generated_at) ?? new Date();
    statusEl.textContent = `診断完了（${formatTimeHHMM(at)}）／再診断できます`;
    btn.textContent = "再診断";

    await autoResizeWindowToFitContent();
  } catch (e) {
    statusEl.textContent = `診断失敗（${formatTimeHHMM(new Date())}）／もう一度押して再試行できます`;
    btn.textContent = "再診断";
    const msg = e instanceof Error ? e.message : String(e);
    resultsEl.textContent = `診断に失敗しました: ${msg}`;
  } finally {
    btn.disabled = false;
  }
}

setupFontSizeControls();

window.addEventListener("DOMContentLoaded", () => {
  const settingsEl = $("#site-settings");
  const saveBtn = $("#save-sites") as HTMLButtonElement;
  const saveStatusEl = $("#save-status");
  const urls = loadUrls();
  renderSiteSettings(settingsEl, urls);

  saveBtn.addEventListener("click", () => {
    const next = readUrlsFromInputs();
    saveUrls(next);
    saveStatusEl.textContent = "保存しました";
    window.setTimeout(() => {
      saveStatusEl.textContent = "";
    }, 1500);
  });

  const btn = $("#run-btn") as HTMLButtonElement;
  btn.addEventListener("click", () => {
    void runDiagnostics();
  });
});
