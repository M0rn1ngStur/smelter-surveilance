import type { RecordingInfo } from '../types';

const notifiedRecordings = new Set<string>();
let initialized = false;

export async function requestNotificationPermission(): Promise<void> {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
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
