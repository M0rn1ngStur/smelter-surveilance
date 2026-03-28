import { useEffect, useState } from 'react';
import { getMotionScores } from '../api/client';

const POLL_INTERVAL_MS = 1000;

export function useMotionScores() {
  const [scores, setScores] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const data = await getMotionScores();
        if (active) setScores(data);
      } catch {
        // ignore transient errors
      }
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return scores;
}
