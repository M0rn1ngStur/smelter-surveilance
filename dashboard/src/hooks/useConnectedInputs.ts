import { useEffect, useState } from 'react';
import { listInputs } from '../api/client';
import type { InputInfo } from '../types';

const POLL_INTERVAL_MS = 2000;

export function useConnectedInputs() {
  const [inputs, setInputs] = useState<InputInfo[]>([]);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const data = await listInputs();
        if (active) setInputs(data);
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

  return inputs;
}
