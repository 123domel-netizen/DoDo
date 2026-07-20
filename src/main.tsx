import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import "@/index.css";
import { initThemeEarly } from "@/lib/theme";
import { initCloudSync } from "@/lib/cloud";
import { initChat } from "@/lib/chat/init";
import { initNavigation } from "@/lib/navigation";

// In dev, purge any service worker + caches left over from a previous PWA build
// so we never serve stale assets (this is the usual "I don't see my changes" bug).
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
  if ("caches" in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
}

initThemeEarly();
initCloudSync();
initNavigation();
initChat();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
