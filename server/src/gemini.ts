import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';

const VALID_SEVERITIES = ['śmieszny', 'nie ważny', 'średnio ważny', 'poważny'] as const;

export interface AnalysisResult {
  description: string;
  severity: string;
  analyzedAt: number;
}

const analysisResults = new Map<string, AnalysisResult>();

let autoDeleteUnimportant = true;

export function isAutoDeleteEnabled(): boolean {
  return autoDeleteUnimportant;
}

export function setAutoDelete(enabled: boolean): void {
  autoDeleteUnimportant = enabled;
  console.log(`[gemini] Auto-delete unimportant recordings: ${enabled}`);
}

// Simple sequential queue to avoid hitting Gemini rate limits
let queueTail = Promise.resolve();

function enqueue(fn: () => Promise<void>): void {
  queueTail = queueTail.then(fn, fn);
}

export function getAnalysis(filename: string): AnalysisResult | undefined {
  return analysisResults.get(filename);
}

export function getAllAnalyses(): Map<string, AnalysisResult> {
  return analysisResults;
}

function parseResponse(text: string): { description: string; severity: string } {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);

  const description = typeof parsed.description === 'string' ? parsed.description : 'Brak opisu';
  const severity = VALID_SEVERITIES.includes(parsed.severity) ? parsed.severity : 'średnio ważny';

  return { description, severity };
}

export function analyzeRecording(filename: string, filePath: string): void {
  enqueue(() => doAnalyze(filename, filePath));
}

async function doAnalyze(filename: string, filePath: string): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your-gemini-api-key-here') {
    console.warn('[gemini] API key not configured, skipping analysis');
    return;
  }

  if (!fs.existsSync(filePath)) {
    console.warn(`[gemini] File not found, skipping analysis: ${filePath}`);
    return;
  }

  // Wait for file to be fully written (Smelter flushes asynchronously after unregisterOutput)
  let lastSize = -1;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!fs.existsSync(filePath)) break;
    const size = fs.statSync(filePath).size;
    if (size > 0 && size === lastSize) break;
    lastSize = size;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    console.warn(`[gemini] File is empty or missing, skipping analysis: ${filePath}`);
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const fileManager = new GoogleAIFileManager(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    console.log(`[gemini] Uploading ${filename} (${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`);

    let { file } = await fileManager.uploadFile(filePath, {
      mimeType: 'video/mp4',
      displayName: filename,
    });

    // Wait for video processing to complete
    while (file.state === 'PROCESSING') {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      file = await fileManager.getFile(file.name);
    }

    if (file.state !== 'ACTIVE') {
      console.error(`[gemini] File processing failed for ${filename}, state: ${file.state}`, file.error);
      return;
    }

    const result = await model.generateContent([
      {
        fileData: {
          mimeType: file.mimeType,
          fileUri: file.uri,
        },
      },
      {
        text: `Przeanalizuj ten filmik z kamery monitoringu domowego. Zwróć obiekt JSON z dokładnie dwoma polami:
- "description": krótki opis po polsku co się dzieje na nagraniu (1-2 zdania)
- "severity": dokładnie jedna z tych wartości:
  - "śmieszny" - zabawna sytuacja ze zwierzakiem (np. kot robi coś śmiesznego)
  - "nie ważny" - zwierzak przechodzi, nic się nie dzieje
  - "średnio ważny" - zwierzak coś zniszczył (zbił wazon, rozdarł poduszkę itp.)
  - "poważny" - wykryto intruza w domu, nieznana osoba

Zwróć TYLKO poprawny JSON, bez markdown, bez dodatkowego tekstu.`,
      },
    ]);

    // Delete uploaded file from Google servers
    await fileManager.deleteFile(file.name).catch(() => {});

    const responseText = result.response.text();
    const { description, severity } = parseResponse(responseText);

    analysisResults.set(filename, {
      description,
      severity,
      analyzedAt: Date.now(),
    });

    console.log(`[gemini] Analysis complete for ${filename}: severity="${severity}"`);

    // Delete unimportant recordings to save space
    if (autoDeleteUnimportant && severity === 'nie ważny') {
      try {
        fs.unlinkSync(filePath);
        console.log(`[gemini] Deleted unimportant recording: ${filename}`);
      } catch {
        // file may already be gone
      }
    }
  } catch (err) {
    console.error(`[gemini] Analysis failed for ${filename}:`, err);
  }
}
