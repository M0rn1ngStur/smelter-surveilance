interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  threshold: number;
  onThresholdChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  recordingEnabled: boolean;
  onToggleRecording: () => void;
  autoDelete: boolean;
  onToggleAutoDelete: () => void;
  open: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  {
    id: 'monitoring',
    label: 'Monitoring',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M3.25 4A2.25 2.25 0 0 0 1 6.25v7.5A2.25 2.25 0 0 0 3.25 16h7.5A2.25 2.25 0 0 0 13 13.75v-7.5A2.25 2.25 0 0 0 10.75 4h-7.5ZM19 4.75a.75.75 0 0 0-1.28-.53l-3 3a.75.75 0 0 0-.22.53v4.5c0 .199.079.39.22.53l3 3a.75.75 0 0 0 1.28-.53V4.75Z" />
      </svg>
    ),
  },
  {
    id: 'recordings',
    label: 'Recordings',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path fillRule="evenodd" d="M1 4.75C1 3.784 1.784 3 2.75 3h14.5c.966 0 1.75.784 1.75 1.75v10.515a1.75 1.75 0 0 1-1.75 1.75h-1.5a.75.75 0 0 1-.53-.22L13.5 15.075l-1.72 1.72a.75.75 0 0 1-.53.22h-1.5a.75.75 0 0 1-.53-.22L7.5 15.075l-1.72 1.72a.75.75 0 0 1-.53.22h-1.5A1.75 1.75 0 0 1 2 15.265V14.5H1.75a.75.75 0 0 1 0-1.5H2V11.5H1.75a.75.75 0 0 1 0-1.5H2V8.5H1.75a.75.75 0 0 1 0-1.5H2V5.5H1.75A.75.75 0 0 1 1 4.75Z" clipRule="evenodd" />
      </svg>
    ),
  },
];

function SidebarContent({
  currentPage,
  onNavigate,
  threshold,
  onThresholdChange,
  recordingEnabled,
  onToggleRecording,
  autoDelete,
  onToggleAutoDelete,
}: Omit<SidebarProps, 'open' | 'onClose'>) {
  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 border-b border-sentinel-border px-5 py-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-6 w-6 text-cyan-400"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
        <span className="text-lg font-bold tracking-widest text-white">SENTINEL</span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              currentPage === item.id
                ? 'bg-cyan-500/10 text-cyan-400'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <hr className="mx-3 border-sentinel-border" />

      {/* Settings */}
      <div className="flex flex-col gap-5 px-5 py-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Settings</span>

        {/* Sensitivity */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Sensitivity</span>
            <span className="font-mono text-sm text-cyan-400">{threshold.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            value={threshold}
            onChange={onThresholdChange}
            className="h-1.5 w-full cursor-pointer accent-cyan-500"
          />
        </div>

        {/* Recording */}
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={recordingEnabled}
            onChange={onToggleRecording}
            className="h-4 w-4 accent-cyan-500"
          />
          <span className={`text-sm font-medium ${recordingEnabled ? 'text-cyan-400' : 'text-slate-400'}`}>
            Recording
          </span>
        </label>

        {/* Auto-delete */}
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={autoDelete}
            onChange={onToggleAutoDelete}
            className="h-4 w-4 accent-cyan-500"
          />
          <span className={`text-sm font-medium ${autoDelete ? 'text-cyan-400' : 'text-slate-400'}`}>
            Auto-delete
          </span>
        </label>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer */}
      <div className="border-t border-sentinel-border px-5 py-3">
        <span className="text-xs text-slate-600">Smelter Surveillance v1.0</span>
      </div>
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const { open, onClose, ...contentProps } = props;

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-shrink-0 lg:flex-col border-r border-sentinel-border bg-sentinel-card">
        <SidebarContent {...contentProps} />
      </aside>

      {/* Mobile/tablet overlay */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/60" onClick={onClose} />
          {/* Sidebar panel */}
          <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-sentinel-card shadow-xl">
            <button
              onClick={onClose}
              className="absolute right-3 top-4 rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
            <SidebarContent {...contentProps} />
          </aside>
        </div>
      )}
    </>
  );
}
