export interface InputInfo {
  inputId: string;
  connectedAt: number;
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'failed' | 'disconnected';

export interface AnalysisResult {
  description: string;
  severity: string;
  analyzedAt: number;
}

export interface RecordingInfo {
  filename: string;
  inputId: string;
  timestamp: number;
  durationMs: number;
  analysis?: AnalysisResult;
}
