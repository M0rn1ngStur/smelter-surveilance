import { useState } from 'react';
import { unregisterInput } from '../api/client';
import type { InputInfo } from '../types';

interface ConnectedCamerasListProps {
  inputs: InputInfo[];
  motionScores: Record<string, number>;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function MotionBar({ score }: { score: number }) {
  const clampedScore = Math.min(100, Math.max(0, score));
  const color =
    clampedScore > 50 ? 'bg-red-500' : clampedScore > 20 ? 'bg-amber-500' : 'bg-cyan-500';

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${clampedScore}%` }}
        />
      </div>
      <span className="w-14 text-right font-mono text-sm text-slate-300">
        {score.toFixed(1)}%
      </span>
    </div>
  );
}

export function ConnectedCamerasList({ inputs, motionScores }: ConnectedCamerasListProps) {
  const [disconnecting, setDisconnecting] = useState<Set<string>>(new Set());

  const handleDisconnect = async (inputId: string) => {
    setDisconnecting((prev) => new Set(prev).add(inputId));
    try {
      await unregisterInput(inputId);
    } catch {
      // will disappear from list on next poll anyway
    } finally {
      setDisconnecting((prev) => {
        const next = new Set(prev);
        next.delete(inputId);
        return next;
      });
    }
  };

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Podłączone kamery{' '}
          <span className="text-sm font-normal text-slate-400">({inputs.length})</span>
        </h2>
      </div>

      {inputs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sentinel-border p-8 text-center text-sm text-slate-500">
          Brak podłączonych kamer
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {inputs.map((input) => {
            const score = motionScores[input.inputId];
            const hasMotion = score != null && score > 5;

            return (
              <div
                key={input.inputId}
                className={`rounded-xl border p-4 transition ${
                  hasMotion
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-sentinel-border bg-sentinel-card'
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-cyan-500" />
                    <span className="text-sm font-medium text-white">
                      Kamera {input.inputId.slice(-6)}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    od {formatTime(input.connectedAt)}
                  </span>
                </div>

                {score != null ? (
                  <MotionBar score={score} />
                ) : (
                  <div className="text-xs text-slate-500">Oczekiwanie na dane...</div>
                )}

                <button
                  onClick={() => handleDisconnect(input.inputId)}
                  disabled={disconnecting.has(input.inputId)}
                  className="mt-3 w-full rounded border border-red-400/30 px-2.5 py-1 text-xs text-red-400 transition hover:bg-red-400/10 disabled:opacity-50"
                >
                  {disconnecting.has(input.inputId) ? 'Rozłączanie...' : 'Rozłącz'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
