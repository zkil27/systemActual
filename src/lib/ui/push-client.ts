"use client";

export interface PushEnvironment {
  supported: boolean;
  isIos: boolean;
  isStandalone: boolean;
  needsHomeScreenInstall: boolean;
  permission: NotificationPermission | "unsupported";
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function detectPushEnvironment(): PushEnvironment {
  if (typeof window === "undefined") {
    return {
      supported: false,
      isIos: false,
      isStandalone: false,
      needsHomeScreenInstall: false,
      permission: "unsupported",
    };
  }
  const ua = navigator.userAgent || "";
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const hasApis =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  // iOS Safari exposes PushManager only after the site is added to the Home Screen.
  const needsHomeScreenInstall = isIos && !isStandalone;
  const permission: NotificationPermission | "unsupported" =
    "Notification" in window ? Notification.permission : "unsupported";

  return {
    supported: hasApis && !needsHomeScreenInstall,
    isIos,
    isStandalone,
    needsHomeScreenInstall,
    permission,
  };
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  return navigator.serviceWorker.ready.then(() => reg);
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg || !("pushManager" in reg)) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

async function saveSubscriptionToServer(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Browser returned an incomplete push subscription.");
  }
  const res = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: {
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      },
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || "Couldn't save notification settings.");
  }
}

export async function subscribeThisDevice(publicKey: string): Promise<PushSubscription> {
  const env = detectPushEnvironment();
  if (env.needsHomeScreenInstall) {
    throw new Error("Add Kyna Ops to your Home Screen first, then open it from there.");
  }
  if (!env.supported) {
    throw new Error("This browser doesn't support push notifications.");
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    throw new Error("Notifications were blocked. Allow them in your phone or browser settings.");
  }

  const reg = await ensureServiceWorker();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await saveSubscriptionToServer(sub);
  return sub;
}

export async function unsubscribeThisDevice(): Promise<void> {
  const sub = await getCurrentPushSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await fetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

let syncedThisLoad = false;

/**
 * Quietly keeps the service worker and an already-granted push subscription in
 * sync on owner app load. Never asks for permission.
 */
export function syncExistingSubscriptionOnce(): void {
  if (syncedThisLoad) return;
  syncedThisLoad = true;
  const env = detectPushEnvironment();
  if (!env.supported || env.permission !== "granted") return;

  void (async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg) return;
      void reg.update().catch(() => {});
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      await saveSubscriptionToServer(sub);
    } catch {
      // Best-effort refresh; never bother the user on page load.
    }
  })();
}
