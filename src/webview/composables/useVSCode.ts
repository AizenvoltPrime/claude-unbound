import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '@shared/types';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

export function useVSCode() {
  function postMessage(message: WebviewToExtensionMessage): void {
    vscode.postMessage(message);
  }

  function onMessage(handler: (message: ExtensionToWebviewMessage) => void): void {
    window.addEventListener('message', (event) => {
      handler(event.data as ExtensionToWebviewMessage);
    });
  }

  function getState<T>(): T | undefined {
    return vscode.getState() as T | undefined;
  }

  function setState<T>(state: T): void {
    vscode.setState(state);
  }

  return {
    postMessage,
    onMessage,
    getState,
    setState,
  };
}
