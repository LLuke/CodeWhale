import * as vscode from "vscode";
import type { RuntimeState } from "./runtime";

export class RuntimeStatusView implements vscode.WebviewViewProvider {
  public static readonly viewType = "codewhale.runtimeStatus";

  private view?: vscode.WebviewView;
  private state: RuntimeState = {
    kind: "offline",
    baseUrl: "http://127.0.0.1:7878",
    detail: "Runtime has not been checked yet.",
  };

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message: { command?: string }) => {
      if (message.command === "check") {
        void vscode.commands.executeCommand("codewhale.checkRuntime");
      } else if (message.command === "start") {
        void vscode.commands.executeCommand("codewhale.startRuntime");
      } else if (message.command === "terminal") {
        void vscode.commands.executeCommand("codewhale.openTerminal");
      }
    });
    this.render();
  }

  update(state: RuntimeState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
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

function labelFor(kind: RuntimeState["kind"]): string {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
