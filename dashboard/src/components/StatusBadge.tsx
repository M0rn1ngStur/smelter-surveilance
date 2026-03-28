import type { ConnectionState } from '../types';

const stateConfig: Record<ConnectionState, { color: string; label: string }> = {
  idle: { color: 'bg-slate-500', label: 'Idle' },
  connecting: { color: 'bg-amber-500', label: 'Connecting...' },
  connected: { color: 'bg-cyan-500', label: 'Connected' },
  failed: { color: 'bg-red-500', label: 'Error' },
  disconnected: { color: 'bg-slate-500', label: 'Disconnected' },
};

export function StatusBadge({ state }: { state: ConnectionState }) {
  const { color, label } = stateConfig[state];

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
