import path from 'path';
import fs from 'fs';
import type { Express } from 'express';
import express, { json, text } from 'express';
import cors from 'cors';
import { SmelterInstance } from './smelter';
import { startMotionDetection, stopMotionDetection, getMotionScores, onMotionScore } from './motion';
import { getRecordings, isRecordingEnabled, setRecordingEnabled, getMotionThreshold, setMotionThreshold } from './recorder';
import { isAutoDeleteEnabled, setAutoDelete } from './gemini';

export const app: Express = express();

const SMELTER_PORT = process.env.SMELTER_WHIP_WHEP_SERVER_PORT ?? '9000';
const SMELTER_URL = `http://127.0.0.1:${SMELTER_PORT}`;
const LOCAL_VIDEOS_DIR = path.join(__dirname, '..', 'local_videos');

interface ActiveInput {
  inputId: string;
  connectedAt: number;
  lastSeenAt: number;
  source: { type: 'webcam' } | { type: 'video'; filename: string };
  name?: string;
}

const activeInputs = new Map<string, ActiveInput>();

const STALE_INPUT_TIMEOUT_MS = 10_000;
const STALE_CHECK_INTERVAL_MS = 5_000;

async function cleanupInput(inputId: string) {
  await stopMotionDetection(inputId);
  try {
    await SmelterInstance.unregisterInput(inputId);
  } catch {
    // input may already be gone
  }
  activeInputs.delete(inputId);
  console.log(`[cleanup] Removed stale input ${inputId}`);
}

onMotionScore((inputId) => {
  const info = activeInputs.get(inputId);
  if (info) info.lastSeenAt = Date.now();
});

setInterval(() => {
  const now = Date.now();
  for (const [inputId, info] of activeInputs) {
    // Don't clean up server-side video inputs — only webcams go stale
    if (info.source.type === 'video') continue;
    if (now - info.lastSeenAt > STALE_INPUT_TIMEOUT_MS) {
      cleanupInput(inputId);
    }
  }
}, STALE_CHECK_INTERVAL_MS);

app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
app.use(json());
app.use(text({ type: 'application/sdp' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// POST /connect — register a WHIP server input for a new webcam
app.post('/connect', async (_req, res) => {
  const inputId = `webcam_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const result = await SmelterInstance.registerInput(inputId, {
    type: 'whip_server',
    video: {
      decoderPreferences: ['ffmpeg_h264'],
    },
  });

  activeInputs.set(inputId, { inputId, connectedAt: Date.now(), lastSeenAt: Date.now(), source: { type: 'webcam' } });

  startMotionDetection(inputId).catch((err) =>
    console.error(`[motion] Failed to start for ${inputId}:`, err)
  );

  res.json({
    inputId,
    whipUrl: `/api/whip/${inputId}`,
    bearerToken: result.bearerToken,
  });
});

// POST /connect-video — register a local video file as a Smelter input
app.post('/connect-video', async (req, res) => {
  const { filename } = req.body;
  if (!filename || typeof filename !== 'string') {
    res.status(400).json({ error: 'filename is required' });
    return;
  }

  const filePath = path.join(LOCAL_VIDEOS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Video file not found' });
    return;
  }

  const inputId = `video_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  await SmelterInstance.registerInput(inputId, {
    type: 'mp4',
    serverPath: filePath,
    loop: true,
  });

  activeInputs.set(inputId, {
    inputId,
    connectedAt: Date.now(),
    lastSeenAt: Date.now(),
    source: { type: 'video', filename },
  });

  startMotionDetection(inputId).catch((err) =>
    console.error(`[motion] Failed to start for ${inputId}:`, err)
  );

  res.json({ inputId });
});

// POST /disconnect — unregister a webcam input
app.post('/disconnect', async (req, res) => {
  const { inputId } = req.body;
  if (inputId) {
    await stopMotionDetection(inputId);
    try {
      await SmelterInstance.unregisterInput(inputId);
    } catch {
      // input may already be gone
    }
    activeInputs.delete(inputId);
  }
  res.json({});
});

// GET /api/inputs — list active inputs
app.get('/api/inputs', (_req, res) => {
  const inputs = Array.from(activeInputs.values()).map(({ inputId, connectedAt, source, name }) => ({
    inputId,
    connectedAt,
    source,
    name,
  }));
  res.json({ inputs });
});

// POST /api/inputs/:inputId/name — rename an input
app.post('/api/inputs/:inputId/name', (req, res) => {
  const info = activeInputs.get(req.params.inputId);
  if (!info) {
    res.status(404).json({ error: 'Input not found' });
    return;
  }
  const { name } = req.body;
  info.name = typeof name === 'string' ? name : undefined;
  res.json({ inputId: info.inputId, name: info.name });
});

// GET /api/motion — return motion detection scores for all inputs
app.get('/api/motion', (_req, res) => {
  res.json({ scores: getMotionScores() });
});

// GET /whep-url — return the WHEP viewer proxy URL
app.get('/whep-url', (_req, res) => {
  res.json({ whepUrl: `/api/whep/output_1` });
});

// GET /api/recording-enabled — check if recording is enabled
app.get('/api/recording-enabled', (_req, res) => {
  res.json({ enabled: isRecordingEnabled() });
});

// POST /api/recording-enabled — toggle recording on/off
app.post('/api/recording-enabled', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  setRecordingEnabled(enabled);
  res.json({ enabled: isRecordingEnabled() });
});

// GET /api/motion-threshold — get current motion threshold
app.get('/api/motion-threshold', (_req, res) => {
  res.json({ threshold: getMotionThreshold() });
});

// POST /api/motion-threshold — set motion threshold
app.post('/api/motion-threshold', (req, res) => {
  const { threshold } = req.body;
  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
    res.status(400).json({ error: 'threshold must be a number between 0 and 1' });
    return;
  }
  setMotionThreshold(threshold);
  res.json({ threshold: getMotionThreshold() });
});

// GET /api/auto-delete — check if auto-delete of unimportant recordings is enabled
app.get('/api/auto-delete', (_req, res) => {
  res.json({ enabled: isAutoDeleteEnabled() });
});

// POST /api/auto-delete — toggle auto-delete of unimportant recordings
app.post('/api/auto-delete', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  setAutoDelete(enabled);
  res.json({ enabled: isAutoDeleteEnabled() });
});

// GET /api/local-videos — list video files available on the server
app.get('/api/local-videos', (_req, res) => {
  try {
    const files = fs.readdirSync(LOCAL_VIDEOS_DIR).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return ['.mp4', '.webm', '.mkv', '.avi', '.mov'].includes(ext);
    });
    res.json({ videos: files });
  } catch {
    res.json({ videos: [] });
  }
});

// Serve local video files
app.use('/api/local-videos', express.static(LOCAL_VIDEOS_DIR));

// GET /api/recordings — list recorded motion clips
app.get('/api/recordings', (_req, res) => {
  res.json({ recordings: getRecordings() });
});

// GET /api/recordings/:filename — serve a recorded clip
app.use('/api/recordings', express.static(path.join(__dirname, '..', 'recordings')));

// SDP proxy: WHIP (browser → Smelter)
app.post('/api/whip/:inputId', async (req, res) => {
  const response = await fetch(`${SMELTER_URL}/whip/${req.params.inputId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sdp',
      ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
    },
    body: req.body as string,
  });

  const answerSdp = await response.text();
  res.status(response.status).type('application/sdp').send(answerSdp);
});

// SDP proxy: WHEP (browser → Smelter)
app.post('/api/whep/:outputId', async (req, res) => {
  const response = await fetch(`${SMELTER_URL}/whep/${req.params.outputId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sdp',
    },
    body: req.body as string,
  });

  const answerSdp = await response.text();
  res.status(response.status).type('application/sdp').send(answerSdp);
});
