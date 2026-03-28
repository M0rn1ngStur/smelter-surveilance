import { useEffect, useRef } from 'react';
import { useWhepViewer } from '../hooks/useWhepViewer';
import { listInputs } from '../api/client';
import { StatusBadge } from './StatusBadge';

interface ViewerProps {
  reconnectTrigger: number;
}

export function Viewer({ reconnectTrigger }: ViewerProps) {
  const { videoRef, connectionState, error, connect } = useWhepViewer();
  const initialRef = useRef(true);
  const inputCountRef = useRef(-1);

  // Connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  // Reconnect when local cameras change (skip initial mount)
  useEffect(() => {
    if (initialRef.current) {
      initialRef.current = false;
      return;
    }
    const timer = setTimeout(() => connect(), 1000);
    return () => clearTimeout(timer);
  }, [reconnectTrigger, connect]);

  // Poll server for input changes from other devices
  useEffect(() => {
    const poll = async () => {
      try {
        const inputs = await listInputs();
        const count = inputs.length;
        if (inputCountRef.current !== -1 && count !== inputCountRef.current) {
          setTimeout(() => connect(), 1000);
        }
        inputCountRef.current = count;
      } catch {
        // ignore
      }
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [connect]);

  return (
    <div className="rounded-xl border border-sentinel-border bg-sentinel-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Camera Preview</h2>
        <div className="flex items-center gap-3">
          <StatusBadge state={connectionState} />
          <button
            onClick={connect}
            className="rounded bg-cyan-500 px-3 py-1 text-sm font-medium text-black hover:bg-cyan-600"
          >
            Refresh
          </button>
        </div>
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="aspect-video w-full rounded-lg border border-sentinel-border bg-black"
      />
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
