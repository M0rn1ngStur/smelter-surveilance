import type { InputInfo, RecordingInfo } from '../types';

export async function registerInput(): Promise<{
  inputId: string;
  whipUrl: string;
  bearerToken: string;
}> {
  const res = await fetch('/connect', { method: 'POST' });
  if (!res.ok) throw new Error(`Register failed: ${res.status}`);
  return res.json();
}

export async function unregisterInput(inputId: string): Promise<void> {
  await fetch('/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputId }),
  });
}

export function sendBeaconDisconnect(inputId: string): void {
  navigator.sendBeacon(
    '/disconnect',
    new Blob([JSON.stringify({ inputId })], { type: 'application/json' })
  );
}

export async function getWhepUrl(): Promise<string> {
  const res = await fetch('/whep-url');
  if (!res.ok) throw new Error(`WHEP URL fetch failed: ${res.status}`);
  const { whepUrl } = await res.json();
  return whepUrl;
}

export async function listInputs(): Promise<InputInfo[]> {
  const res = await fetch('/api/inputs');
  if (!res.ok) throw new Error(`List inputs failed: ${res.status}`);
  const { inputs } = await res.json();
  return inputs;
}

export async function getMotionScores(): Promise<Record<string, number>> {
  const res = await fetch('/api/motion');
  if (!res.ok) throw new Error(`Motion scores fetch failed: ${res.status}`);
  const { scores } = await res.json();
  return scores;
}

export async function getRecordingEnabled(): Promise<boolean> {
  const res = await fetch('/api/recording-enabled');
  if (!res.ok) throw new Error(`Recording enabled fetch failed: ${res.status}`);
  const { enabled } = await res.json();
  return enabled;
}

export async function setRecordingEnabled(enabled: boolean): Promise<boolean> {
  const res = await fetch('/api/recording-enabled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`Set recording enabled failed: ${res.status}`);
  const data = await res.json();
  return data.enabled;
}

export async function getMotionThreshold(): Promise<number> {
  const res = await fetch('/api/motion-threshold');
  if (!res.ok) throw new Error(`Motion threshold fetch failed: ${res.status}`);
  const { threshold } = await res.json();
  return threshold;
}

export async function setMotionThreshold(threshold: number): Promise<number> {
  const res = await fetch('/api/motion-threshold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threshold }),
  });
  if (!res.ok) throw new Error(`Set motion threshold failed: ${res.status}`);
  const data = await res.json();
  return data.threshold;
}

export async function getAutoDeleteEnabled(): Promise<boolean> {
  const res = await fetch('/api/auto-delete');
  if (!res.ok) throw new Error(`Auto-delete fetch failed: ${res.status}`);
  const { enabled } = await res.json();
  return enabled;
}

export async function setAutoDeleteEnabled(enabled: boolean): Promise<boolean> {
  const res = await fetch('/api/auto-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`Set auto-delete failed: ${res.status}`);
  const data = await res.json();
  return data.enabled;
}

export async function getRecordings(): Promise<RecordingInfo[]> {
  const res = await fetch('/api/recordings');
  if (!res.ok) throw new Error(`Recordings fetch failed: ${res.status}`);
  const { recordings } = await res.json();
  return recordings;
}

export async function sendSdp(
  url: string,
  sdp: string,
  bearerToken?: string
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/sdp',
  };
  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: sdp,
  });

  if (!res.ok) throw new Error(`SDP exchange failed: ${res.status}`);
  return res.text();
}
