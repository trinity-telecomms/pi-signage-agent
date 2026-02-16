export interface AgentConfig {
  connectApiBaseUrl: string;
  connectApiKey: string;
  connectCompanyId: string;
  connectFolderId: string;
  zteUsername: string;
  ztePassword: string;
  zteEndpointToken: string;
  mqttProtocol: 'mqtt' | 'mqtts' | 'ws' | 'wss';
  mqttHost: string;
  mqttPort: number;
  mqttPid: string;
  deviceUidOverride: string | null;
  deviceNamePrefix: string;
  deviceDescriptionPrefix: string;
  agentStateFile: string;
  mediaDir: string;
  vlcBin: string;
  vlcExtraArgs: string[];
  downloadTimeoutMs: number;
  mqttReconnectDelayMs: number;
}

export interface DeviceRuntimeInfo {
  uid: string;
  name: string;
  description: string;
  username: string;
  ipv4: string;
  hostname: string;
}

export interface AgentState {
  uid: string;
  cid: string;
  key: string;
  kai?: number;
  pdr?: number;
  enrolledAt: string;
  updatedAt: string;
}

export interface ZteEnrollment {
  cid: string;
  key: string;
  kai: number;
  pdr: number;
}

export interface ParsedInboundCommand {
  rpc: string;
  args: unknown[];
  pid: string;
  tct: string | null;
}
