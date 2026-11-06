(() => {
  const STORAGE_KEY = "watchdog_alerts";
  const DOMAINS_KEY = "watchdog_domains";
  const PATTERNS_KEY = "watchdog_patterns";
  const ENABLED_KEY = "watchdog_enabled";
  const QUIET_KEY = "watchdog_quiet";
  const PAUSED_KEY = "watchdog_paused_until";

  const DEFAULT_DOMAINS = [
    { domain: "steamcommunity.com", enabled: true },
    { domain: "store.steampowered.com", enabled: true },
    { domain: "steam.com", enabled: true }
  ];
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

  const toggleEnabled = document.getElementById("toggleEnabled");
  const toggleQuiet = document.getElementById("toggleQuiet");
  const domainsList = document.getElementById("domainsList");
  const patternsList = document.getElementById("patternsList");
  const newDomain = document.getElementById("newDomain");
  const btnAddDomain = document.getElementById("btnAddDomain");
  const newPattern = document.getElementById("newPattern");
  const btnAddPattern = document.getElementById("btnAddPattern");
  const btnExport = document.getElementById("btnExport");
  const btnClear = document.getElementById("btnClear");
  const btnReset = document.getElementById("btnReset");
  const saved = document.getElementById("saved");

  let domains = [...DEFAULT_DOMAINS];
  let patterns = [...DEFAULT_PATTERNS];
  let enabled = true;
  let quiet = false;
  let pausedUntil = null;

  function normalizeDomains(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_DOMAINS];
    return raw
      .map((d) => {
        if (typeof d === "string") return { domain: d, enabled: true };
        return { domain: String(d.domain || ""), enabled: d.enabled !== false };
      })
      .filter((d) => d.domain);
  }

  async function load() {
    const res = await chrome.storage.local.get([
      DOMAINS_KEY,
      PATTERNS_KEY,
      ENABLED_KEY,
      QUIET_KEY,
      PAUSED_KEY,
      STORAGE_KEY
    ]);
    domains = normalizeDomains(res[DOMAINS_KEY]);
    patterns =
      Array.isArray(res[PATTERNS_KEY]) && res[PATTERNS_KEY].length
        ? res[PATTERNS_KEY]
        : [...DEFAULT_PATTERNS];
    enabled = res[ENABLED_KEY] !== false;
    quiet = res[QUIET_KEY] === true;
    pausedUntil =
      res[PAUSED_KEY] !== null && res[PAUSED_KEY] !== undefined
        ? res[PAUSED_KEY]
        : null;
    toggleEnabled.checked = enabled;
    toggleQuiet.checked = quiet;
    renderList(domainsList, domains, "domain");
    renderList(patternsList, patterns, "pattern");
    updatePauseUI();
  }

  function updatePauseUI() {
    const now = Date.now();
    if (pausedUntil && now < pausedUntil) {
      const remaining = pausedUntil - now;
      const mins = Math.max(1, Math.ceil(remaining / 60000));
      btnPause.style.display = "none";
      btnResume.style.display = "inline-block";
      pauseInfo.textContent = `Paused until ${new Date(pausedUntil).toLocaleTimeString()} (~${mins} min remaining)`;
      pauseInfo.style.color = "#ffb36b";
      pauseInfo.hidden = false;
    } else {
      btnPause.style.display = "inline-block";
      btnResume.style.display = "none";
      pauseInfo.textContent = "Monitoring is active.";
      pauseInfo.style.color = "#6b7280";
      pauseInfo.hidden = false;
    }
  }

  function renderList(listEl, items, type) {
    listEl.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "10px";
      row.style.width = "100%";

      if (type === "domain") {
        const label = document.createElement("label");
        label.style.display = "flex";
        label.style.alignItems = "center";
        label.style.gap = "8px";
        label.style.cursor = "pointer";
        label.style.flex = "1";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.enabled;
        checkbox.style.accentColor = "#66c0ff";

        const span = document.createElement("span");
        span.textContent = item.domain;
        const status = document.createElement("span");
        status.className = item.enabled ? "domain-enabled" : "domain-disabled";
        status.textContent = item.enabled ? "on" : "off";

        checkbox.addEventListener("change", async () => {
          item.enabled = checkbox.checked;
          status.textContent = item.enabled ? "on" : "off";
          status.className = item.enabled ? "domain-enabled" : "domain-disabled";
          await save();
        });

        label.appendChild(checkbox);
        label.appendChild(span);
        label.appendChild(status);
        row.appendChild(label);
      } else {
        const span = document.createElement("span");
        span.textContent = item;
        span.style.flex = "1";
        row.appendChild(span);
      }

      const del = document.createElement("span");
      del.className = "del";
      del.textContent = "remove";
      del.style.cursor = "pointer";
      del.style.color = "#ff8a8a";

      del.onclick = async () => {
        if (type === "domain") {
          domains = domains.filter((x) => x.domain !== item.domain);
        } else {
          patterns = patterns.filter((x) => x !== item);
        }
        await save();
      };

      row.appendChild(del);
      li.appendChild(row);
      listEl.appendChild(li);
    }
  }

  async function save() {
    await chrome.storage.local.set({
      [DOMAINS_KEY]: domains,
      [PATTERNS_KEY]: patterns,
      [ENABLED_KEY]: toggleEnabled.checked,
      [QUIET_KEY]: toggleQuiet.checked,
      [PAUSED_KEY]: pausedUntil
    });
    saved.style.display = "block";
    setTimeout(() => {
      saved.style.display = "none";
    }, 1200);
  }

  btnPause.addEventListener("click", async () => {
    const mins = parseInt(pauseMinutes.value, 10);
    if (isNaN(mins) || mins <= 0 || mins > 1440) {
      alert("Enter a number between 1 and 1440 minutes.");
      return;
    }
    pausedUntil = Date.now() + mins * 60000;
    pauseMinutes.value = "";
    await save();
    updatePauseUI();
  });

  btnResume.addEventListener("click", async () => {
    pausedUntil = null;
    await save();
    updatePauseUI();
  });

  btnAddDomain.addEventListener("click", async () => {
    const v = newDomain.value.trim();
    if (!v || domains.some((x) => x.domain === v)) {
      newDomain.value = "";
      return;
    }
    domains.push({ domain: v, enabled: true });
    newDomain.value = "";
    renderList(domainsList, domains, "domain");
    await save();
  });

  btnAddPattern.addEventListener("click", async () => {
    const v = newPattern.value.trim();
    if (!v || patterns.includes(v)) {
      newPattern.value = "";
      return;
    }
    patterns.push(v);
    newPattern.value = "";
    renderList(patternsList, patterns, "pattern");
    await save();
  });

  toggleEnabled.addEventListener("change", save);
  toggleQuiet.addEventListener("change", save);

  btnExport.addEventListener("click", async () => {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const alerts = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
    const blob = new Blob([JSON.stringify(alerts, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `watchdog-alerts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  btnClear.addEventListener("click", async () => {
    if (
      !confirm("Clear all stored alerts? This cannot be undone.")
    )
      return;
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  });

  btnReset.addEventListener("click", async () => {
    if (
      !confirm(
        "Reset to defaults? This will clear your custom domains and patterns."
      )
    )
      return;
    domains = [...DEFAULT_DOMAINS];
    patterns = [...DEFAULT_PATTERNS];
    enabled = true;
    quiet = false;
    pausedUntil = null;
    toggleEnabled.checked = true;
    toggleQuiet.checked = false;
    renderList(domainsList, domains, "domain");
    renderList(patternsList, patterns, "pattern");
    updatePauseUI();
    await save();
  });

  load();
})();
