// Session Sentinel — background service worker (all domains) v1.2.0
// Detection only. No network. All logs stay in chrome.storage.local.

const STORAGE_KEY = "watchdog_alerts";
const DOMAINS_KEY = "watchdog_domains";
const PATTERNS_KEY = "watchdog_patterns";
const ENABLED_KEY = "watchdog_enabled";
const QUIET_KEY = "watchdog_quiet";
const PAUSED_KEY = "watchdog_paused_until";
const MAX_ALERTS = 300;

const DEFAULT_PATTERNS = [
  "steamLoginSecure",
  "sessionid",
  "steamMachineAuth",
  "auth",
  "session",
  "token",
  "access_token",
  "jwt",
  "login",
  "secure"
];

const DEFAULT_DOMAINS = [
  { domain: "steamcommunity.com", enabled: true },
  { domain: "store.steampowered.com", enabled: true },
  { domain: "steam.com", enabled: true }
];

function mask(value) {
  if (!value) return "";
  if (value.length <= 8) return "\u2022\u2022\u2022\u2022";
  return value.slice(0, 4) + "\u2022\u2022\u2022\u2022" + value.slice(-4);
}

function normalizeDomains(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_DOMAINS];
  return raw
    .map((d) => {
      if (typeof d === "string") return { domain: d, enabled: true };
      return { domain: String(d.domain || ""), enabled: d.enabled !== false };
    })
    .filter((d) => d.domain);
}

async function getStorage() {
  const res = await chrome.storage.local.get([
    STORAGE_KEY,
    DOMAINS_KEY,
    PATTERNS_KEY,
    ENABLED_KEY,
    QUIET_KEY,
    PAUSED_KEY
  ]);
  return {
    alerts: Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [],
    domains: normalizeDomains(res[DOMAINS_KEY]),
    patterns:
      Array.isArray(res[PATTERNS_KEY]) && res[PATTERNS_KEY].length
        ? res[PATTERNS_KEY]
        : [...DEFAULT_PATTERNS],
    enabled: res[ENABLED_KEY] !== false,
    quiet: res[QUIET_KEY] === true,
    pausedUntil:
      res[PAUSED_KEY] !== null && res[PAUSED_KEY] !== undefined
        ? res[PAUSED_KEY]
        : null
  };
}

async function setStorage(updates) {
  await chrome.storage.local.set(updates);
}

async function saveAlerts(alerts) {
  await setStorage({ [STORAGE_KEY]: alerts.slice(-MAX_ALERTS) });
}

function domainStatus(domain, watchlist) {
  const d = domain.startsWith(".") ? domain.slice(1) : domain;
  for (const w of watchlist) {
    const wd = w.domain.startsWith(".") ? w.domain.slice(1) : w.domain;
    if (d === wd || d.endsWith("." + wd)) {
      return { matched: true, enabled: w.enabled };
    }
  }
  return { matched: false, enabled: false };
}

function nameMatches(name, patterns) {
  const n = name.toLowerCase();
  return patterns.some((p) => {
    const pl = p.toLowerCase();
    return n === pl || n.startsWith(pl) || n.includes(pl);
  });
}

// Refresh a single "monitoring paused" notification with the remaining countdown.
// Reused every 60s while paused so the user always sees the schedule.
let pausedInterval = null;

function updatePauseNotification(untilMs) {
  if (!untilMs || Date.now() >= untilMs) return;
  const remaining = untilMs - Date.now();
  const mins = Math.max(1, Math.ceil(remaining / 60000));
  try {
    chrome.notifications.create("watchdog-pause-timer", {
      type: "basic",
      title: "Session monitoring paused",
      message: `Resume at ${new Date(untilMs).toLocaleTimeString()} (${mins} min remaining)`,
      iconUrl: "icon.png"
    });
  } catch (e) {
    console.error("[watchdog] pause notification error:", e);
  }
  if (!pausedInterval) {
    pausedInterval = setInterval(() => updatePauseNotification(untilMs), 60000);
  }
}

function clearPauseTimer() {
  if (pausedInterval) {
    clearInterval(pausedInterval);
    pausedInterval = null;
  }
}

async function addAlert(cookie, cause) {
  const state = await getStorage();
  if (!state.enabled) return;

  // Pause: suppress alerts while pausedUntil has not elapsed
  if (state.pausedUntil && Date.now() < state.pausedUntil) return;

  const watched = domainStatus(cookie.domain, state.domains);
  // Domain explicitly disabled -> never alert for it
  if (watched.matched && !watched.enabled) return;

  const sensitive = nameMatches(cookie.name, state.patterns);
  // Not on an enabled watched domain, and name doesn't match -> skip
  if (!watched.enabled && !sensitive) return;

  const alerts = [...state.alerts];
  const alert = {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    time: new Date().toISOString(),
    name: cookie.name,
    domain: cookie.domain,
    value: mask(cookie.value),
    cause: cause || cookie.cause || "cookie_changed",
    reason: watched.enabled ? "watched_domain" : "sensitive_name",
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    sameSite: cookie.sameSite || "unspecified"
  };
  alerts.unshift(alert);
  await saveAlerts(alerts);

  // Quiet mode: log only, no browser notification
  if (!state.quiet) {
    try {
      await chrome.notifications.create(alert.id, {
        type: "basic",
        title: "Session token detected",
        message: `${cookie.name} on ${cookie.domain} — ${alert.cause}`,
        iconUrl: "icon.png"
      });
    } catch (e) {
      console.error("[watchdog] notification failed:", e);
    }
  }

  updatePauseNotification(state.pausedUntil);
}

chrome.cookies.onChanged.addListener((changeInfo) => {
  try {
    addAlert(changeInfo.cookie, changeInfo.cause);
  } catch (e) {
    console.error("[watchdog] cookie listener error:", e);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === "cookie_write") {
      addAlert(
        {
          name: message.name,
          domain: message.domain,
          value: message.value,
          cause: "page_js_cookie_write"
        },
        "page_js_cookie_write"
      );
    }
  } catch (e) {
    console.error("[watchdog] message handler error:", e);
  }
  sendResponse({ ok: true });
});

chrome.runtime.onInstalled.addListener(() => scanExisting("install"));
chrome.runtime.onStartup.addListener(() => scanExisting("startup"));

async function scanExisting(source) {
  try {
    const state = await getStorage();
    // During a pause window, leave prior alerts intact and emit none.
    if (state.pausedUntil && Date.now() < state.pausedUntil) return;

    const alerts = [...state.alerts];
    for (const entry of state.domains) {
      if (!entry.enabled) continue;
      const cookies = await chrome.cookies.getAll({ domain: entry.domain });
      for (const c of cookies) {
        if (!nameMatches(c.name, state.patterns)) continue;
        const already = alerts.some(
          (a) =>
            a.name === c.name &&
            a.domain === c.domain &&
            a.cause === "baseline"
        );
        if (already) continue;
        alerts.unshift({
          id: `${Date.now()}-${Math.random()}`,
          time: new Date().toISOString(),
          name: c.name,
          domain: c.domain,
          value: mask(c.value),
          cause: "baseline",
          source: source,
          reason: "watched_domain",
          secure: !!c.secure,
          httpOnly: !!c.httpOnly,
          sameSite: c.sameSite || "unspecified"
        });
      }
    }
    await saveAlerts(alerts);
  } catch (e) {
    console.error("[watchdog] baseline scan error:", e);
  }
}
