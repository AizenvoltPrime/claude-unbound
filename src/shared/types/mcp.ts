export interface McpStdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpSseServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpSseServerConfig | McpHttpServerConfig;

export interface McpServerStatusInfo {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled" | "idle";
  enabled: boolean;
  serverInfo?: {
    name: string;
    version: string;
  };
}
