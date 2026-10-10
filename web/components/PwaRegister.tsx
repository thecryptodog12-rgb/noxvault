"use client";
import { useEffect } from "react";

/**
 * Registers /sw.js (production only) so /offline keeps working without a network, and adds
 * the web app manifest link. Renders nothing.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (!document.querySelector('link[rel="manifest"]')) {
      const l = document.createElement("link");
      l.rel = "manifest";
      l.href = "/manifest.webmanifest";
      document.head.appendChild(l);
    }
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // Dev chunk names are not content-hashed: never let a leftover worker serve stale code.
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // Refresh the offline copy whenever the app is opened online.
        if (navigator.onLine) (reg.active ?? reg.installing ?? reg.waiting)?.postMessage("precache");
      })
      .catch(() => {});
  }, []);
  return null;
}
