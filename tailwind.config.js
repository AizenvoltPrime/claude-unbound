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
        'vscode-dropdown-bg': 'var(--vscode-dropdown-background)',
        'vscode-list-hoverBackground': 'var(--vscode-list-hoverBackground)',
        'vscode-list-activeSelectionBackground': 'var(--vscode-list-activeSelectionBackground)',

        // Claude Unbound custom cyan/blue theme (matching logo)
        'unbound': {
          'bg': '#0a1929',           // Deep navy background
          'bg-light': '#0d2233',     // Slightly lighter navy
          'bg-card': '#112338',      // Card/panel background
          'cyan': {
            50: '#e0f7fa',
            100: '#b2ebf2',
            200: '#80deea',
            300: '#4dd0e1',
            400: '#26c6da',
            500: '#00bcd4',          // Primary cyan
            600: '#00acc1',
            700: '#0097a7',
            800: '#00838f',
            900: '#006064',
          },
          'glow': '#4fc3f7',         // Glow/highlight cyan
          'accent': '#81d4fa',       // Light blue accent
          'text': '#e0f7fa',         // Light cyan text
          'muted': '#546e7a',        // Muted text
        },
      },
    },
  },
  plugins: [],
};
