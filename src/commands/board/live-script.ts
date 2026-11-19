/**
 * The live page: swaps #app in place when the plan changes (keeping the tab you are on and the projects you opened), flashes
 * rows it hasn't seen, ticks the relative times, puts the needs-you count in the tab title and icon,
 * and, if the user allowed it, sends a notification when something new needs them while the tab is hidden.
 */
export const LIVE_SCRIPT = `<script>
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var status = "live";
  function app() { return document.getElementById("app"); }
  function keys() { var s = {}; document.querySelectorAll("[data-key]").forEach(function (e) { s[e.getAttribute("data-key")] = 1; }); return s; }
  function showStatus() {
    var dot = document.getElementById("live");
    if (!dot) return;
    dot.className = "live " + (status === "live" ? "on" : status === "off" ? "off" : "");
    dot.title = status === "live" ? "Live: updates as the plan changes" : "Reconnecting";
  }
  function needs() { return Number(app().getAttribute("data-needs") || 0); }
  function icon(n) {
    var c = document.createElement("canvas"); c.width = c.height = 32;
    var g = c.getContext("2d");
    g.fillStyle = "#3d5afe"; g.beginPath(); g.roundRect(2, 2, 28, 28, 7); g.fill();
    g.fillStyle = "#fff"; g.font = "bold 15px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("wk", 16, 17);
    if (n) { g.fillStyle = "#f59e0b"; g.beginPath(); g.arc(25, 7, 7, 0, 7); g.fill(); }
    var link = document.querySelector("link[rel=icon]") || document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
    link.href = c.toDataURL();
  }
  function tick() {
    var now = Date.now();
    document.querySelectorAll("time.ago").forEach(function (t) {
      var m = Math.max(0, Math.round((now - Date.parse(t.getAttribute("datetime"))) / 60000));
      var n = m < 1 ? "" : m < 60 ? m + " min" : m < 1440 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d";
      var pre = t.getAttribute("data-prefix") || "", suf = t.getAttribute("data-suffix") || "";
      t.textContent = n ? pre + n + suf : (suf ? pre + "just now" : pre + "a moment");
    });
  }
  function send(title, body) {
    try { new Notification(title, { body: body, tag: "wk", renotify: true }); } catch (e) { console.warn("wk: notification failed", e); }
  }
  function notifyButton() {
    var b = document.getElementById("notify");
    if (!b) return;
    b.hidden = false;
    if (!("Notification" in window)) { b.textContent = "Notifications unsupported"; b.disabled = true; return; }
    var p = Notification.permission;
    if (p === "default") {
      b.textContent = "Notify me"; b.title = "Get a desktop notification when something new needs you";
      b.onclick = function () { Notification.requestPermission().then(function (r) { notifyButton(); if (r === "granted") send("wk notifications are on", "You will hear from this board when something new needs you."); }); };
    } else if (p === "granted") {
      b.remove();
    } else {
      b.textContent = "Notifications blocked"; b.title = "Allow notifications for this site in the browser (the icon left of the address), then reload.";
      b.onclick = null;
    }
  }
  function swap(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var next = doc.getElementById("app");
    if (!next) return;
    var before = keys(), was = needs(), opened = {};
    document.querySelectorAll("details[data-id]").forEach(function (d) { if (d.open) opened[d.getAttribute("data-id")] = 1; });
    next.querySelectorAll("details[data-id]").forEach(function (d) { if (opened[d.getAttribute("data-id")]) d.open = true; });
    app().replaceWith(next);
    document.title = doc.title;
    showTab(); showStatus(); notifyButton(); icon(needs()); tick();
    // Notify whenever you are not looking at the board: another window has focus, or the tab is hidden.
    if (needs() > was && (document.hidden || !document.hasFocus()) && "Notification" in window && Notification.permission === "granted") {
      send(app().getAttribute("data-first") || "Something needs you", document.title);
    }
    if (reduce) return;
    // Tint what changed, then let it fade (the transition runs once the class goes).
    var fresh = [];
    document.querySelectorAll("[data-key]").forEach(function (e) { if (!before[e.getAttribute("data-key")]) { e.classList.add("fresh"); fresh.push(e); } });
    setTimeout(function () { fresh.forEach(function (e) { e.classList.remove("fresh"); }); }, 800);
  }
  // The tab you are on survives refreshes and visits; 1 and 2 switch tabs.
  function savedTab() { try { return localStorage.getItem("wk-board-tab") || "now"; } catch (e) { return "now"; } }
  function pick(tab) {
    var r = document.getElementById("tab-" + tab);
    if (!r) return;
    r.checked = true;
    try { localStorage.setItem("wk-board-tab", tab); } catch (e) { /* storage blocked: the tab just isn't remembered */ }
  }
  function showTab() { var r = document.getElementById("tab-" + savedTab()); if (r) r.checked = true; }
  document.addEventListener("change", function (e) { if (e.target.name === "tab") pick(e.target.value); });
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(TEXTAREA|SELECT)$/.test(e.target.tagName) || (e.target.tagName === "INPUT" && e.target.type !== "radio")) return;
    if (e.key === "1") pick("now");
    if (e.key === "2") pick("plan");
  });
  function connect() {
    var es = new EventSource("/events");
    es.onopen = function () { status = "live"; showStatus(); };
    es.onerror = function () { status = "off"; showStatus(); };
    es.onmessage = function () { fetch("/", { cache: "no-store" }).then(function (r) { return r.text(); }).then(swap); };
  }
  status = "connecting"; showTab(); showStatus(); notifyButton(); icon(needs()); tick();
  setInterval(tick, 30000);
  connect();
})();
</script>`;
