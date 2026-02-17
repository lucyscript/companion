import { apiUrl } from "./config";

interface VapidPublicKeyResponse {
  publicKey: string;
}

export type PushEnableStatus = "enabled" | "unsupported" | "denied" | "error";

export interface PushEnableResult {
  status: PushEnableStatus;
  message?: string;
}

const serviceWorkerPath = `${import.meta.env.BASE_URL}sw.js`;

export function supportsPushNotifications(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function isPushEnabled(): Promise<boolean> {
  if (!supportsPushNotifications()) {
    return false;
  }

  const registration = await navigator.serviceWorker.getRegistration(serviceWorkerPath);

  if (!registration) {
    return false;
  }

  const existing = await registration.pushManager.getSubscription();
  return existing !== null;
}

export async function enablePushNotifications(): Promise<PushEnableResult> {
  if (!supportsPushNotifications()) {
    return {
      status: "unsupported",
      message: "Push notifications are not supported by this browser."
    };
  }

  const permission = await requestPermission();

  if (permission !== "granted") {
    return {
      status: "denied",
      message: "Notification permission was denied."
    };
  }

  try {
    const registration = await navigator.serviceWorker.register(serviceWorkerPath);
    const existing = await registration.pushManager.getSubscription();

    if (existing) {
      return {
        status: "enabled",
        message: "Push notifications are already enabled."
      };
    }

    const { publicKey } = await fetchJson<VapidPublicKeyResponse>("/api/push/vapid-public-key");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
    });

    await fetchJson<{ subscription: unknown }>("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription.toJSON())
    });

    return {
      status: "enabled",
      message: "Push notifications enabled."
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to enable push notifications."
    };
  }
}

async function requestPermission(): Promise<NotificationPermission> {
  if (Notification.permission !== "default") {
    return Notification.permission;
  }

  return Notification.requestPermission();
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const url = typeof input === "string" ? apiUrl(input) : input;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }

  return output;
}
