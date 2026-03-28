import { useEffect, useState, useRef } from 'react';
import { getRecordings } from '../api/client';
import type { RecordingInfo } from '../types';

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'śmieszny': return 'bg-yellow-500/20 text-yellow-300';
    case 'średnio ważny': return 'bg-orange-500/20 text-orange-300';
    case 'poważny': return 'bg-red-500/20 text-red-300';
    default: return 'bg-slate-500/20 text-slate-400';
  }
}

function RecordingCard({ recording }: { recording: RecordingInfo }) {
  const [expanded, setExpanded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!expanded && videoRef.current) {
      videoRef.current.pause();
    }
  }, [expanded]);

  return (
    <div className="overflow-hidden rounded-xl border border-sentinel-border bg-sentinel-card transition hover:border-slate-600">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-cyan-400">
            <path d="M3.25 4A2.25 2.25 0 0 0 1 6.25v7.5A2.25 2.25 0 0 0 3.25 16h7.5A2.25 2.25 0 0 0 13 13.75v-7.5A2.25 2.25 0 0 0 10.75 4h-7.5ZM19 4.75a.75.75 0 0 0-1.28-.53l-3 3a.75.75 0 0 0-.22.53v4.5c0 .199.079.39.22.53l3 3a.75.75 0 0 0 1.28-.53V4.75Z" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">
              Kamera {recording.inputId.slice(-6)}
            </span>
            <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">
              {formatDuration(recording.durationMs)}
            </span>
            {recording.analysis ? (
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${severityColor(recording.analysis.severity)}`}>
                {recording.analysis.severity}
              </span>
            ) : (
              <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-500 animate-pulse">
                Analizowanie...
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">{formatTimestamp(recording.timestamp)}</div>
        </div>

        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-sentinel-border px-4 py-3">
          <video
            ref={videoRef}
            src={`/api/recordings/${recording.filename}`}
            controls
            className="w-full rounded-lg bg-black"
          />
          {recording.analysis && (
            <p className="mt-2 text-sm text-slate-300">
              {recording.analysis.description}
            </p>
          )}
          <a
            href={`/api/recordings/${recording.filename}`}
            download
            className="mt-2 inline-flex items-center gap-1.5 rounded border border-cyan-400/30 px-2.5 py-1 text-xs text-cyan-400 transition hover:bg-cyan-400/10"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
            </svg>
            Pobierz
          </a>
        </div>
      )}
    </div>
  );
}

export function RecordingsList() {
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const data = await getRecordings();
        if (active) setRecordings(data);
      } catch {
        // silent
      } finally {
        if (active) setLoading(false);
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const sorted = [...recordings].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-wide text-white">NAGRANIA</h2>
        <span className="text-sm text-slate-400">{recordings.length} klip(y)</span>
      </div>

      {loading ? (
        <div className="rounded-xl border border-dashed border-sentinel-border p-12 text-center text-sm text-slate-500">
          Wczytywanie...
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sentinel-border p-12 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mx-auto mb-3 h-10 w-10 text-slate-600">
            <path d="M4.5 4.5a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h8.25a3 3 0 0 0 3-3v-9a3 3 0 0 0-3-3H4.5ZM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06Z" />
          </svg>
          <p className="text-sm text-slate-500">Brak nagranych klipow</p>
          <p className="mt-1 text-xs text-slate-600">
            Klipy pojawiaja sie automatycznie po wykryciu ruchu
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((rec) => (
            <RecordingCard key={rec.filename} recording={rec} />
          ))}
        </div>
      )}
    </main>
  );
}
