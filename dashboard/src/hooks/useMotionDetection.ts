import { useEffect, useRef, useState } from 'react';

const SAMPLE_INTERVAL_MS = 500;
const DIFF_THRESHOLD = 25;

export function useMotionDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean
) {
  const [motionScore, setMotionScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);

  useEffect(() => {
    if (!enabled) {
      setMotionScore(0);
      prevFrameRef.current = null;
      return;
    }

    const canvas = document.createElement('canvas');
    canvasRef.current = canvas;

    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) return;

      // Downsample for performance
      const scale = Math.min(1, 320 / w);
      const sw = Math.round(w * scale);
      const sh = Math.round(h * scale);

      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0, sw, sh);

      const imageData = ctx.getImageData(0, 0, sw, sh);
      const pixels = imageData.data;

      // Convert to grayscale in-place (store in R channel)
      const gray = new Uint8ClampedArray(sw * sh);
      for (let i = 0; i < gray.length; i++) {
        const off = i * 4;
        gray[i] = Math.round(pixels[off] * 0.299 + pixels[off + 1] * 0.587 + pixels[off + 2] * 0.114);
      }

      const prev = prevFrameRef.current;
      if (prev && prev.length === gray.length) {
        let changed = 0;
        for (let i = 0; i < gray.length; i++) {
          if (Math.abs(gray[i] - prev[i]) > DIFF_THRESHOLD) {
            changed++;
          }
        }
        setMotionScore(Math.round((changed / gray.length) * 100));
      }

      prevFrameRef.current = gray;
    }, SAMPLE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      prevFrameRef.current = null;
    };
  }, [videoRef, enabled]);

  return motionScore;
}
