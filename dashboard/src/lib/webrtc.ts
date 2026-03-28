export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export const ICE_GATHERING_TIMEOUT = 5000;

/**
 * Prefer H.264 Constrained Baseline profile on a sender transceiver.
 * This avoids FFmpeg decoder issues with High profile streams from mobile.
 * Falls back gracefully if the browser doesn't support setCodecPreferences.
 */
export function preferBaselineH264(transceiver: RTCRtpTransceiver): void {
  if (!transceiver.setCodecPreferences) return;

  const capabilities = RTCRtpSender.getCapabilities?.('video');
  if (!capabilities) return;

  const baseline: RTCRtpCodecCapability[] = [];
  const other: RTCRtpCodecCapability[] = [];

  for (const codec of capabilities.codecs) {
    if (codec.mimeType === 'video/H264') {
      const profileLevelId = codec.sdpFmtpLine?.match(/profile-level-id=([0-9a-fA-F]{6})/)?.[1];
      if (profileLevelId && profileLevelId.substring(0, 2).toLowerCase() === '42') {
        baseline.push(codec);
      } else {
        other.push(codec);
      }
    } else {
      other.push(codec);
    }
  }

  // Put baseline first, then the rest as fallback
  if (baseline.length > 0) {
    try {
      transceiver.setCodecPreferences([...baseline, ...other]);
    } catch {
      // Some browsers may reject — ignore and use defaults
    }
  }
}

export function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, ICE_GATHERING_TIMEOUT);
  });
}
