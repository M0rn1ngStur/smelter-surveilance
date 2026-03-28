import { useRef, useState, useEffect, useCallback } from 'react';
import type { ConnectionState } from '../types';
import { registerInput, unregisterInput, sendBeaconDisconnect, sendSdp } from '../api/client';
import { ICE_SERVERS, waitForIceGathering, preferBaselineH264 } from '../lib/webrtc';

export function useWhipSender(clientId: string, slotIndex: number) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputIdRef = useRef<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inputId, setInputId] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
  }, []);

  const closePc = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  const disconnect = useCallback(async (skipServer = false) => {
    closePc();
    stopStream();
    if (inputIdRef.current) {
      if (!skipServer) {
        try {
          await unregisterInput(inputIdRef.current);
        } catch {
          // best effort
        }
      }
      inputIdRef.current = null;
      setInputId(null);
    }
    setConnectionState('disconnected');
  }, [closePc, stopStream]);

  const connect = useCallback(async () => {
    closePc();
    stopStream();
    if (inputIdRef.current) {
      try { await unregisterInput(inputIdRef.current); } catch { /* best effort */ }
      inputIdRef.current = null;
      setInputId(null);
    }
    setError(null);
    setConnectionState('connecting');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera cannot be accessed — HTTPS is required');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
      }

      const { inputId: id, whipUrl, bearerToken } = await registerInput(clientId, slotIndex);
      inputIdRef.current = id;
      setInputId(id);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      const transceiver = pc.addTransceiver(stream.getVideoTracks()[0], {
        direction: 'sendonly',
        streams: [stream],
      });
      preferBaselineH264(transceiver);

      pc.onconnectionstatechange = () => {
        switch (pc.connectionState) {
          case 'connected':
            setConnectionState('connected');
            break;
          case 'failed':
          case 'disconnected':
            setConnectionState('failed');
            break;
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      if (pcRef.current !== pc) return;

      const answerSdp = await sendSdp(whipUrl, pc.localDescription!.sdp, bearerToken);

      if (pcRef.current !== pc) return;

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      setConnectionState('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConnectionState('failed');
      // Only close the PC, keep the camera preview alive
      closePc();
    }
  }, [closePc, stopStream]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (inputIdRef.current) {
        sendBeaconDisconnect(inputIdRef.current);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (inputIdRef.current) {
        sendBeaconDisconnect(inputIdRef.current);
        inputIdRef.current = null;
      }
      closePc();
      stopStream();
    };
  }, [closePc, stopStream]);

  return { previewRef, connectionState, error, inputId, connect, disconnect };
}
