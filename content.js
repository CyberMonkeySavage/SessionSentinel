// Steam Session Token Watchdog — content script
// Runs in steam.com pages. Detects when page JavaScript writes a sensitive
// session cookie via document.cookie and reports it to the background worker.

(function () {
  const SENSITIVE = [
    "steamLoginSecure",
    "sessionid",
    "steamMachineAuth"
  ];

  function isSensitive(name) {
    return SENSITIVE.some((s) => name === s || name.startsWith(s));
  }

  const desc =
    Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie") ||
    Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (!desc || !desc.set) return;

  const origSet = desc.set;
  const origGet = desc.get;

  Object.defineProperty(document, "cookie", {
    configurable: true,
    enumerable: true,
    get: function () {
      return origGet.call(document);
    },
    set: function (v) {
      try {
        const m = String(v).match(/^\s*([^=;\s]+)=/);
        if (m && isSensitive(m[1])) {
          chrome.runtime.sendMessage({
            type: "cookie_write",
            name: m[1],
            domain: location.hostname,
            value: String(v).slice(0, 120)
          });
        }
      } catch (e) {
        // best effort; never break the page
      }
      return origSet.call(document, v);
    }
  });
})();
