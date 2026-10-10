type EventHandler = (data: unknown) => void;
type BinaryHandler = (data: ArrayBuffer) => void;

interface WsEvents {
  message: EventHandler;
  binary: BinaryHandler;
  open: () => void;
  close: (event: CloseEvent) => void;
  error: (event: Event) => void;
  max_retries: () => void;
}

interface WsOptions {
  maxReconnectAttempts?: number;
  /** Called once when the server refuses the socket (1008); true reconnects. */
  onRefused?: () => Promise<boolean>;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  /** Resolves the URL for each attempt, so the base and any ticket are current. Must not reject. */
  private url: () => Promise<string>;
  private onRefused: (() => Promise<boolean>) | null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30_000;
  private shouldReconnect = true;
  private refusedOnce = false;
  /** Advances on every disconnect, so an attempt still resolving its URL opens nothing. */
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<keyof WsEvents, Set<(...args: never[]) => void>>();

  constructor(url: () => Promise<string>, options?: WsOptions) {
    this.url = url;
    this.onRefused = options?.onRefused ?? null;
    this.maxReconnectAttempts = options?.maxReconnectAttempts ?? this.maxReconnectAttempts;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING)
      return;
    const generation = this.generation;
    void this.url().then((url) => {
      if (generation === this.generation) this.openSocket(url);
    });
  }

  private openSocket(url: string): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING)
      return;

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.shouldReconnect = true;
      this.refusedOnce = false;
      this.emit("open");
    };

    this.ws.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) {
        this.emit("binary", event.data);
      } else if (typeof event.data === "string") {
        try {
          const data: unknown = JSON.parse(event.data);
          this.emit("message", data);
        } catch {
          this.emit("message", event.data);
        }
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.emit("close", event);
      // Refused (1008): renew the credential once, then reconnect or stop
      if (event.code === 1008) {
        if (!this.onRefused || this.refusedOnce) {
          this.shouldReconnect = false;
          return;
        }
        this.refusedOnce = true;
        const generation = this.generation;
        void this.onRefused().then((again) => {
          if (generation !== this.generation) return;
          if (again) this.connect();
          else this.shouldReconnect = false;
        });
        return;
      }
      // A refusal after this close (a restart that ended the session, say) earns its own renewal
      this.refusedOnce = false;
      // Don't retry on custom application close codes (e.g. 4004 "Job not found")
      if (event.code >= 4000 && event.code < 5000) {
        this.shouldReconnect = false;
      }
      if (this.shouldReconnect) {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.shouldReconnect = false;
          this.emit("max_retries");
          return;
        }
        const delay = Math.min(
          this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
          this.maxReconnectDelay,
        );
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.shouldReconnect) this.connect();
        }, delay);
      }
    };

    this.ws.onerror = (event: Event) => {
      this.emit("error", event);
    };
  }

  disconnect(): void {
    this.generation++;
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  /** Close and connect again from the first attempt, as after the base or the credentials changed. */
  restart(): void {
    this.disconnect();
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
    this.refusedOnce = false;
    this.connect();
  }

  send(data: string | Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.ws.send(payload);
  }

  sendBinary(data: ArrayBuffer): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(data);
  }

  on<K extends keyof WsEvents>(event: K, handler: WsEvents[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private emit(event: keyof WsEvents, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((handler) => {
      (handler as (...a: unknown[]) => void)(...args);
    });
  }
}
