/**
 * ADR-005: spawns the real DCore binary over stdio JSON-RPC so eval runs
 * exercise the actual tool implementations, not mocks.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface DCoreHostOptions {
  /** Path to the DCore binary. */
  binaryPath: string;
  /** Protocol version to handshake with. */
  protocolVersion: number;
  /** Working directory for the child process. */
  cwd?: string;
  /** Extra env vars for the child. */
  env?: Record<string, string>;
}

export class DCoreHost {
  private child: ChildProcess | undefined;
  private pending = new Map<string, PendingCall>();
  private nextId = 1;
  private closed = false;
  private readonly options: DCoreHostOptions;

  constructor(options: DCoreHostOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    const child = spawn(this.options.binaryPath, [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => this.onLine(line));
    child.on("exit", (code) => {
      this.closed = true;
      const error = new Error(`DCore exited with code ${code}`);
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });
    child.on("error", (error) => {
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });
    // Give the process a moment to start; the handshake will fail fast if not.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await this.call("app.handshake", {
      protocolVersion: this.options.protocolVersion,
    });
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: {
      id?: string | number;
      result?: unknown;
      error?: { message?: string; code?: number };
    };
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    if (message.error) {
      const error = new Error(
        message.error.message ?? `DCore error ${message.error.code}`,
      );
      (error as { code?: number }).code = message.error.code;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed || !this.child?.stdin?.writable) {
      return Promise.reject(new Error("DCore host is not running"));
    }
    const id = `eval-${this.nextId++}-${randomUUID().slice(0, 8)}`;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DCore RPC timeout: ${method}`));
      }, 120_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child!.stdin!.write(payload, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async stop(): Promise<void> {
    this.closed = true;
    for (const [, pending] of this.pending) {
      pending.reject(new Error("DCore host stopped"));
    }
    this.pending.clear();
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    child.stdin?.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
      child.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
