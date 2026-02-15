import webpush from "web-push";
import { config } from "./config.js";
import { Notification, PushSubscriptionRecord } from "./types.js";

const hasConfiguredVapidKeys =
  typeof config.AXIS_VAPID_PUBLIC_KEY === "string" &&
  config.AXIS_VAPID_PUBLIC_KEY.length > 0 &&
  typeof config.AXIS_VAPID_PRIVATE_KEY === "string" &&
  config.AXIS_VAPID_PRIVATE_KEY.length > 0;

const vapidKeys: { publicKey: string; privateKey: string } = hasConfiguredVapidKeys
  ? {
      publicKey: config.AXIS_VAPID_PUBLIC_KEY!,
      privateKey: config.AXIS_VAPID_PRIVATE_KEY!
    }
  : webpush.generateVAPIDKeys();

webpush.setVapidDetails(config.AXIS_VAPID_SUBJECT, vapidKeys.publicKey, vapidKeys.privateKey);

export interface PushSendResult {
  delivered: boolean;
  shouldDropSubscription: boolean;
  statusCode?: number;
  error?: string;
}

export function getVapidPublicKey(): string {
  return vapidKeys.publicKey;
}

export function hasStaticVapidKeys(): boolean {
  return hasConfiguredVapidKeys;
}

export async function sendPushNotification(
  subscription: PushSubscriptionRecord,
  notification: Pick<Notification, "title" | "message" | "priority" | "source" | "timestamp">
): Promise<PushSendResult> {
  const payload = JSON.stringify({
    title: notification.title,
    message: notification.message,
    priority: notification.priority,
    source: notification.source,
    timestamp: notification.timestamp
  });

  try {
    await webpush.sendNotification(subscription, payload);
    return {
      delivered: true,
      shouldDropSubscription: false
    };
  } catch (error) {
    const statusCode = readStatusCode(error);

    return {
      delivered: false,
      shouldDropSubscription: statusCode === 404 || statusCode === 410,
      statusCode,
      error: error instanceof Error ? error.message : "Failed to deliver push notification"
    };
  }
}

function readStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }

  return undefined;
}
