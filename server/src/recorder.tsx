import path from 'path';
import fs from 'fs';
import { InputStream, View } from '@swmansion/smelter';
import { SmelterInstance } from './smelter';
import { analyzeRecording, getAllAnalyses, isAutoDeleteEnabled } from './gemini';
import { dbInsertRecording, dbLoadRecordings, dbGetSetting, dbSetSetting } from './db';

const MIN_CLIP_DURATION = 3000;
const MAX_CLIP_DURATION = 5000;
let motionThreshold = 0.5;
const COOLDOWN_MS = 10_000;

const RECORDING_RESOLUTION = { width: 640, height: 480 };
const RECORDINGS_DIR = path.join(__dirname, '..', 'recordings');

interface RecordingState {
  outputId: string;
  filePath: string;
  startedAt: number;
  stopTimer: ReturnType<typeof setTimeout>;
}

export interface RecordingInfo {
  filename: string;
  inputId: string;
  timestamp: number;
  durationMs: number;
  analysis?: {
    description: string;
    severity: string;
    analyzedAt: number;
  };
}

const activeRecordings = new Map<string, RecordingState>();
const lastRecordingEnd = new Map<string, number>();
const completedRecordings: RecordingInfo[] = [];
let recordingEnabled = false;

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

export function initRecorder(): void {
  const saved = dbLoadRecordings();
  for (const row of saved) {
    const rec: RecordingInfo = {
      filename: row.filename,
      inputId: row.inputId,
      timestamp: row.timestamp,
      durationMs: row.durationMs,
    };
    if (row.description && row.severity && row.analyzedAt) {
      rec.analysis = { description: row.description, severity: row.severity, analyzedAt: row.analyzedAt };
    }
    completedRecordings.push(rec);
  }

  const savedEnabled = dbGetSetting('recordingEnabled');
  if (savedEnabled !== undefined) recordingEnabled = savedEnabled === 'true';

  const savedThreshold = dbGetSetting('motionThreshold');
  if (savedThreshold !== undefined) motionThreshold = parseFloat(savedThreshold);

  console.log(`[recorder] Loaded ${completedRecordings.length} recordings from database`);
}

async function startRecording(inputId: string) {
  const timestamp = Date.now();
  const filename = `${inputId}_${timestamp}.mp4`;
  const filePath = path.join(RECORDINGS_DIR, filename);
  const outputId = `rec_${inputId}_${timestamp}`;

  await SmelterInstance.registerOutput(
    outputId,
    <View style={{ backgroundColor: '#000000' }}>
      <InputStream inputId={inputId} />
    </View>,
    {
      type: 'mp4',
      serverPath: filePath,
      video: {
        resolution: RECORDING_RESOLUTION,
        encoder: {
          type: 'ffmpeg_h264',
          preset: 'fast',
        },
      },
    }
  );

  const stopTimer = setTimeout(() => stopRecording(inputId), MAX_CLIP_DURATION);

  activeRecordings.set(inputId, {
    outputId,
    filePath,
    startedAt: timestamp,
    stopTimer,
  });

  console.log(`[recorder] Started recording for ${inputId} → ${filename}`);
}

async function stopRecording(inputId: string) {
  const state = activeRecordings.get(inputId);
  if (!state) return;

  clearTimeout(state.stopTimer);
  activeRecordings.delete(inputId);
  lastRecordingEnd.set(inputId, Date.now());

  try {
    await SmelterInstance.unregisterOutput(state.outputId);
  } catch {
    // output may already be gone
  }

  const durationMs = Date.now() - state.startedAt;
  const filename = path.basename(state.filePath);

  completedRecordings.push({
    filename,
    inputId,
    timestamp: state.startedAt,
    durationMs,
  });

  dbInsertRecording({ filename, inputId, timestamp: state.startedAt, durationMs });

  console.log(`[recorder] Stopped recording for ${inputId} (${durationMs}ms) → ${filename}`);

  // Fire-and-forget: analyze recording with Gemini (queued sequentially)
  analyzeRecording(filename, state.filePath);
}

export function handleMotionForRecording(inputId: string, score: number) {
  const recording = activeRecordings.get(inputId);

  if (recording) {
    const elapsed = Date.now() - recording.startedAt;

    // Motion stopped and min duration reached → stop early
    if (score <= motionThreshold && elapsed >= MIN_CLIP_DURATION) {
      stopRecording(inputId);
      return;
    }

    // Motion continues → extend up to MAX, but timer already handles max
    return;
  }

  // Not recording — check if we should start
  if (!recordingEnabled) return;
  if (score <= motionThreshold) return;

  // Cooldown check
  const lastEnd = lastRecordingEnd.get(inputId) ?? 0;
  if (Date.now() - lastEnd < COOLDOWN_MS) return;

  startRecording(inputId).catch((err) =>
    console.error(`[recorder] Failed to start recording for ${inputId}:`, err)
  );
}

export function getRecordings(): RecordingInfo[] {
  const analyses = getAllAnalyses();
  return completedRecordings
    .filter((rec) => {
      const a = analyses.get(rec.filename);
      if (a && a.severity === 'unimportant' && isAutoDeleteEnabled()) return false;
      const filePath = path.join(RECORDINGS_DIR, rec.filename);
      return fs.existsSync(filePath);
    })
    .map((rec) => ({
      ...rec,
      analysis: analyses.get(rec.filename),
    }));
}

export function isRecordingEnabled(): boolean {
  return recordingEnabled;
}

export function setRecordingEnabled(enabled: boolean): void {
  recordingEnabled = enabled;
  dbSetSetting('recordingEnabled', String(enabled));
  console.log(`[recorder] Recording ${enabled ? 'enabled' : 'disabled'}`);
}

export function getMotionThreshold(): number {
  return motionThreshold;
}

export function setMotionThreshold(value: number): void {
  motionThreshold = Math.max(0, Math.min(1, value));
  dbSetSetting('motionThreshold', String(motionThreshold));
  console.log(`[recorder] Motion threshold set to ${motionThreshold}`);
}

export function cleanupRecordingsForInput(inputId: string) {
  const recording = activeRecordings.get(inputId);
  if (recording) {
    stopRecording(inputId);
  }
}
