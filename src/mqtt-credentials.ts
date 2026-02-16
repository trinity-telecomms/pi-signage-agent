import { createHash } from 'node:crypto';

export function createSessionPassword(systemPasswordHex: string, salt: number): string {
  const normalized = systemPasswordHex.trim();
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('MQTT system password must be valid hex.');
  }

  const systemPassword = Buffer.from(normalized, 'hex');
  const saltBuffer = Buffer.alloc(4);
  saltBuffer.writeUInt32LE(salt, 0);

  const digest = createHash('sha1')
    .update(Buffer.concat([saltBuffer, systemPassword]))
    .digest();

  return Buffer.concat([saltBuffer, digest]).toString('base64');
}
