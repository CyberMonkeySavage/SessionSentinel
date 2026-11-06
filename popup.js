(() => {
  const STORAGE_KEY = "watchdog_alerts";
  const PAUSED_KEY = "watchdog_paused_until";
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const countEl = document.getElementById("badgeCount");
  const summaryEl = document.getElementById("summary");
  const btnRefresh = document.getElementById("btnRefresh");
  const btnClear = document.getElementById("btnClear");
  const btnPause = document.getElementById("btnPause");
  const btnTest = document.getElementById("btnTest");

  let alerts = [];

  function causeClass(cause) {
    return `cause-${(cause || "cookie_changed").replace(/[^a-z0-9_-]/gi, "_")}`;
  }

  function formatTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function render() {
    listEl.innerHTML = "";
    if (!alerts.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    for (const a of alerts) {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="row">
          <span class="name">${escapeHtml(a.name || "?")}</span>
          <span class="time">${formatTime(a.time)}</span>
        </div>
        <div class="row">
          <span class="domain">${escapeHtml(a.domain || "")}</span>
          <span class="badge ${causeClass(a.cause)}">${escapeHtml(a.cause || "")}</span>
        </div>
        ${a.value ? `<div class="value">${escapeHtml(a.value)}</div>` : ""}
      `;
      listEl.appendChild(li);
    }
  }

  function renderSummary(pausedUntil) {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const recent = alerts.filter((a) => new Date(a.time).getTime() > oneHourAgo);

    let html = "";
    if (pausedUntil && now < pausedUntil) {
      const remaining = pausedUntil - now;
      const mins = Math.max(1, Math.ceil(remaining / 60000));
      html += `Monitoring paused for ~${mins} min`;
      btnPause.textContent = "Resume now";
    } else {
      html += `<span class="count">${recent.length}</span> alert${recent.length === 1 ? "" : "s"} in the last hour`;
      btnPause.textContent = "Pause monitoring";
    }
    summaryEl.innerHTML = html;
    summaryEl.hidden = false;
  }

  async function load() {
    const res = await chrome.storage.local.get([STORAGE_KEY, PAUSED_KEY]);
    alerts = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
    const pausedUntil =
      res[PAUSED_KEY] !== null && res[PAUSED_KEY] !== undefined
        ? res[PAUSED_KEY]
        : null;
    countEl.textContent = alerts.length;
    render();
    renderSummary(pausedUntil);
  }

  btnRefresh.addEventListener("click", load);

  btnTest.addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ type: "test_alert" });
    } catch (e) {
      // service worker may be waking up; reload shortly either way
    }
    setTimeout(load, 300);
  });

  btnClear.addEventListener("click", async () => {
    if (!confirm("Clear all stored alerts? This cannot be undone.")) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    alerts = [];
    countEl.textContent = "0";
    render();
    renderSummary(null);
  });

  btnPause.addEventListener("click", async () => {
    const res = await chrome.storage.local.get(PAUSED_KEY);
    const pausedUntil =
      res[PAUSED_KEY] !== null && res[PAUSED_KEY] !== undefined
        ? res[PAUSED_KEY]
        : null;
    if (pausedUntil && Date.now() < pausedUntil) {
      // Resume now
      await chrome.storage.local.set({ [PAUSED_KEY]: null });
      btnPause.textContent = "Pause monitoring";
      renderSummary(null);
    } else {
      const input = prompt(
        "Pause monitoring for (minutes):",
        "15"
      );
      if (input === null) return;
      const mins = parseInt(input, 10);
      if (isNaN(mins) || mins <= 0) {
        alert("Please enter a positive number of minutes.");
        return;
      }
      const until = Date.now() + mins * 60000;
      await chrome.storage.local.set({ [PAUSED_KEY]: until });
      renderSummary(until);
    }
  });

  load();
})();