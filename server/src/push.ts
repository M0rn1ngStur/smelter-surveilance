import webpush from 'web-push';
import { dbGetSetting, dbSetSetting, dbLoadPushSubscriptions, dbDeletePushSubscription } from './db';

let vapidPublicKey = '';
let vapidPrivateKey = '';

export function initPush(): void {
  vapidPublicKey = dbGetSetting('vapidPublicKey') ?? '';
  vapidPrivateKey = dbGetSetting('vapidPrivateKey') ?? '';

  if (!vapidPublicKey || !vapidPrivateKey) {
    const keys = webpush.generateVAPIDKeys();
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
    dbSetSetting('vapidPublicKey', vapidPublicKey);
    dbSetSetting('vapidPrivateKey', vapidPrivateKey);
    console.log('[push] Generated new VAPID keys');
  }

  webpush.setVapidDetails(
    'mailto:alert@smelter-surveilance.local',
    vapidPublicKey,
    vapidPrivateKey
  );

  console.log('[push] Web Push initialized');
}

export function getVapidPublicKey(): string {
  return vapidPublicKey;
}

export async function sendPushToAll(payload: { title: string; body: string; tag: string }): Promise<void> {
  const subs = dbLoadPushSubscriptions();

  for (const subJson of subs) {
    try {
      const subscription = JSON.parse(subJson);
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      // 410 Gone or 404 = subscription expired, remove it
      if (statusCode === 410 || statusCode === 404) {
        try {
          const sub = JSON.parse(subJson);
          dbDeletePushSubscription(sub.endpoint);
          console.log('[push] Removed expired subscription');
        } catch { /* ignore */ }
      } else {
        console.error('[push] Failed to send notification:', err);
      }
    }
  }
}
