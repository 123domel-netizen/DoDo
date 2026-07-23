/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

declare const __APP_BUILD_VERSION__: string;

const BUILD =
  typeof __APP_BUILD_VERSION__ !== "undefined" && __APP_BUILD_VERSION__
    ? __APP_BUILD_VERSION__
    : "dev";
const HOST = self.location.hostname;
/** Osobny cache per host + build — preview nie dziedziczy produkcji. */
const CACHE = `dodo-pwa-${HOST}-${BUILD}`;
// vite-plugin-pwa (injectManifest) replaces this with the build asset list.
const ASSETS = (self.__WB_MANIFEST || []).map((e) => e.url);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/", ...ASSETS]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k !== CACHE &&
                (k.startsWith("kalendarz-todo-") ||
                  k.startsWith("dodo-pwa-") ||
                  k.startsWith("dodo-")),
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  // Nawigacje (index.html): network-first — po deployu użytkownik dostaje nową
  // wersję od razu, a cache służy tylko jako fallback offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/") as Promise<Response>),
    );
    return;
  }

  // Zasoby (hashowane pliki buildu): cache-first.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => caches.match("/") as Promise<Response>),
    ),
  );
});

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data && (event.data as { type?: string }).type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("push", (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  const title = data.title ?? "Przypomnienie";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [40, 60, 40],
      ...(data.tag ? { tag: data.tag, renotify: true } : {}),
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          (client as WindowClient).postMessage({ type: "navigate", url });
          return (client as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

export {};
