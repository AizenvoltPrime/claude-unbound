export interface PluginConfig {
  type: "local";
  path: string;
}

export interface PluginInfo {
  name: string;
  fullId: string;
  path: string;
  version?: string;
  description?: string;
}

export interface PluginStatusInfo {
  name: string;
  fullId: string;
  path: string;
  status: "loaded" | "failed" | "disabled" | "pending" | "idle";
  enabled: boolean;
  version?: string;
  description?: string;
}
