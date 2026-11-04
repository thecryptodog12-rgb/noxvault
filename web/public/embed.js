/*! Noxvault fund button · https://www.nox-vault.com/docs#integrate
 * <script src="https://www.nox-vault.com/embed.js" async></script>
 * <a data-noxvault-fund="VAULT_ADDRESS" data-amount="0.1"></a>
 * Options on the element: data-amount (SOL), data-label, data-open="site" (treasury page instead
 * of the Blink), data-cluster ("devnet" default, "mainnet-beta", "testnet"). Call
 * window.Noxvault.scan() after adding buttons dynamically. No dependencies, no cookies.
 */
(function () {
  var me = document.currentScript;
  var site = "https://www.nox-vault.com";
  try {
    if (me && me.src) site = new URL(me.src).origin;
  } catch (e) {}
  var KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  var AMOUNT = /^\d{1,12}(\.\d{1,9})?$/;
  var CSS =
    ".nxv-fund{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border:1px solid #2dd4bf;border-radius:8px;" +
    "background:#0b0f10;color:#e6fffb;font:600 14px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
    "text-decoration:none;cursor:pointer;transition:background .15s,box-shadow .15s}" +
    ".nxv-fund:hover{background:#0f1a1a;box-shadow:0 0 0 3px rgba(45,212,191,.25);color:#fff}" +
    ".nxv-fund:focus-visible{outline:2px solid #2dd4bf;outline-offset:2px}" +
    ".nxv-fund svg{flex:none}.nxv-fund small{font-weight:400;color:#7dd3c8}";
  var ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>';

  function style() {
    if (document.getElementById("nxv-fund-css")) return;
    var s = document.createElement("style");
    s.id = "nxv-fund-css";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function esc(t) {
    var d = document.createElement("span");
    d.textContent = t;
    return d.innerHTML;
  }

  function link(vault, amount, open, cluster) {
    if (open === "site") return site + "/fund/" + vault;
    var action = site + "/api/actions/fund/" + vault + (amount ? "?amount=" + amount : "");
    var c = cluster === "mainnet-beta" ? "" : "&cluster=" + (cluster === "testnet" ? "testnet" : "devnet");
    return "https://dial.to/?action=" + encodeURIComponent("solana-action:" + action) + c;
  }

  function wire(el) {
    if (el.getAttribute("data-noxvault-ready")) return;
    var vault = (el.getAttribute("data-noxvault-fund") || "").trim();
    if (!KEY.test(vault)) {
      if (window.console) console.warn("[noxvault] not a Solana address:", vault);
      return;
    }
    var amount = (el.getAttribute("data-amount") || "").trim().replace(",", ".");
    if (amount && !AMOUNT.test(amount)) amount = "";
    var cluster = el.getAttribute("data-cluster") || (me && me.getAttribute("data-cluster")) || "devnet";
    var href = link(vault, amount, el.getAttribute("data-open"), cluster);
    var label = el.getAttribute("data-label") || "Fund this vault (quantum-safe)";
    el.setAttribute("data-noxvault-ready", "1");
    el.classList.add("nxv-fund");
    el.innerHTML = ICON + "<span>" + esc(label) + "</span>" + (amount ? "<small>" + esc(amount) + " SOL</small>" : "");
    el.setAttribute("title", "Send SOL to Noxvault " + vault.slice(0, 4) + "…" + vault.slice(-4) + " (opens in a new tab)");
    if (el.tagName === "A") {
      el.setAttribute("href", href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    } else {
      el.setAttribute("role", "button");
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      var go = function () {
        window.open(href, "_blank", "noopener,noreferrer");
      };
      el.addEventListener("click", go);
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    }
  }

  function scan(root) {
    style();
    var els = (root || document).querySelectorAll("[data-noxvault-fund]");
    for (var i = 0; i < els.length; i++) wire(els[i]);
  }

  window.Noxvault = window.Noxvault || {};
  window.Noxvault.scan = scan;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scan(); });
  else scan();
})();
