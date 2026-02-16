import path from 'node:path';

import type { AgentConfig } from './types';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function env(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function asPositiveInt(raw: string, name: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseProtocol(value: string): AgentConfig['mqttProtocol'] {
  if (value === 'mqtt' || value === 'mqtts' || value === 'ws' || value === 'wss') {
    return value;
  }
  throw new Error(`MQTT_PROTOCOL must be one of mqtt|mqtts|ws|wss; got "${value}"`);
}

function parseUidOverride(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  if (!/^\d{15,20}$/.test(value)) {
    throw new Error('DEVICE_UID must be numeric and 15-20 digits when provided');
  }
  return value;
}

function parseVlcExtraArgs(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) {
    return [];
  }
  return value.split(/\s+/).filter(Boolean);
}

export function loadConfig(): AgentConfig {
  const config: AgentConfig = {
    connectApiBaseUrl: env('CONNECT_API_BASE_URL', 'https://capi.trintel.co.za/api/v4'),
    connectApiKey: requireEnv('CONNECT_API_KEY'),
    connectCompanyId: requireEnv('CONNECT_COMPANY_ID'),
    connectFolderId: requireEnv('CONNECT_FOLDER_ID'),
    zteUsername: requireEnv('ZTE_USERNAME'),
    ztePassword: requireEnv('ZTE_PASSWORD'),
    zteEndpointToken: env('ZTE_ENDPOINT_TOKEN', '9Tx2aXXyYcWdxm5kQQYcRy92'),
    mqttProtocol: parseProtocol(env('MQTT_PROTOCOL', 'mqtts')),
    mqttHost: requireEnv('MQTT_HOST'),
    mqttPort: asPositiveInt(env('MQTT_PORT', '8883'), 'MQTT_PORT'),
    mqttPid: env('MQTT_PID', '0'),
    deviceUidOverride: parseUidOverride(process.env.DEVICE_UID),
    deviceNamePrefix: env('DEVICE_NAME_PREFIX', 'pi-signage'),
    deviceDescriptionPrefix: env('DEVICE_DESCRIPTION_PREFIX', 'Raspberry Pi signage agent'),
    agentStateFile: path.resolve(env('AGENT_STATE_FILE', './data/agent-state.json')),
    mediaDir: path.resolve(env('MEDIA_DIR', '/opt/signage/media')),
    vlcBin: env('VLC_BIN', '/usr/bin/cvlc'),
    vlcExtraArgs: parseVlcExtraArgs(process.env.VLC_EXTRA_ARGS),
    downloadTimeoutMs: asPositiveInt(env('DOWNLOAD_TIMEOUT_MS', '120000'), 'DOWNLOAD_TIMEOUT_MS'),
    mqttReconnectDelayMs: asPositiveInt(env('MQTT_RECONNECT_DELAY_MS', '5000'), 'MQTT_RECONNECT_DELAY_MS'),
  };

  if (!/^\d+$/.test(config.connectCompanyId)) {
    throw new Error('CONNECT_COMPANY_ID must be numeric');
  }

  if (!/^\d+$/.test(config.connectFolderId)) {
    throw new Error('CONNECT_FOLDER_ID must be numeric');
  }

  if (!/^[A-Za-z0-9_-]+$/.test(config.zteEndpointToken)) {
    throw new Error('ZTE_ENDPOINT_TOKEN must contain only letters, numbers, underscore, or hyphen');
  }

  return config;
}
