import { useEffect, useRef } from 'react';
import { useWhipSender } from '../hooks/useWhipSender';
import { StatusBadge } from './StatusBadge';

interface CameraInputProps {
  onConnected: (inputId: string) => void;
  onDisconnected: () => void;
  onRegisterDisconnect: (handler: () => void) => void;
  motionScore?: number;
}

export function CameraInput({ onConnected, onDisconnected, onRegisterDisconnect, motionScore }: CameraInputProps) {
  const { previewRef, connectionState, error, inputId, connect, disconnect } = useWhipSender();
  const prevStateRef = useRef(connectionState);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Register local cleanup so parent can force-disconnect when server removes this input
  useEffect(() => {
    onRegisterDisconnect(() => {
      disconnect(true); // skip server call — already removed server-side
    });
  }, [disconnect, onRegisterDisconnect]);

  // Notify parent when connection state changes to 'connected'
  useEffect(() => {
    if (prevStateRef.current !== 'connected' && connectionState === 'connected' && inputId) {
      onConnected(inputId);
    }
    prevStateRef.current = connectionState;
  }, [connectionState, inputId, onConnected]);

  const handleDisconnect = async () => {
    await disconnect();
    onDisconnected();
  };

  return (
    <div className="w-full overflow-hidden rounded-xl border border-sentinel-border bg-sentinel-card md:w-72 md:flex-shrink-0">
      <div className="relative">
        <video
          ref={previewRef}
          autoPlay
          muted
          playsInline
          className="aspect-video w-full bg-black"
        />
        <div className="absolute left-2 top-2">
          <StatusBadge state={connectionState} />
        </div>
        {motionScore != null && connectionState === 'connected' && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 font-mono text-xs text-cyan-400">
            Motion: {motionScore}%
          </span>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-sentinel-border p-3">
        <span className="truncate text-sm text-slate-300">
          Kamera {inputId ? inputId.slice(-6) : '...'}
        </span>
        <button
          onClick={handleDisconnect}
          className="rounded border border-red-400/30 px-2.5 py-1 text-xs text-red-400 transition hover:bg-red-400/10"
        >
          Rozłącz
        </button>
      </div>
      {error && <p className="px-3 pb-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
