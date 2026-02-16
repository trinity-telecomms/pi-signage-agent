import fs from 'node:fs/promises';
import path from 'node:path';

import { downloadMedia, playMedia, stopMedia } from './signage';
import type { AgentConfig, ParsedInboundCommand } from './types';

interface CommandOutcome {
  resultCode: number;
  detail: string;
  data?: Record<string, unknown>;
}

function asObjectArg(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseDownloadArgs(args: unknown[]): { url: string; filename?: string } {
  const objectArg = asObjectArg(args[0]);
  if (objectArg) {
    const url = typeof objectArg.url === 'string' ? objectArg.url : '';
    const filename = typeof objectArg.filename === 'string' ? objectArg.filename : undefined;
    return { url, filename };
  }

  const url = typeof args[0] === 'string' ? args[0] : '';
  const filename = typeof args[1] === 'string' ? args[1] : undefined;
  return { url, filename };
}

function parsePlayArgs(args: unknown[], config: AgentConfig): { mediaPath: string } {
  const objectArg = asObjectArg(args[0]);
  if (objectArg) {
    const requestedPath = typeof objectArg.path === 'string' ? objectArg.path : '';
    return { mediaPath: requestedPath || path.join(config.mediaDir, 'current.mp4') };
  }

  const requestedPath = typeof args[0] === 'string' ? args[0] : '';
  return { mediaPath: requestedPath || path.join(config.mediaDir, 'current.mp4') };
}

type MediaMode = 'image' | 'video';

function parseStartMode(args: unknown[]): MediaMode | null {
  const objectArg = asObjectArg(args[0]);
  if (objectArg && typeof objectArg.mode === 'string') {
    const mode = objectArg.mode.trim().toLowerCase();
    if (mode === 'image' || mode === 'video') {
      return mode;
    }
  }

  const first = typeof args[0] === 'string' ? args[0].trim().toLowerCase() : '';
  if (first === 'image' || first === 'video') {
    return first;
  }

  const second = typeof args[1] === 'string' ? args[1].trim().toLowerCase() : '';
  if (second === 'image' || second === 'video') {
    return second;
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDefaultMediaPath(mode: MediaMode, config: AgentConfig): Promise<string | null> {
  const candidates =
    mode === 'video'
      ? [
          path.join(config.mediaDir, 'current.mp4'),
          path.join(config.mediaDir, 'current.webm'),
          path.join(config.mediaDir, 'current.mov'),
          path.join(config.mediaDir, 'current.mkv'),
        ]
      : [
          path.join(config.mediaDir, 'current.jpeg'),
          path.join(config.mediaDir, 'current.jpg'),
          path.join(config.mediaDir, 'current.png'),
          path.join(config.mediaDir, 'current.webp'),
        ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function handleInboundCommand(command: ParsedInboundCommand, config: AgentConfig): Promise<CommandOutcome> {
  try {
    switch (command.rpc) {
      case 'ping':
        return { resultCode: 0, detail: 'pong' };

      case 'stop':
      case 'signage_stop':
        await stopMedia();
        return { resultCode: 0, detail: 'playback stopped' };

      case 'start': {
        const mode = parseStartMode(command.args);
        if (!mode) {
          return {
            resultCode: -100,
            detail: 'start requires media mode as image or video (args[0] or args[1])',
          };
        }

        const mediaPath = await resolveDefaultMediaPath(mode, config);
        if (!mediaPath) {
          return {
            resultCode: -100,
            detail: `start ${mode} failed: no current ${mode} file found in ${config.mediaDir}`,
          };
        }

        await playMedia(mediaPath, config);
        return {
          resultCode: 0,
          detail: `${mode} playback started`,
          data: { mediaPath, mode },
        };
      }

      case 'signage_download': {
        const { url, filename } = parseDownloadArgs(command.args);
        if (!url.trim()) {
          return { resultCode: -100, detail: 'signage_download requires url argument' };
        }

        const savedPath = await downloadMedia(url, config, filename);
        return {
          resultCode: 0,
          detail: 'media downloaded',
          data: { savedPath },
        };
      }

      case 'signage_play': {
        const { mediaPath } = parsePlayArgs(command.args, config);
        await playMedia(mediaPath, config);
        return {
          resultCode: 0,
          detail: 'playback started',
          data: { mediaPath },
        };
      }

      case 'signage_download_and_play':
      case 'signage_set_media': {
        const { url, filename } = parseDownloadArgs(command.args);
        if (!url.trim()) {
          return { resultCode: -100, detail: `${command.rpc} requires url argument` };
        }

        const savedPath = await downloadMedia(url, config, filename);
        await playMedia(savedPath, config);
        return {
          resultCode: 0,
          detail: 'media downloaded and playback started',
          data: { savedPath },
        };
      }

      default:
        return { resultCode: -100, detail: `unsupported command: ${command.rpc}` };
    }
  } catch (error) {
    return {
      resultCode: -27,
      detail: error instanceof Error ? error.message : 'command handler failed',
    };
  }
}
