import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentState } from './types';

export async function loadAgentState(filePath: string): Promise<AgentState | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as Partial<AgentState>;

    if (!data || typeof data !== 'object') {
      return null;
    }

    if (
      typeof data.uid !== 'string' ||
      typeof data.cid !== 'string' ||
      typeof data.key !== 'string' ||
      data.uid.trim().length === 0 ||
      data.cid.trim().length === 0 ||
      data.key.trim().length === 0
    ) {
      return null;
    }

    return {
      uid: data.uid,
      cid: data.cid,
      key: data.key,
      kai: typeof data.kai === 'number' ? data.kai : undefined,
      pdr: typeof data.pdr === 'number' ? data.pdr : undefined,
      enrolledAt: typeof data.enrolledAt === 'string' ? data.enrolledAt : new Date().toISOString(),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function saveAgentState(filePath: string, state: AgentState): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const next = JSON.stringify(state, null, 2);
  const temp = `${filePath}.tmp`;

  await fs.writeFile(temp, `${next}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, filePath);
}
