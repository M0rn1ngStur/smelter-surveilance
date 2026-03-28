import path from 'path';
import fs from 'fs';
import { InputStream, View } from '@swmansion/smelter';
import { SmelterInstance } from './smelter';
import { analyzeRecording, getAllAnalyses, isAutoDeleteEnabled } from './gemini';
import {
  dbInsertSegment,
  dbUpdateSegmentEnd,
  dbMarkSegmentMotion,
  dbLoadSegments,
  dbDeleteSegment,
  dbGetSetting,
  dbSetSetting,
} from './db';

const DEFAULT_SEGMENT_DURATION_MS = 60_000;
let segmentDurationMs = DEFAULT_SEGMENT_DURATION_MS;
let motionThreshold = 0.5;
let recordingEnabled = false;

const RECORDING_RESOLUTION = { width: 640, height: 480 };
const RECORDINGS_DIR = path.join(__dirname, '..', 'recordings');

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

interface SegmentState {
  outputId: string;
  filePath: string;
  filename: string;
  inputId: string;
  startedAt: number;
  hasMotion: boolean;
  motionMarkedInDb: boolean;
  rotationTimer: ReturnType<typeof setTimeout>;
}

interface CameraPipeline {
  inputId: string;
  currentSegment: SegmentState | null;
  rotating: boolean;
}

const pipelines = new Map<string, CameraPipeline>();
const completedSegments: RecordingInfo[] = [];

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

export function initRecorder(): void {
  const saved = dbLoadSegments();
  for (const row of saved) {
    if (!row.durationMs) continue; // skip incomplete segments
    const rec: RecordingInfo = {
      filename: row.filename,
      inputId: row.inputId,
      timestamp: row.startTimestamp,
      durationMs: row.durationMs,
    };
    if (row.description && row.severity && row.analyzedAt) {
      rec.analysis = { description: row.description, severity: row.severity, analyzedAt: row.analyzedAt };
    }
    completedSegments.push(rec);
  }

  const savedEnabled = dbGetSetting('recordingEnabled');
  if (savedEnabled !== undefined) recordingEnabled = savedEnabled === 'true';

  const savedThreshold = dbGetSetting('motionThreshold');
  if (savedThreshold !== undefined) motionThreshold = parseFloat(savedThreshold);

  const savedDuration = dbGetSetting('segmentDurationMs');
  if (savedDuration !== undefined) segmentDurationMs = parseInt(savedDuration, 10);

  console.log(`[recorder] Loaded ${completedSegments.length} segments from database (segment duration: ${segmentDurationMs / 1000}s)`);
}

async function startNewSegment(inputId: string): Promise<SegmentState> {
  const timestamp = Date.now();
  const filename = `${inputId}_${timestamp}.mp4`;
  const filePath = path.join(RECORDINGS_DIR, filename);
  const outputId = `seg_${inputId}_${timestamp}`;

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

  dbInsertSegment({ filename, inputId, startTimestamp: timestamp });

  const rotationTimer = setTimeout(() => rotateSegment(inputId), segmentDurationMs);

  const segment: SegmentState = {
    outputId,
    filePath,
    filename,
    inputId,
    startedAt: timestamp,
    hasMotion: false,
    motionMarkedInDb: false,
    rotationTimer,
  };

  console.log(`[recorder] Started segment ${filename}`);
  return segment;
}

async function finalizeSegment(segment: SegmentState): Promise<void> {
  clearTimeout(segment.rotationTimer);

  try {
    await SmelterInstance.unregisterOutput(segment.outputId);
  } catch {
    // output may already be gone
  }

  const durationMs = Date.now() - segment.startedAt;
  dbUpdateSegmentEnd(segment.filename, Date.now(), durationMs);

  completedSegments.push({
    filename: segment.filename,
    inputId: segment.inputId,
    timestamp: segment.startedAt,
    durationMs,
  });

  if (segment.hasMotion) {
    console.log(`[recorder] Segment ${segment.filename} completed (${durationMs}ms) — has motion, sending to analysis`);
    analyzeRecording(segment.filename, segment.filePath);
  } else {
    console.log(`[recorder] Segment ${segment.filename} completed (${durationMs}ms) — no motion, deleting`);
    try {
      fs.unlinkSync(segment.filePath);
      dbDeleteSegment(segment.filename);
    } catch {
      // file may already be gone
    }
  }
}

async function rotateSegment(inputId: string): Promise<void> {
  const pipeline = pipelines.get(inputId);
  if (!pipeline || pipeline.rotating) return;

  pipeline.rotating = true;
  const oldSegment = pipeline.currentSegment;

  try {
    // Start new segment BEFORE stopping old one — zero gap
    const newSegment = await startNewSegment(inputId);
    pipeline.currentSegment = newSegment;

    if (oldSegment) {
      await finalizeSegment(oldSegment);
    }
  } catch (err) {
    console.error(`[recorder] Rotation failed for ${inputId}:`, err);
  } finally {
    pipeline.rotating = false;
  }
}

export async function startRecordingForCamera(inputId: string): Promise<void> {
  if (!recordingEnabled) return;
  if (pipelines.has(inputId)) return;

  const pipeline: CameraPipeline = {
    inputId,
    currentSegment: null,
    rotating: false,
  };
  pipelines.set(inputId, pipeline);

  try {
    const segment = await startNewSegment(inputId);
    pipeline.currentSegment = segment;
    console.log(`[recorder] Pipeline started for ${inputId}`);
  } catch (err) {
    pipelines.delete(inputId);
    console.error(`[recorder] Failed to start pipeline for ${inputId}:`, err);
  }
}

async function stopPipeline(inputId: string): Promise<void> {
  const pipeline = pipelines.get(inputId);
  if (!pipeline) return;

  pipelines.delete(inputId);

  if (pipeline.currentSegment) {
    await finalizeSegment(pipeline.currentSegment);
  }

  console.log(`[recorder] Pipeline stopped for ${inputId}`);
}

export async function stopRecordingForCamera(inputId: string): Promise<void> {
  await stopPipeline(inputId);
}

export function handleMotionForRecording(inputId: string, score: number) {
  const pipeline = pipelines.get(inputId);
  if (!pipeline?.currentSegment) return;
  if (pipeline.rotating) return;

  if (score > motionThreshold && !pipeline.currentSegment.hasMotion) {
    pipeline.currentSegment.hasMotion = true;
    if (!pipeline.currentSegment.motionMarkedInDb) {
      pipeline.currentSegment.motionMarkedInDb = true;
      dbMarkSegmentMotion(pipeline.currentSegment.filename);
    }
  }
}

export function getRecordings(): RecordingInfo[] {
  const analyses = getAllAnalyses();
  return completedSegments
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
  stopPipeline(inputId);
}
