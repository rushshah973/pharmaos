"use client";

import { useSyncExternalStore } from "react";

// The line the user just asked to open, before the URL (?line=) catches up after the server round trip.
// undefined = follow the URL. Browser Back / Forward always hands control back to the URL.
let requested: string | null | undefined = undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const onPopState = () => {
  requested = undefined;
  notify();
};

export function requestLine(lineId: string | null | undefined) {
  requested = lineId;
  notify();
}

function subscribe(cb: () => void) {
  if (listeners.size === 0) window.addEventListener("popstate", onPopState);
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) window.removeEventListener("popstate", onPopState);
  };
}

export function useRequestedLine(): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => requested,
    () => undefined,
  );
}
