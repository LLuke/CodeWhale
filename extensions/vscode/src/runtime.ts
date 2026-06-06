import * as http from "node:http";
import * as vscode from "vscode";

export type RuntimeStateKind = "connected" | "offline" | "auth-required" | "error";

export interface RuntimeState {
  kind: RuntimeStateKind;
  baseUrl: string;
  detail: string;
  version?: string;
}

export interface RuntimeConfig {
  commandPath: string;
  host: string;
  port: number;
  token?: string;
}

export function readRuntimeConfig(): RuntimeConfig {
  const config = vscode.workspace.getConfiguration("codewhale");
  const commandPath = config.get<string>("commandPath", "codewhale").trim() || "codewhale";
  const host = config.get<string>("runtimeHost", "127.0.0.1").trim() || "127.0.0.1";
  const port = config.get<number>("runtimePort", 7878);
  const token = config.get<string>("runtimeToken", "").trim();
  return {
    commandPath,
    host,
    port,
    token: token.length > 0 ? token : undefined,
  };
}

export function runtimeBaseUrl(config: RuntimeConfig): string {
  return `http://${config.host}:${config.port}`;
}

export async function checkRuntime(config: RuntimeConfig): Promise<RuntimeState> {
  const baseUrl = runtimeBaseUrl(config);
  const health = await requestJson(`${baseUrl}/health`, config.token);
  if (health.statusCode === 0) {
    return { kind: "offline", baseUrl, detail: "Runtime is not reachable." };
  }
  if (health.statusCode === 401) {
    return { kind: "auth-required", baseUrl, detail: "Runtime requires a token." };
  }
  if (health.statusCode !== 200) {
    return {
      kind: "error",
      baseUrl,
      detail: `Health check returned HTTP ${health.statusCode}.`,
    };
  }

  const info = await requestJson(`${baseUrl}/v1/runtime/info`, config.token);
  if (info.statusCode === 401) {
    return { kind: "auth-required", baseUrl, detail: "Runtime info requires a token." };
  }

  const version = readVersion(info.body);
  return {
    kind: "connected",
    baseUrl,
    detail: version ? `Connected to CodeWhale ${version}.` : "Connected to CodeWhale runtime.",
    version,
  };
}

export function startRuntimeTerminal(config: RuntimeConfig): vscode.Terminal {
  const terminal = vscode.window.createTerminal("CodeWhale Runtime");
  const args = [
    "serve",
    "--http",
    "--host",
    shellQuote(config.host),
    "--port",
    String(config.port),
  ];
  if (config.token) {
    args.push("--auth-token", shellQuote(config.token));
  }
  terminal.sendText(`${shellQuote(config.commandPath)} ${args.join(" ")}`);
  terminal.show();
  return terminal;
}

export function openCodeWhaleTerminal(config: RuntimeConfig): vscode.Terminal {
  const terminal = vscode.window.createTerminal("CodeWhale");
  terminal.sendText(shellQuote(config.commandPath));
  terminal.show();
  return terminal;
}

async function requestJson(
  url: string,
  token: string | undefined,
): Promise<{ statusCode: number; body: unknown }> {
  try {
    return await new Promise<{ statusCode: number; body: unknown }>((resolve, reject) => {
      const request = http.get(
        url,
        {
          timeout: 2500,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: parseJson(body),
            });
          });
        },
      );

      request.on("timeout", () => {
        request.destroy(new Error("Runtime check timed out."));
      });
      request.on("error", reject);
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { statusCode: 0, body: { error: detail } };
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readVersion(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const version = (value as { version?: unknown }).version;
  return typeof version === "string" ? version : undefined;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
