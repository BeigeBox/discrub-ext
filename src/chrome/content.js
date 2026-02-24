/*global chrome*/

// Storage for captured Discord client headers, bridged from the page world
// via CustomEvent since injected scripts and content scripts have separate
// window objects (isolated worlds).
let _capturedHeaders = {};

// Listen for header updates dispatched from the page-world interceptor.
document.addEventListener("__discrub_headers_update", function (e) {
  _capturedHeaders = e.detail || {};
});

// Inject a script into the page context to intercept Discord's XHR/fetch headers.
// This captures X-Super-Properties, X-Discord-Locale, X-Discord-Timezone, and
// X-Debug-Options from Discord's own outgoing requests so we can reuse them.
const interceptorScript = document.createElement("script");
interceptorScript.textContent = `
(function() {
  if (window.__discrubHeadersCaptured) return;
  window.__discrubHeadersCaptured = true;

  const captured = {};

  const targetHeaders = [
    "x-super-properties",
    "x-discord-locale",
    "x-discord-timezone",
    "x-debug-options"
  ];

  function notifyContentScript() {
    document.dispatchEvent(
      new CustomEvent("__discrub_headers_update", { detail: Object.assign({}, captured) })
    );
  }

  // Intercept XMLHttpRequest to capture headers from Discord's own requests
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function() {
    this._discrubHeaders = {};
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (targetHeaders.includes(name.toLowerCase())) {
      captured[name.toLowerCase()] = value;
      notifyContentScript();
    }
    return origSetRequestHeader.apply(this, arguments);
  };

  // Intercept fetch to capture headers from Discord's own requests
  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (init && init.headers) {
      let headerEntries;
      try {
        if (init.headers instanceof Headers) {
          headerEntries = Array.from(init.headers.entries());
        } else if (Array.isArray(init.headers)) {
          headerEntries = init.headers;
        } else {
          headerEntries = Object.entries(init.headers);
        }
      } catch(e) {
        headerEntries = [];
      }

      let updated = false;
      for (const [key, value] of headerEntries) {
        if (targetHeaders.includes(key.toLowerCase())) {
          captured[key.toLowerCase()] = value;
          updated = true;
        }
      }
      if (updated) notifyContentScript();
    }
    return origFetch.apply(this, arguments);
  };
})();
`;
document.documentElement.appendChild(interceptorScript);
interceptorScript.remove();

if (!chrome.runtime.onMessage.hasListeners())
  chrome.runtime.onMessage.addListener(function (request, sender, callback) {
    const { message } = request;
    switch (message) {
      case "INJECT_BUTTON":
        // eslint-disable-next-line no-case-declarations
        const element =
          document.querySelector('[aria-label="Inbox"]')?.parentElement ||
          document.querySelector('[aria-label="Help"]')?.parentElement;
        if (!document.getElementById("injected_iframe_button") && element) {
          element.style.display = "flex";
          element.style.flexDirection = "row-reverse";
          element.style.alignItems = "center";
          element.style.justifyContent = "center";
          const iframe = document.createElement("iframe");
          iframe.id = "injected_iframe_button";
          iframe.src = chrome.runtime.getURL("button_injection.html");
          iframe.scrolling = "no";
          iframe.width = 30;
          iframe.height = 30;
          element.appendChild(iframe);
        }
        break;
      case "INJECT_DIALOG":
        if (!document.getElementById("injected_dialog")) {
          const modal = document.createElement("dialog");
          modal.id = "injected_dialog";
          modal.innerHTML =
            "<style>::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-thumb{background:#f1f1f1;}::-webkit-scrollbar-track{background:#888;}</style>";
          modal.style.padding = 0;
          modal.style.border = "none";
          modal.style.backgroundColor = "transparent";
          modal.style.overflow = "auto";
          const iframe = document.createElement("iframe");
          iframe.id = "injected_dialog_iframe";
          iframe.src = chrome.runtime.getURL("index.html");
          iframe.height = "675px";
          iframe.width = "1250px";
          // iframe.style.border = "1px dotted gray";
          modal.appendChild(iframe);
          document.body.appendChild(modal);
          document.getElementById("injected_dialog").showModal();
        }
        break;
      case "CLOSE_INJECTED_DIALOG":
        if (document.getElementById("injected_dialog")) {
          document.getElementById("injected_dialog_iframe").remove();
          document.getElementById("injected_dialog").remove();
        }
        break;
      case "GET_TOKEN":
        window.dispatchEvent(new Event("beforeunload"));
        // eslint-disable-next-line no-case-declarations
        const storage = document.body.appendChild(
          document.createElement("iframe")
        ).contentWindow.localStorage;
        if (storage.token) callback(JSON.parse(storage.token));
        else callback(null);
        return true;
      case "GET_CLIENT_HEADERS":
        callback(
          Object.keys(_capturedHeaders).length > 0 ? _capturedHeaders : null,
        );
        return true;
      default:
        break;
    }
  });
