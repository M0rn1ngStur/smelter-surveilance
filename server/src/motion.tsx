import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import path from 'path';
import { InputStream, View } from '@swmansion/smelter';
import { SmelterInstance } from './smelter';
import { updateFocus, handleDisconnect } from './focusStore';
import { handleMotionForRecording, cleanupRecordingsForInput } from './recorder';

const BASE_RTP_PORT = 10_000;
const MOTION_RESOLUTION = { width: 320, height: 240 };

let nextPort = BASE_RTP_PORT;
const motionOutputs = new Map<string, { port: number; outputId: string }>();
const motionScores = new Map<string, number>();

let onScoreCallback: ((inputId: string) => void) | null = null;

export function onMotionScore(cb: (inputId: string) => void) {
  onScoreCallback = cb;
}

let pythonProcess: ChildProcess | null = null;

function ensurePythonProcess() {
  if (pythonProcess && pythonProcess.exitCode === null) return;

  const scriptPath = path.join(__dirname, '..', 'motion_detector.py');
  pythonProcess = spawn('python3', [scriptPath, '--server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  pythonProcess.on('error', (err) => {
    console.error('[motion] Python process error:', err.message);
  });

  pythonProcess.on('exit', (code) => {
    console.log(`[motion] Python process exited with code ${code}`);
    pythonProcess = null;
  });

  const rl = readline.createInterface({ input: pythonProcess.stdout! });
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'score') {
        motionScores.set(msg.inputId, msg.score);
        updateFocus(msg.inputId, msg.score);
        handleMotionForRecording(msg.inputId, msg.score);
        onScoreCallback?.(msg.inputId);
      }
    } catch {
      // ignore non-JSON lines
    }
  });

  pythonProcess.stderr!.on('data', (data: Buffer) => {
    console.error(`[motion/py] ${data.toString().trim()}`);
  });
}

function sendCommand(cmd: object) {
  if (pythonProcess?.stdin?.writable) {
    pythonProcess.stdin.write(JSON.stringify(cmd) + '\n');
  }
}

export async function startMotionDetection(inputId: string) {
  ensurePythonProcess();

  const port = nextPort;
  nextPort += 2; // RTP uses even ports, RTCP uses odd
  const outputId = `motion_${inputId}`;

  await SmelterInstance.registerOutput(
    outputId,
    <View style={{ backgroundColor: '#000000' }}>
      <InputStream inputId={inputId} />
    </View>,
    {
      type: 'rtp_stream',
      port,
      ip: '127.0.0.1',
      transportProtocol: 'udp',
      video: {
        resolution: MOTION_RESOLUTION,
        encoder: {
          type: 'ffmpeg_h264',
          preset: 'ultrafast',
          ffmpegOptions: {
            tune: 'zerolatency',
            g: '15',            // keyframe every 15 frames
            'forced-idr': '1',
          },
        },
      },
    }
  );

  motionOutputs.set(inputId, { port, outputId });
  motionScores.set(inputId, 0);

  sendCommand({ action: 'add', inputId, port });
  console.log(`[motion] Started detection for ${inputId} on RTP port ${port}`);
}

export async function stopMotionDetection(inputId: string) {
  const entry = motionOutputs.get(inputId);
  if (!entry) return;

  sendCommand({ action: 'remove', inputId });

  try {
    await SmelterInstance.unregisterOutput(entry.outputId);
  } catch {
    // output may already be gone
  }

  motionOutputs.delete(inputId);
  motionScores.delete(inputId);
  cleanupRecordingsForInput(inputId);
  handleDisconnect(inputId);
  console.log(`[motion] Stopped detection for ${inputId}`);
}

export function getMotionScores(): Record<string, number> {
  return Object.fromEntries(motionScores);
}

export function shutdownMotion() {
  if (pythonProcess) {
    sendCommand({ action: 'shutdown' });
    pythonProcess.kill();
    pythonProcess = null;
  }
}
