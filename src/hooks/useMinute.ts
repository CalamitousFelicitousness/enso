import { useEffect, useState } from "react";

/** The time, again every minute while `active`, for lines that count down. A
 * view that comes back into sight catches up at once. */
export function useMinute(active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active]);
  return now;
}
