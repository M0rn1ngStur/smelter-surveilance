import { useState, useCallback, useEffect } from 'react';
import { Viewer } from './Viewer';
import { CameraInputList } from './CameraInputList';
import { ConnectedCamerasList } from './ConnectedCamerasList';
import { useMotionScores } from '../hooks/useMotionScores';
import { useConnectedInputs } from '../hooks/useConnectedInputs';
import { getRecordingEnabled, setRecordingEnabled, getMotionThreshold, setMotionThreshold, getAutoDeleteEnabled, setAutoDeleteEnabled } from '../api/client';

export function Layout() {
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const [recordingEnabled, setRecordingEnabledState] = useState(false);
  const [autoDelete, setAutoDeleteState] = useState(true);
  const [threshold, setThresholdState] = useState(0.5);
  const motionScores = useMotionScores();
  const connectedInputs = useConnectedInputs();

  const handleCamerasChanged = useCallback(() => {
    setReconnectTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    getRecordingEnabled().then(setRecordingEnabledState).catch(console.error);
    getAutoDeleteEnabled().then(setAutoDeleteState).catch(console.error);
    getMotionThreshold().then(setThresholdState).catch(console.error);
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-wide text-white">LIVE MONITORING</h2>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Czułość</span>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={threshold}
              onChange={handleThresholdChange}
              className="h-1.5 w-28 cursor-pointer accent-cyan-500"
            />
            <span className="w-10 text-right text-sm font-mono text-cyan-400">{threshold.toFixed(2)}</span>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={recordingEnabled}
              onChange={handleToggleRecording}
              className="h-4 w-4 accent-cyan-500"
            />
            <span className={`text-sm font-medium ${recordingEnabled ? 'text-cyan-400' : 'text-slate-400'}`}>
              Nagrywanie
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={autoDelete}
              onChange={handleToggleAutoDelete}
              className="h-4 w-4 accent-cyan-500"
            />
            <span className={`text-sm font-medium ${autoDelete ? 'text-cyan-400' : 'text-slate-400'}`}>
              Usuń nieważne
            </span>
          </label>
        </div>
      </div>

      <Viewer reconnectTrigger={reconnectTrigger} />
      <ConnectedCamerasList inputs={connectedInputs} motionScores={motionScores} />
      <CameraInputList onCamerasChanged={handleCamerasChanged} motionScores={motionScores} connectedInputs={connectedInputs} />
    </main>
  );
}
