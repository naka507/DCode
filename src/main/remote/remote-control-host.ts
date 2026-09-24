import { networkInterfaces } from "node:os";
import type { RemoteControlHostStatus } from "@dcode/shared";
import {
  bindRacpWebSocket,
  DeviceTokenAuthenticator,
  MemoryCredentialStore,
  RacpServer,
  type WsBinding,
} from "../../racp/index.js";
import type { AgentHostBridge } from "../agent-host-bridge.js";

export type RemoteControlHostOptions = {
  getAgentHostBridge: () => AgentHostBridge | null;
  defaultPort?: number;
  log?: (level: "info" | "warn" | "error", message: string, data?: unknown) => void;
};

let activeRemoteControlHost: RemoteControlHostService | null = null;

export function getActiveRemoteControlHost(): RemoteControlHostService | null {
  return activeRemoteControlHost;
}

export function setActiveRemoteControlHost(
  service: RemoteControlHostService | null,
): void {
  activeRemoteControlHost = service;
}

export class RemoteControlHostService {
  private binding: WsBinding | null = null;
  private server: RacpServer | null = null;
  private authenticator: DeviceTokenAuthenticator | null = null;
  private currentPairingToken: string | null = null;
  private currentExpiresAt: string | null = null;
  private defaultPort: number;
  private log: (level: "info" | "warn" | "error", message: string, data?: unknown) => void;

  private readonly options: RemoteControlHostOptions;

  constructor(options: RemoteControlHostOptions) {
    this.options = options;
    this.defaultPort = options.defaultPort ?? 9443;
    this.log = options.log ?? (() => undefined);
  }

  private getLocalIpv4Addresses(): string[] {
    const addresses: string[] = [];
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] ?? []) {
        if (net.family === "IPv4" && !net.internal) {
          addresses.push(net.address);
        }
      }
    }
    if (!addresses.includes("127.0.0.1")) {
      addresses.push("127.0.0.1");
    }
    return addresses;
  }

  async getStatus(): Promise<RemoteControlHostStatus> {
    const enabled = Boolean(this.binding);
    const localAddresses = this.getLocalIpv4Addresses();
    const port = this.binding?.address.port;
    const primaryIp = localAddresses.find((a) => a !== "127.0.0.1") ?? "127.0.0.1";

    return {
      enabled,
      port,
      localAddresses,
      pairingToken: this.currentPairingToken ?? undefined,
      pairingUrl:
        enabled && port && this.currentPairingToken
          ? `ws://${primaryIp}:${port}/v1/racp/ws?token=${this.currentPairingToken}`
          : undefined,
      connectedClients: this.server?.connectionCount() ?? 0,
      expiresAt: this.currentExpiresAt ?? undefined,
    };
  }

  async setEnabled(enabled: boolean): Promise<RemoteControlHostStatus> {
    if (enabled) {
      if (this.binding) {
        return this.getStatus();
      }

      const bridge = this.options.getAgentHostBridge();
      const agentHost = bridge?.agentHost;
      if (!agentHost) {
        throw new Error("agent host is not available");
      }

      const store = new MemoryCredentialStore();
      const authenticator = new DeviceTokenAuthenticator(store);
      this.authenticator = authenticator;

      const operations = {
        sessions: {
          async list() {
            return [];
          },
          async create() {
            throw new Error("unsupported");
          },
          async configure() {
            throw new Error("unsupported");
          },
          async fork() {
            throw new Error("unsupported");
          },
          async rename() {
            /* noop */
          },
          async delete() {
            /* noop */
          },
          async compact() {
            return { accepted: false };
          },
        },
        projects: {
          async list() {
            return [];
          },
          async register(path: string) {
            return { id: "p1", label: "project", archived: false, path };
          },
          async browse() {
            return { path: "", entries: [] };
          },
        },
        workspace: {
          async list() {
            return { entries: [] };
          },
          async read() {
            return { kind: "text" as const, content: "", size: 0 };
          },
          async diff() {
            return { repo: false, clean: true, files: [] };
          },
        },
      };

      const server = new RacpServer({
        agentHost,
        authenticator,
        operations,
        hostId: "dcode-desktop",
        serverVersion: "1.0.0",
        log: (level, message, data) => this.log(level, message, data),
      });
      this.server = server;

      // Issue pairing token valid for 24h
      const pairing = await authenticator.issuePairingToken(24 * 60 * 60 * 1000);
      this.currentPairingToken = pairing.token;
      this.currentExpiresAt = pairing.expiresAt;

      // Bind websocket server
      let port = this.defaultPort;
      try {
        this.binding = await bindRacpWebSocket({
          server,
          authenticator,
          port,
          log: (level, message, data) => this.log(level, message, data),
        });
      } catch (err) {
        this.log("warn", "default port failed, picking dynamic port", { error: String(err) });
        this.binding = await bindRacpWebSocket({
          server,
          authenticator,
          port: 0,
          log: (level, message, data) => this.log(level, message, data),
        });
      }

      this.log("info", "remote control host started", { port: this.binding.address.port });
      return this.getStatus();
    }

    if (this.binding) {
      await this.binding.close();
      this.binding = null;
      this.server = null;
      this.authenticator = null;
      this.currentPairingToken = null;
      this.currentExpiresAt = null;
      this.log("info", "remote control host stopped");
    }

    return this.getStatus();
  }

  async generatePairingToken(): Promise<RemoteControlHostStatus> {
    if (!this.binding || !this.authenticator) {
      throw new Error("remote control host is not running");
    }
    const pairing = await this.authenticator.issuePairingToken(24 * 60 * 60 * 1000);
    this.currentPairingToken = pairing.token;
    this.currentExpiresAt = pairing.expiresAt;
    return this.getStatus();
  }

  async dispose(): Promise<void> {
    if (this.binding) {
      await this.binding.close();
      this.binding = null;
      this.server = null;
    }
  }
}
