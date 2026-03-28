import type { RecordingInfo } from '../types';
import { getVapidPublicKey, subscribePush } from '../api/client';

const notifiedRecordings = new Set<string>();
let initialized = false;

export async function requestNotificationPermission(): Promise<void> {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }

  // Register service worker and subscribe to push notifications
  if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const existing = await registration.pushManager.getSubscription();
      if (!existing) {
        const publicKey = await getVapidPublicKey();
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
        await subscribePush(subscription);
        console.log('[push] Subscribed to push notifications');
      }
    } catch (err) {
      console.warn('[push] Failed to set up push notifications:', err);
    }
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function checkNewSeriousRecordings(recordings: RecordingInfo[]): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const seriousRecordings = recordings.filter(
    (r) => r.analysis?.severity === 'serious'
  );

  if (!initialized) {
    for (const rec of seriousRecordings) {
      notifiedRecordings.add(rec.filename);
    }
    initialized = true;
    return;
  }

  for (const rec of seriousRecordings) {
    if (notifiedRecordings.has(rec.filename)) continue;
    notifiedRecordings.add(rec.filename);

    new Notification('ALARM: Suspicious activity!', {
      body: rec.analysis!.description,
      tag: rec.filename,
      requireInteraction: true,
    });
  }
}
