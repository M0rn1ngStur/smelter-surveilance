import { useState, useCallback, useEffect, useRef } from 'react';
import { CameraInput } from './CameraInput';
import { AddCameraButton } from './AddCameraButton';
import type { InputInfo } from '../types';

const STORAGE_KEY = 'sentinel_camera_count';
const MAX_CAMERAS = 4;
let nextSlotId = 0;

function createSlots(count: number): string[] {
  return Array.from({ length: count }, () => `slot_${nextSlotId++}`);
}

interface CameraInputListProps {
  onCamerasChanged: () => void;
  motionScores: Record<string, number>;
  connectedInputs: InputInfo[];
}

export function CameraInputList({ onCamerasChanged, motionScores, connectedInputs }: CameraInputListProps) {
  const [slots, setSlots] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const count = saved ? parseInt(saved, 10) : 0;
    return count > 0 ? createSlots(count) : [];
  });
  const [slotInputIds, setSlotInputIds] = useState<Record<string, string>>({});
  const disconnectHandlers = useRef<Record<string, () => void>>({});
  const confirmedByServer = useRef<Set<string>>(new Set());

  // Persist camera count
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(slots.length));
  }, [slots.length]);

  const addCamera = useCallback(() => {
    setSlots((prev) => {
      if (prev.length >= MAX_CAMERAS) return prev;
      return [...prev, `slot_${nextSlotId++}`];
    });
  }, []);

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

  // When a local camera's inputId disappears from server, force-disconnect it
  useEffect(() => {
    const serverIds = new Set(connectedInputs.map((i) => i.inputId));

    // Track which inputIds the server has confirmed at least once
    for (const id of serverIds) {
      confirmedByServer.current.add(id);
    }

    const slotsToRemove: string[] = [];

    for (const [slotId, inputId] of Object.entries(slotInputIds)) {
      // Only disconnect if the server previously confirmed this input and it's now gone.
      // Skip inputs the server hasn't acknowledged yet (poll hasn't caught up).
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

  const emptySlots = MAX_CAMERAS - slots.length;

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Kamery{' '}
          <span className="text-sm font-normal text-slate-400">({slots.length}/{MAX_CAMERAS})</span>
        </h2>
      </div>
      <div className="flex gap-4 flex-col md:flex-row md:overflow-x-auto md:pb-2">
        {slots.map((slotId) => (
          <CameraInput
            key={slotId}
            onConnected={(inputId) => handleConnected(slotId, inputId)}
            onDisconnected={() => removeCamera(slotId)}
            onRegisterDisconnect={(handler) => registerDisconnectHandler(slotId, handler)}
            motionScore={slotInputIds[slotId] ? motionScores[slotInputIds[slotId]] : undefined}
          />
        ))}
        {Array.from({ length: emptySlots }, (_, i) => (
          <AddCameraButton key={`empty_${i}`} onClick={addCamera} />
        ))}
      </div>
    </div>
  );
}
