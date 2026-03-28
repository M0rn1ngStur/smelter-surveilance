import { useSyncExternalStore } from 'react';

const NOISE_THRESHOLD = 0.5;
const COOLDOWN_MS = 3000;
const DOMINANCE_FACTOR = 2.0;

let focusedInputId: string | null = null;
let lastSwitchTime = 0;
const latestScores = new Map<string, number>();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return focusedInputId;
}

export function useFocusedInputId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function updateFocus(inputId: string, score: number) {
  latestScores.set(inputId, score);

  if (score <= NOISE_THRESHOLD) return;

  // First camera with motion above threshold becomes focused
  if (focusedInputId === null) {
    focusedInputId = inputId;
    lastSwitchTime = Date.now();
    emitChange();
    return;
  }

  // Already focused
  if (focusedInputId === inputId) return;

  // Cooldown check
  if (Date.now() - lastSwitchTime < COOLDOWN_MS) return;

  const currentScore = latestScores.get(focusedInputId) ?? 0;

  // Switch if current focused camera is quiet OR new camera dominates
  if (currentScore <= NOISE_THRESHOLD || score >= currentScore * DOMINANCE_FACTOR) {
    focusedInputId = inputId;
    lastSwitchTime = Date.now();
    emitChange();
  }
}

export function handleDisconnect(inputId: string) {
  latestScores.delete(inputId);
  if (focusedInputId === inputId) {
    focusedInputId = null;
    emitChange();
  }
}
