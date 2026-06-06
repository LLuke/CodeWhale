"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readRuntimeConfig = readRuntimeConfig;
exports.runtimeBaseUrl = runtimeBaseUrl;
exports.checkRuntime = checkRuntime;
exports.startRuntimeTerminal = startRuntimeTerminal;
exports.openCodeWhaleTerminal = openCodeWhaleTerminal;
const http = __importStar(require("node:http"));
const vscode = __importStar(require("vscode"));
function readRuntimeConfig() {
    const config = vscode.workspace.getConfiguration("codewhale");
    const commandPath = config.get("commandPath", "codewhale").trim() || "codewhale";
    const host = config.get("runtimeHost", "127.0.0.1").trim() || "127.0.0.1";
    const port = config.get("runtimePort", 7878);
    const token = config.get("runtimeToken", "").trim();
    return {
        commandPath,
        host,
        port,
        token: token.length > 0 ? token : undefined,
    };
}
function runtimeBaseUrl(config) {
    return `http://${config.host}:${config.port}`;
}
async function checkRuntime(config) {
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
function startRuntimeTerminal(config) {
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
function openCodeWhaleTerminal(config) {
    const terminal = vscode.window.createTerminal("CodeWhale");
    terminal.sendText(shellQuote(config.commandPath));
    terminal.show();
    return terminal;
}
async function requestJson(url, token) {
    try {
        return await new Promise((resolve, reject) => {
            const request = http.get(url, {
                timeout: 2500,
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            }, (response) => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => {
                    body += chunk;
                });
                response.on("end", () => {
                    resolve({
                        statusCode: response.statusCode ?? 0,
                        body: parseJson(body),
                    });
                });
            });
            request.on("timeout", () => {
                request.destroy(new Error("Runtime check timed out."));
            });
            request.on("error", reject);
        });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { statusCode: 0, body: { error: detail } };
    }
}
function parseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
function readVersion(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const version = value.version;
    return typeof version === "string" ? version : undefined;
}
function shellQuote(value) {
    if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
        return value;
    }
    return `'${value.replace(/'/g, "'\\''")}'`;
}
//# sourceMappingURL=runtime.js.map