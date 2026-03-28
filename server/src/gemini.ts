import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { dbInsertAnalysis, dbLoadAnalyses, dbGetSetting, dbSetSetting, dbDeleteRecording } from './db';

const VALID_SEVERITIES = ['funny', 'unimportant', 'moderate', 'serious'] as const;

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
  dbSetSetting('autoDeleteUnimportant', String(enabled));
  console.log(`[gemini] Auto-delete unimportant recordings: ${enabled}`);
}

export function initGemini(): void {
  const saved = dbLoadAnalyses();
  for (const [k, v] of saved) analysisResults.set(k, v);

  const savedAutoDelete = dbGetSetting('autoDeleteUnimportant');
  if (savedAutoDelete !== undefined) autoDeleteUnimportant = savedAutoDelete === 'true';

  console.log(`[gemini] Loaded ${saved.size} analyses from database`);
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

  const description = typeof parsed.description === 'string' ? parsed.description : 'No description';
  const severity = VALID_SEVERITIES.includes(parsed.severity) ? parsed.severity : 'moderate';

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
        text: `Analyze this home security camera video. You are turned on most often when owner isn't at home beware of suspicious activities. 
        Return a JSON object with exactly two fields:
          - "description": a brief description in English of what is happening in the recording (1-2 sentences)
          - "severity": exactly one of these values:
            - "funny" - amusing situation with a pet (e.g., cat doing something funny)
            - "unimportant" - pet walks by, nothing happens
            - "moderate" - pet destroyed something (knocked over a vase, tore a pillow, etc.)
            - "serious" - intruder detected in the house, unknown person

        Return ONLY valid JSON, no markdown, no additional text.`,
      },
    ]);

    // Delete uploaded file from Google servers
    await fileManager.deleteFile(file.name).catch(() => {});

    const responseText = result.response.text();
    const { description, severity } = parseResponse(responseText);

    const analyzedAt = Date.now();
    analysisResults.set(filename, { description, severity, analyzedAt });
    dbInsertAnalysis(filename, { description, severity, analyzedAt });

    console.log(`[gemini] Analysis complete for ${filename}: severity="${severity}"`);

    // Delete unimportant recordings to save space
    if (autoDeleteUnimportant && severity === 'unimportant') {
      try {
        fs.unlinkSync(filePath);
        dbDeleteRecording(filename);
        console.log(`[gemini] Deleted unimportant recording: ${filename}`);
      } catch {
        // file may already be gone
      }
    }
  } catch (err) {
    console.error(`[gemini] Analysis failed for ${filename}:`, err);
  }
}
