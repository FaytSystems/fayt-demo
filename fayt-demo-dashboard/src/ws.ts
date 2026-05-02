// D:\CryptoTrader\fayt-demo-dashboard\src\ws.ts

import { apiBase, type DemoSnapshot } from "./client";

type Envelope = {
  type: "snapshot" | "ping" | "error";
  data: DemoSnapshot | Record<string, unknown>;
};

export type DemoStreamHandlers = {
  onSnapshot: (snapshot: DemoSnapshot) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (event: Event) => void;
};

function buildWsUrl(): string {
  const explicit = String(import.meta.env.VITE_DEMO_WS_BASE ?? "").trim();
  const base = explicit || apiBase();

  const normalized = base.startsWith("https://")
    ? `wss://${base.slice(8)}`
    : base.startsWith("http://")
      ? `ws://${base.slice(7)}`
      : base.startsWith("wss://") || base.startsWith("ws://")
        ? base
        : `ws://${base}`;

  return `${normalized.replace(/\/+$/, "")}/demo/ws`;
}

export function connectDemoStream(handlers: DemoStreamHandlers): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retryDelay = 1000;
  let retryTimer: number | undefined;

  const connect = () => {
    socket = new WebSocket(buildWsUrl());

    socket.onopen = () => {
      retryDelay = 1000;
      handlers.onOpen?.();
    };

    socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(String(event.data)) as Envelope;

        if (envelope.type === "snapshot") {
          handlers.onSnapshot(envelope.data as DemoSnapshot);
        }
      } catch {
        // Ignore malformed frames.
      }
    };

    socket.onerror = (event) => {
      handlers.onError?.(event);
    };

    socket.onclose = () => {
      handlers.onClose?.();

      if (stopped) {
        return;
      }

      retryTimer = window.setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    };
  };

  connect();

  return () => {
    stopped = true;

    if (retryTimer) {
      window.clearTimeout(retryTimer);
    }

    socket?.close();
  };
}