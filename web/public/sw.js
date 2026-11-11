// Noxvault service worker: keeps the app shell and /offline usable with no network.
// Strategy: hashed build assets (/_next/static) cache-first; pages network-first with a
// cached fallback; /offline and its assets are precached on install.
// Also shows vault alerts sent with Web Push (docs/ALERTS.md) and opens the page they point to.
const VERSION = "nox-v2-3"; // bump: push alerts (push, notificationclick, pushsubscriptionchange)
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const PRECACHE_PAGES = ["/offline", "/backup", "/"];
const PRECACHE_FILES = ["/manifest.webmanifest", "/icon.svg"];

async function precache() {
  const shell = await caches.open(SHELL);
  const stat = await caches.open(STATIC);
  await shell.addAll(PRECACHE_FILES).catch(() => {});
  for (const page of PRECACHE_PAGES) {
    try {
      const res = await fetch(page, { cache: "reload", credentials: "same-origin" });
      if (!res.ok) continue;
      await shell.put(page, res.clone());
      const html = await res.text();
      // Every script, stylesheet and font the page references.
      const urls = new Set();
      for (const m of html.matchAll(/(?:\/_next\/)?(static\/(?:chunks|css|media)\/[^"'()\s\\]+)/g)) urls.add(`/_next/${m[1]}`);
      await Promise.all(
        [...urls].map(async (u) => {
          if (await stat.match(u)) return;
          const r = await fetch(u).catch(() => null);
          if (r && r.ok) await stat.put(u, r);
        })
      );
    } catch {
      /* offline during install: runtime caching fills in later */
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "precache") event.waitUntil(precache());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // RPC, wallets, fonts CDNs: never touched
  if (url.pathname.startsWith("/api/")) return;

  // Immutable, content-hashed build output.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(url.pathname);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(url.pathname, res.clone());
        return res;
      })
    );
    return;
  }

  // Full page loads: network first, then the cached copy, then /offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok && PRECACHE_PAGES.includes(url.pathname)) {
            const c = await caches.open(SHELL);
            c.put(url.pathname, res.clone());
          }
          return res;
        } catch {
          const c = await caches.open(SHELL);
          return (await c.match(url.pathname)) || (await c.match("/offline")) || Response.error();
        }
      })()
    );
    return;
  }

  // Other same-origin files (icon, manifest): cache first.
  if (PRECACHE_FILES.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(req)));
  }
});

// ---------- vault alerts (Web Push) ----------
// Payload (lib/alerts/push.ts PushPayload): { title, body, url, tag, urgent }.

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof d.title === "string" && d.title ? d.title : "Noxvault alert";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof d.body === "string" ? d.body : "",
      tag: typeof d.tag === "string" ? d.tag : undefined,
      renotify: typeof d.tag === "string",
      requireInteraction: d.urgent === true,
      icon: "/vault.png",
      data: { url: typeof d.url === "string" ? d.url : "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = new URL("/", self.location.origin);
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
    if (u.origin === self.location.origin) target = u; // never open another site from a push
  } catch {}
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        const u = new URL(w.url);
        if (u.pathname + u.search === target.pathname + target.search && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(target.href);
    })()
  );
});

// The browser replaced the subscription: tell the server, so this device keeps its vault alerts.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      if (!old) return;
      const sub =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey }).catch(() => null));
      if (!sub) return;
      await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rotate", oldEndpoint: old.endpoint, subscription: sub.toJSON() }),
      }).catch(() => {});
    })()
  );
});
