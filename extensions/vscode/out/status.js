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
exports.RuntimeStatusView = void 0;
const vscode = __importStar(require("vscode"));
class RuntimeStatusView {
    static viewType = "codewhale.runtimeStatus";
    view;
    state = {
        kind: "offline",
        baseUrl: "http://127.0.0.1:7878",
        detail: "Runtime has not been checked yet.",
    };
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.onDidReceiveMessage((message) => {
            if (message.command === "check") {
                void vscode.commands.executeCommand("codewhale.checkRuntime");
            }
            else if (message.command === "start") {
                void vscode.commands.executeCommand("codewhale.startRuntime");
            }
            else if (message.command === "terminal") {
                void vscode.commands.executeCommand("codewhale.openTerminal");
            }
        });
        this.render();
    }
    update(state) {
        this.state = state;
        this.render();
    }
    render() {
        if (!this.view) {
            return;
        }
        const badge = labelFor(this.state.kind);
        const nonce = makeNonce();
        this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { padding: 14px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    .status { margin-bottom: 12px; font-weight: 600; }
    .detail { margin: 0 0 14px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
    code { color: var(--vscode-textLink-foreground); }
    button { width: 100%; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="status">${escapeHtml(badge)}</div>
  <p class="detail">${escapeHtml(this.state.detail)}</p>
  <p class="detail"><code>${escapeHtml(this.state.baseUrl)}</code></p>
  <button data-command="check">Check Runtime</button>
  <button data-command="start">Start Local Runtime</button>
  <button data-command="terminal">Open CodeWhale Terminal</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    for (const button of document.querySelectorAll("button[data-command]")) {
      button.addEventListener("click", () => vscode.postMessage({ command: button.dataset.command }));
    }
  </script>
</body>
</html>`;
    }
}
exports.RuntimeStatusView = RuntimeStatusView;
function labelFor(kind) {
    switch (kind) {
        case "connected":
            return "Connected";
        case "auth-required":
            return "Token Required";
        case "error":
            return "Runtime Error";
        case "offline":
            return "Offline";
    }
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function makeNonce() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let index = 0; index < 32; index += 1) {
        nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return nonce;
}
//# sourceMappingURL=status.js.map