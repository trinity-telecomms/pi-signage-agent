import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

import type { AgentConfig, DeviceRuntimeInfo } from './types';

function readMachineId(): string | null {
  const candidates = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
  for (const file of candidates) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) {
        return value;
      }
    } catch {
      // Ignore and continue.
    }
  }
  return null;
}

function toNumericUid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  const digits = Array.from(hex, (char) => (parseInt(char, 16) % 10).toString()).join('');
  let uid = digits.slice(0, 15);
  if (uid.length < 15) {
    uid = uid.padEnd(15, '0');
  }
  if (uid.startsWith('0')) {
    uid = `9${uid.slice(1)}`;
  }
  return uid;
}

function getPrimaryIpv4(): string {
  const preferred = ['wlan0', 'eth0'];
  const interfaces = os.networkInterfaces();

  for (const name of preferred) {
    const entries = interfaces[name];
    const ipv4 = entries?.find((entry) => entry.family === 'IPv4' && !entry.internal)?.address;
    if (ipv4) {
      return ipv4;
    }
  }

  for (const entries of Object.values(interfaces)) {
    const ipv4 = entries?.find((entry) => entry.family === 'IPv4' && !entry.internal)?.address;
    if (ipv4) {
      return ipv4;
    }
  }

  return '127.0.0.1';
}

export function buildDeviceRuntimeInfo(config: AgentConfig): DeviceRuntimeInfo {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const ipv4 = getPrimaryIpv4();

  const uid =
    config.deviceUidOverride ??
    toNumericUid(readMachineId() ?? `${hostname}:${username}:${process.arch}:${process.platform}`);

  const name = `${config.deviceNamePrefix}-${hostname}`.slice(0, 120);
  const description = `${config.deviceDescriptionPrefix} user=${username} ip=${ipv4}`.slice(0, 250);

  return {
    uid,
    name,
    description,
    username,
    ipv4,
    hostname,
  };
}
