import * as vscode from "vscode";
import {
  checkRuntime,
  openCodeWhaleTerminal,
  readRuntimeConfig,
  runtimeBaseUrl,
  startRuntimeTerminal,
} from "./runtime";
import { RuntimeStatusView } from "./status";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodeWhale");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const statusView = new RuntimeStatusView();

  status.command = "codewhale.checkRuntime";
  context.subscriptions.push(output, status);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RuntimeStatusView.viewType, statusView),
  );

  const updateStatus = (text: string, tooltip: string): void => {
    status.text = text;
    status.tooltip = tooltip;
    status.show();
  };

  updateStatus("$(terminal) CodeWhale", "Check CodeWhale runtime");

  context.subscriptions.push(
    vscode.commands.registerCommand("codewhale.openTerminal", () => {
      const config = readRuntimeConfig();
      openCodeWhaleTerminal(config);
      output.appendLine(`Opened CodeWhale terminal using ${config.commandPath}.`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codewhale.startRuntime", () => {
      const config = readRuntimeConfig();
      startRuntimeTerminal(config);
      const baseUrl = runtimeBaseUrl(config);
      updateStatus("$(sync~spin) CodeWhale", `Runtime terminal started for ${baseUrl}`);
      output.appendLine(`Started CodeWhale runtime terminal at ${baseUrl}.`);
      void vscode.window.showInformationMessage(`CodeWhale runtime starting at ${baseUrl}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codewhale.checkRuntime", async () => {
      const config = readRuntimeConfig();
      updateStatus("$(sync~spin) CodeWhale", "Checking CodeWhale runtime...");
      const state = await checkRuntime(config);
      statusView.update(state);

      switch (state.kind) {
        case "connected":
          updateStatus("$(check) CodeWhale", state.detail);
          break;
        case "auth-required":
          updateStatus("$(lock) CodeWhale", state.detail);
          break;
        case "offline":
        case "error":
          updateStatus("$(warning) CodeWhale", state.detail);
          break;
      }

      output.appendLine(`${new Date().toISOString()} ${state.kind}: ${state.detail}`);
      return state;
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codewhale.openRuntimeDocs", () => {
      void vscode.env.openExternal(
        vscode.Uri.parse(
          "https://github.com/Hmbown/CodeWhale/blob/main/docs/RUNTIME_API.md",
        ),
      );
    }),
  );

  void vscode.commands.executeCommand("codewhale.checkRuntime");
}

export function deactivate(): void {
  // No background process is owned by the extension; runtime starts in a user-visible terminal.
}
