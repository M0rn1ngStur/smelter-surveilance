import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Viewer } from './components/Viewer';
import { CameraInputList } from './components/CameraInputList';
import { RecordingsList } from './components/RecordingsList';
import { useMotionScores } from './hooks/useMotionScores';
import { useConnectedInputs } from './hooks/useConnectedInputs';
import { requestNotificationPermission } from './lib/notifications';
import {
  getRecordingEnabled,
  setRecordingEnabled,
  getMotionThreshold,
  setMotionThreshold,
  getAutoDeleteEnabled,
  setAutoDeleteEnabled,
} from './api/client';

function App() {
  const [page, setPage] = useState('monitoring');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Settings state (lifted from Layout)
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const [recordingEnabled, setRecordingEnabledState] = useState(false);
  const [autoDelete, setAutoDeleteState] = useState(true);
  const [threshold, setThresholdState] = useState(0.5);
  const motionScores = useMotionScores();
  const connectedInputs = useConnectedInputs();

  useEffect(() => {
    requestNotificationPermission();
    getRecordingEnabled().then(setRecordingEnabledState).catch(console.error);
    getAutoDeleteEnabled().then(setAutoDeleteState).catch(console.error);
    getMotionThreshold().then(setThresholdState).catch(console.error);
  }, []);

  const handleCamerasChanged = useCallback(() => {
    setReconnectTrigger((n) => n + 1);
  }, []);

  const handleToggleRecording = useCallback(async () => {
    try {
      const newValue = await setRecordingEnabled(!recordingEnabled);
      setRecordingEnabledState(newValue);
    } catch (err) {
      console.error('Failed to toggle recording:', err);
    }
  }, [recordingEnabled]);

  const handleToggleAutoDelete = useCallback(async () => {
    try {
      const newValue = await setAutoDeleteEnabled(!autoDelete);
      setAutoDeleteState(newValue);
    } catch (err) {
      console.error('Failed to toggle auto-delete:', err);
    }
  }, [autoDelete]);

  const handleThresholdChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setThresholdState(value);
    try {
      await setMotionThreshold(value);
    } catch (err) {
      console.error('Failed to set motion threshold:', err);
    }
  }, []);

  const handleNavigate = useCallback((p: string) => {
    setPage(p);
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex h-full bg-sentinel-bg">
      {/* Left sidebar */}
      <Sidebar
        currentPage={page}
        onNavigate={handleNavigate}
        threshold={threshold}
        onThresholdChange={handleThresholdChange}
        recordingEnabled={recordingEnabled}
        onToggleRecording={handleToggleRecording}
        autoDelete={autoDelete}
        onToggleAutoDelete={handleToggleAutoDelete}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Center + right sidebar */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Top bar for mobile/tablet (< lg) */}
        <header className="flex items-center gap-3 border-b border-sentinel-border bg-sentinel-card px-4 py-2 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" clipRule="evenodd" />
            </svg>
          </button>
          <span className="text-sm font-bold tracking-widest text-white">SENTINEL</span>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {page === 'monitoring' && (
            <>
              <Viewer reconnectTrigger={reconnectTrigger} />
              {/* Cameras below viewer on mobile/tablet */}
              <div className="mt-4 lg:hidden">
                <CameraInputList
                  onCamerasChanged={handleCamerasChanged}
                  motionScores={motionScores}
                  connectedInputs={connectedInputs}
                />
              </div>
            </>
          )}
          {page === 'recordings' && <RecordingsList />}
        </main>

        {/* Right sidebar: cameras on desktop only */}
        {page === 'monitoring' && (
          <aside className="hidden lg:block lg:w-80 border-l border-sentinel-border bg-sentinel-card p-4 overflow-y-auto">
            <CameraInputList
              onCamerasChanged={handleCamerasChanged}
              motionScores={motionScores}
              connectedInputs={connectedInputs}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

export default App;
