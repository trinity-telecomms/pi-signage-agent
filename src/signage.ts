import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import type { AgentConfig } from './types';

const DEFAULT_VLC_ARGS = ['-I', 'dummy', '--fullscreen', '--no-video-title-show', '--loop', '--vout=drm_vout'];

let activePlayer: ChildProcess | null = null;

function sanitizeFilename(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : `media-${Date.now()}`;
}

function inferFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const basename = path.basename(parsed.pathname || '').trim();
    if (basename) {
      return sanitizeFilename(basename);
    }
  } catch {
    // Ignore; fallback below.
  }
  return `media-${Date.now()}`;
}

export async function downloadMedia(url: string, config: AgentConfig, requestedFilename?: string): Promise<string> {
  if (!url.trim()) {
    throw new Error('downloadMedia requires a URL');
  }

  await fs.mkdir(config.mediaDir, { recursive: true });

  const fileName = sanitizeFilename(requestedFilename?.trim() || inferFilenameFromUrl(url));
  const destination = path.join(config.mediaDir, fileName);
  const tempPath = `${destination}.download`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.downloadTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download media: HTTP ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  await fs.writeFile(tempPath, Buffer.from(bytes));
  await fs.rename(tempPath, destination);

  return destination;
}

export async function playMedia(mediaPath: string, config: AgentConfig): Promise<void> {
  await fs.access(mediaPath);

  if (activePlayer && !activePlayer.killed) {
    activePlayer.kill('SIGTERM');
    activePlayer = null;
  }

  const args = [...DEFAULT_VLC_ARGS, ...config.vlcExtraArgs, mediaPath];
  const child = spawn(config.vlcBin, args, {
    detached: false,
    stdio: 'ignore',
  });

  child.on('exit', () => {
    if (activePlayer === child) {
      activePlayer = null;
    }
  });

  child.unref();
  activePlayer = child;
}

export async function stopMedia(): Promise<void> {
  if (activePlayer && !activePlayer.killed) {
    activePlayer.kill('SIGTERM');
  }
  activePlayer = null;
}
