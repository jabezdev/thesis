import { useEffect, useRef } from "react";

export function useInterval(callback: () => void, delayMs: number): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const id = window.setInterval(() => {
      callbackRef.current();
    }, delayMs);

    return () => window.clearInterval(id);
  }, [delayMs]);
}
