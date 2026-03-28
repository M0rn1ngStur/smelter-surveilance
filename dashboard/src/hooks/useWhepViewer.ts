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

  const connect = useCallback(async () => {
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

      const answerSdp = await sendSdp(whepUrl, pc.localDescription!.sdp);
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      setConnectionState('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConnectionState('failed');
      cleanup();
    }
  }, [cleanup]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return { videoRef, connectionState, error, connect };
}
