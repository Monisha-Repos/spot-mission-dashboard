import { useEffect, useState } from 'react';

/** useState that survives tab switches and reloads for this visit (sessionStorage), e.g. replay speed. */
export function useSessionState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch { return initial; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: lasts while mounted */ }
  }, [key, value]);
  return [value, setValue];
}
