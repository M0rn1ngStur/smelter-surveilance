import { useRef, useState, useEffect, useCallback } from 'react';
import type { ConnectionState } from '../types';
import { getWhepUrl, sendSdp } from '../api/client';
import { ICE_SERVERS, waitForIceGathering } from '../lib/webrtc';

export function useWhepViewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(async () => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    cleanup();
    setError(null);
    setConnectionState('connecting');

    try {
      const whepUrl = await getWhepUrl();

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        switch (pc.connectionState) {
          case 'connected':
            setConnectionState('connected');
            break;
          case 'failed':
          case 'disconnected':
            setConnectionState('failed');
            // Auto-retry after 2s
            retryTimer.current = setTimeout(() => connect(), 2000);
            break;
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      // Guard: if connect() was called again while we were waiting, abort
      if (pcRef.current !== pc) return;

      const answerSdp = await sendSdp(whepUrl, pc.localDescription!.sdp);

      if (pcRef.current !== pc) return;

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      setConnectionState('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConnectionState('failed');
      cleanup();
      // Auto-retry after 2s
      retryTimer.current = setTimeout(() => connect(), 2000);
    }
  }, [cleanup]);

  useEffect(() => {
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      cleanup();
    };
  }, [cleanup]);

  return { videoRef, connectionState, error, connect };
}
