import { useState, useCallback, useEffect, useRef } from 'react';
import { CameraInput } from './CameraInput';
import { AddCameraButton } from './AddCameraButton';
import { unregisterInput, connectServerVideo, renameInput } from '../api/client';
import { EditableName } from './EditableName';
import type { InputInfo } from '../types';

const MAX_CAMERAS = 4;
let nextSlotId = 0;

function getClientId(): string {
  let id = localStorage.getItem('smelter-client-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('smelter-client-id', id);
  }
  return id;
}

const clientId = getClientId();

interface CameraInputListProps {
  onCamerasChanged: () => void;
  motionScores: Record<string, number>;
  connectedInputs: InputInfo[];
}

export function CameraInputList({ onCamerasChanged, motionScores, connectedInputs }: CameraInputListProps) {
  const [slots, setSlots] = useState<string[]>([]);
  const [slotInputIds, setSlotInputIds] = useState<Record<string, string>>({});
  const [slotIndices, setSlotIndices] = useState<Record<string, number>>({});
  const nextSlotIndexRef = useRef(0);
  const disconnectHandlers = useRef<Record<string, () => void>>({});
  const confirmedByServer = useRef<Set<string>>(new Set());
  const didAutoRestore = useRef(false);

  const addCamera = useCallback(() => {
    setSlots((prev) => {
      if (prev.length >= MAX_CAMERAS) return prev;
      const slotId = `slot_${nextSlotId++}`;
      const idx = nextSlotIndexRef.current++;
      setSlotIndices((si) => ({ ...si, [slotId]: idx }));
      return [...prev, slotId];
    });
  }, []);

  // Auto-restore camera slots from previous session
  useEffect(() => {
    if (didAutoRestore.current) return;
    didAutoRestore.current = true;
    const saved = parseInt(localStorage.getItem('smelter-slot-count') ?? '0', 10);
    for (let i = 0; i < Math.min(saved, MAX_CAMERAS); i++) {
      addCamera();
    }
  }, [addCamera]);

  // Persist slot count
  useEffect(() => {
    localStorage.setItem('smelter-slot-count', String(slots.length));
  }, [slots.length]);

  const handleAddServerVideo = useCallback(async (filename: string) => {
    try {
      await connectServerVideo(filename);
      onCamerasChanged();
    } catch (err) {
      console.error('Failed to connect server video:', err);
    }
  }, [onCamerasChanged]);

  const removeCamera = useCallback((slotId: string) => {
    setSlots((prev) => prev.filter((s) => s !== slotId));
    setSlotInputIds((prev) => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
    onCamerasChanged();
  }, [onCamerasChanged]);

  const registerDisconnectHandler = useCallback((slotId: string, handler: () => void) => {
    disconnectHandlers.current[slotId] = handler;
  }, []);

  const handleConnected = useCallback((slotId: string, inputId: string) => {
    setSlotInputIds((prev) => ({ ...prev, [slotId]: inputId }));
    onCamerasChanged();
  }, [onCamerasChanged]);

  const handleRename = useCallback(async (inputId: string, name: string) => {
    try {
      await renameInput(inputId, name);
    } catch (err) {
      console.error('Failed to rename input:', err);
    }
  }, []);

  // When a local camera's inputId disappears from server, force-disconnect it
  useEffect(() => {
    const serverIds = new Set(connectedInputs.map((i) => i.inputId));

    for (const id of serverIds) {
      confirmedByServer.current.add(id);
    }

    const slotsToRemove: string[] = [];

    for (const [slotId, inputId] of Object.entries(slotInputIds)) {
      if (!serverIds.has(inputId) && confirmedByServer.current.has(inputId)) {
        slotsToRemove.push(slotId);
        confirmedByServer.current.delete(inputId);
        disconnectHandlers.current[slotId]?.();
      }
    }

    if (slotsToRemove.length > 0) {
      setSlots((prev) => prev.filter((s) => !slotsToRemove.includes(s)));
      setSlotInputIds((prev) => {
        const next = { ...prev };
        for (const slotId of slotsToRemove) {
          delete next[slotId];
          delete disconnectHandlers.current[slotId];
        }
        return next;
      });
      onCamerasChanged();
    }
  }, [connectedInputs, slotInputIds, onCamerasChanged]);

  // Remote inputs: connected on server but without a local camera slot
  const localInputIds = new Set(Object.values(slotInputIds));
  const remoteInputs = connectedInputs.filter((i) => !localInputIds.has(i.inputId));

  const [disconnecting, setDisconnecting] = useState<Set<string>>(new Set());

  const handleRemoteDisconnect = async (inputId: string) => {
    setDisconnecting((prev) => new Set(prev).add(inputId));
    try {
      await unregisterInput(inputId);
      onCamerasChanged();
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

  const totalInputs = slots.length + remoteInputs.length;
  const canAdd = totalInputs < MAX_CAMERAS;

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Inputs{' '}
          <span className="text-sm font-normal text-slate-400">({totalInputs}/{MAX_CAMERAS})</span>
        </h2>
      </div>
      <div className="flex flex-col gap-3">
        {/* Local camera slots (WebRTC from this browser) */}
        {slots.map((slotId) => {
          const inputId = slotInputIds[slotId];
          const serverInfo = inputId ? connectedInputs.find((i) => i.inputId === inputId) : undefined;
          return (
            <CameraInput
              key={slotId}
              clientId={clientId}
              slotIndex={slotIndices[slotId] ?? 0}
              name={serverInfo?.name ?? ''}
              onRename={(name) => inputId && handleRename(inputId, name)}
              onConnected={(id) => handleConnected(slotId, id)}
              onDisconnected={() => removeCamera(slotId)}
              onRegisterDisconnect={(handler) => registerDisconnectHandler(slotId, handler)}
              motionScore={inputId ? motionScores[inputId] : undefined}
            />
          );
        })}

        {/* Remote inputs (webcams from other tabs + server video files) */}
        {remoteInputs.map((input) => {
          const score = motionScores[input.inputId];
          const hasMotion = score != null && score > 5;
          const isVideo = input.source?.type === 'video';
          const defaultLabel = isVideo
            ? (input.source as { type: 'video'; filename: string }).filename
            : `Camera ${input.inputId.slice(-6)}`;

          return (
            <div
              key={input.inputId}
              className={`w-full overflow-hidden rounded-xl border ${
                hasMotion
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-sentinel-border bg-sentinel-card'
              }`}
            >
              <div className="relative flex aspect-video w-full items-center justify-center bg-black">
                {isVideo && (
                  <div className="absolute left-2 top-2">
                    <span className="rounded bg-purple-500/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      FILE
                    </span>
                  </div>
                )}
                {score != null ? (
                  <div className="w-3/4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            score > 50 ? 'bg-red-500' : score > 20 ? 'bg-amber-500' : 'bg-cyan-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                        />
                      </div>
                      <span className="w-14 text-right font-mono text-sm text-slate-300">
                        {score.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-slate-500">Waiting for data...</span>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-sentinel-border p-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${isVideo ? 'bg-purple-500' : 'bg-cyan-500'}`} />
                  <EditableName
                    name={input.name ?? ''}
                    placeholder={defaultLabel}
                    onRename={(name) => handleRename(input.inputId, name)}
                  />
                </div>
                <button
                  onClick={() => handleRemoteDisconnect(input.inputId)}
                  disabled={disconnecting.has(input.inputId)}
                  className="ml-2 shrink-0 rounded border border-red-400/30 px-2.5 py-1 text-xs text-red-400 transition hover:bg-red-400/10 disabled:opacity-50"
                >
                  {disconnecting.has(input.inputId) ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            </div>
          );
        })}

        {canAdd && (
          <AddCameraButton
            onAddCamera={addCamera}
            onAddServerVideo={handleAddServerVideo}
          />
        )}
      </div>
    </div>
  );
}
