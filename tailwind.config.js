/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/webview/**/*.{vue,ts,html}'],
  theme: {
    extend: {
      colors: {
        // VS Code theme-aware colors using CSS variables
        'vscode-bg': 'var(--vscode-editor-background)',
        'vscode-fg': 'var(--vscode-editor-foreground)',
        'vscode-input-bg': 'var(--vscode-input-background)',
        'vscode-input-fg': 'var(--vscode-input-foreground)',
        'vscode-input-border': 'var(--vscode-input-border)',
        'vscode-button-bg': 'var(--vscode-button-background)',
        'vscode-button-fg': 'var(--vscode-button-foreground)',
        'vscode-button-hover': 'var(--vscode-button-hoverBackground)',
        'vscode-border': 'var(--vscode-panel-border)',
        'vscode-link': 'var(--vscode-textLink-foreground)',
      },
    },
  },
  plugins: [],
};
