import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

const SLOT_FILENAME: Record<MediaMode, string> = {
  video: 'current-video',
  image: 'current-image',
};

const LEGACY_MODE_FILES: Record<MediaMode, string[]> = {
  video: ['current.mp4', 'current.webm', 'current.mov', 'current.mkv'],
  image: ['current.jpeg', 'current.jpg', 'current.png', 'current.webp'],
};

function parseStartMode(args: unknown[]): MediaMode | null {
  const tupleArg = Array.isArray(args[0]) ? args[0] : null;
  if (tupleArg && tupleArg.length > 0 && typeof tupleArg[0] === 'string') {
    const mode = tupleArg[0].trim().toLowerCase();
    if (mode === 'image' || mode === 'video') {
      return mode;
    }
  }

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

function parseDownloadModeAndUrl(args: unknown[]): { mode: MediaMode | null; url: string } {
  const tupleArg = Array.isArray(args[0]) ? args[0] : null;
  if (
    tupleArg &&
    tupleArg.length >= 2 &&
    typeof tupleArg[0] === 'string' &&
    typeof tupleArg[1] === 'string'
  ) {
    const mode = tupleArg[0].trim().toLowerCase();
    if (mode === 'image' || mode === 'video') {
      return { mode, url: tupleArg[1].trim() };
    }
  }

  const objectArg = asObjectArg(args[0]);
  if (objectArg) {
    const modeRaw = typeof objectArg.mode === 'string' ? objectArg.mode.trim().toLowerCase() : '';
    const mode = modeRaw === 'image' || modeRaw === 'video' ? modeRaw : null;
    const url = typeof objectArg.url === 'string' ? objectArg.url.trim() : '';
    return { mode, url };
  }

  const first = typeof args[0] === 'string' ? args[0].trim() : '';
  const second = typeof args[1] === 'string' ? args[1].trim() : '';

  const firstLower = first.toLowerCase();
  if (firstLower === 'image' || firstLower === 'video') {
    return { mode: firstLower, url: second };
  }

  const secondLower = second.toLowerCase();
  if (secondLower === 'image' || secondLower === 'video') {
    return { mode: secondLower, url: first };
  }

  return { mode: null, url: '' };
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
  const candidates = [
    path.join(config.mediaDir, SLOT_FILENAME[mode]),
    ...LEGACY_MODE_FILES[mode].map((name) => path.join(config.mediaDir, name)),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException;
    if (maybeErr?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function cleanupLegacyModeFiles(mode: MediaMode, config: AgentConfig): Promise<void> {
  for (const fileName of LEGACY_MODE_FILES[mode]) {
    await removeIfExists(path.join(config.mediaDir, fileName));
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function triggerBackgroundUpdate(config: AgentConfig): void {
  const sourceDir = shellEscape(config.agentSourceDir);
  const logFile = shellEscape(config.updateLogFile);

  const script = [
    'set -euo pipefail',
    `mkdir -p $(dirname ${logFile})`,
    `echo \"[$(date -Iseconds)] update started\" >> ${logFile}`,
    `cd ${sourceDir}`,
    'git pull --ff-only',
    'bun install',
    'bun run build',
    'sudo -n ./scripts/install.sh',
    `echo \"[$(date -Iseconds)] update completed\" >> ${logFile}`,
  ].join('; ');

  const child = spawn('bash', ['-lc', script], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
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

      case 'download': {
        const { mode, url } = parseDownloadModeAndUrl(command.args);
        if (!mode) {
          return {
            resultCode: -100,
            detail: 'download requires media mode (image|video) and url',
          };
        }
        if (!url.trim()) {
          return {
            resultCode: -100,
            detail: `download ${mode} requires a url`,
          };
        }

        const slotPath = await downloadMedia(url, config, SLOT_FILENAME[mode]);
        await cleanupLegacyModeFiles(mode, config);
        await playMedia(slotPath, config);
        return {
          resultCode: 0,
          detail: `${mode} downloaded and playback started`,
          data: { mediaPath: slotPath, mode },
        };
      }

      case 'update': {
        if (!config.enableUpdateCommand) {
          return {
            resultCode: -100,
            detail: 'update command is disabled (ENABLE_UPDATE_COMMAND=false)',
          };
        }

        triggerBackgroundUpdate(config);
        return {
          resultCode: 0,
          detail: 'update started',
          data: {
            sourceDir: config.agentSourceDir,
            logFile: config.updateLogFile,
          },
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
