// Kyna Ops Web Push service worker.
// Intentionally does NOT intercept or cache fetch requests so live warehouse data
// and <UpdatePrompt /> version checks are always fresh.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Kyna Ops",
    body: "You have a new update.",
    url: "/",
    tag: undefined,
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.title === "string" && parsed.title.trim()) payload.title = parsed.title.trim();
        if (typeof parsed.body === "string") payload.body = parsed.body.trim();
        if (typeof parsed.url === "string" && parsed.url.startsWith("/") && !parsed.url.startsWith("//")) {
          payload.url = parsed.url;
        }
        if (typeof parsed.tag === "string" && parsed.tag.trim()) payload.tag = parsed.tag.trim();
      }
    } catch {
      const text = event.data.text();
      if (text) payload.body = text.trim();
    }
  }

  const options = {
    body: payload.body,
    icon: "/icons/192.png",
    badge: "/icons/192.png",
    tag: payload.tag,
    renotify: Boolean(payload.tag),
    data: { url: payload.url },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification && event.notification.data && event.notification.data.url;
  const targetPath = typeof rawUrl === "string" && rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl : "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        try {
          const clientOrigin = new URL(client.url).origin;
          if (clientOrigin === self.location.origin && "focus" in client) {
            if ("navigate" in client && client.url !== targetUrl) {
              return client.navigate(targetUrl).then((navigated) => (navigated ? navigated.focus() : client.focus()));
            }
            return client.focus();
          }
        } catch {
          // Ignore malformed client URLs and fall through to openWindow.
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
