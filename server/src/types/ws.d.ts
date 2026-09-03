declare module 'ws' {
  import { EventEmitter } from 'events';

  interface ClientOptions {
    headers?: Record<string, string>;
    protocols?: string | string[];
    timeout?: number;
    maxPayload?: number;
  }

  class WebSocket extends EventEmitter {
    static CONNECTING: number;
    static OPEN: number;
    static CLOSING: number;
    static CLOSED: number;

    readyState: number;
    protocol: string;

    constructor(address: string | URL, options?: ClientOptions);

    on(event: 'open', listener: () => void): this;
    on(event: 'message', listener: (data: Buffer) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;

    send(data: any, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }

  export { WebSocket, ClientOptions };
  export default WebSocket;
}
