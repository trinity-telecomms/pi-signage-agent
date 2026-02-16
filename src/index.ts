import fs from 'node:fs/promises';

import { acknowledgeZteEnrollment, createConnectDevice, enrollDeviceWithZte, getApiErrorDetails, isEnrollmentAlreadyCompleteError } from './connect-client';
import { loadConfig } from './config';
import { buildDeviceRuntimeInfo } from './device-info';
import { logger } from './logger';
import { runMqttLoop } from './mqtt-agent';
import { createSessionPassword } from './mqtt-credentials';
import { playMedia } from './signage';
import { loadAgentState, saveAgentState } from './state-store';
import type { AgentState } from './types';

function assertCompatibleStateUid(existingUid: string, runtimeUid: string): void {
  if (existingUid !== runtimeUid) {
    throw new Error(
      `State UID mismatch. state.uid=${existingUid} runtime.uid=${runtimeUid}. Remove state file to re-enroll this device.`,
    );
  }
}

async function resolveMqttSecrets(
  uid: string,
  stateFile: string,
  config: ReturnType<typeof loadConfig>,
): Promise<{ cid: string; key: string }> {
  const existing = await loadAgentState(stateFile);
  if (existing) {
    assertCompatibleStateUid(existing.uid, uid);
    logger.info('Loaded existing enrollment state', { stateFile });
    return { cid: existing.cid, key: existing.key };
  }

  let enrollment;
  try {
    enrollment = await enrollDeviceWithZte(config, uid);
  } catch (error) {
    if (isEnrollmentAlreadyCompleteError(error)) {
      throw new Error(
        'ZTE reports enrollment is already complete, but no local state exists. Seed AGENT_STATE_FILE with cid/key or re-provision enrollment.',
      );
    }
    throw new Error(`ZTE enrollment failed: ${JSON.stringify(getApiErrorDetails(error))}`);
  }

  const sessionPassword = createSessionPassword(enrollment.key, Math.floor(Date.now() / 1000));
  await acknowledgeZteEnrollment(config, uid, enrollment.cid, sessionPassword);

  const now = new Date().toISOString();
  const state: AgentState = {
    uid,
    cid: enrollment.cid,
    key: enrollment.key,
    kai: enrollment.kai,
    pdr: enrollment.pdr,
    enrolledAt: now,
    updatedAt: now,
  };
  await saveAgentState(stateFile, state);
  logger.info('Enrollment state persisted', { stateFile });

  return { cid: enrollment.cid, key: enrollment.key };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function maybeStartStartupPlayback(config: ReturnType<typeof loadConfig>): Promise<void> {
  if (!config.startupAutoplay) {
    logger.info('Startup autoplay disabled');
    return;
  }

  const candidates = [
    config.startupMediaPath,
    `${config.mediaDir}/current.mp4`,
    `${config.mediaDir}/current.webm`,
    `${config.mediaDir}/current.mov`,
    `${config.mediaDir}/current.mkv`,
    `${config.mediaDir}/current.jpeg`,
    `${config.mediaDir}/current.jpg`,
    `${config.mediaDir}/current.png`,
  ];

  let selectedPath: string | null = null;
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      selectedPath = candidate;
      break;
    }
  }

  if (!selectedPath) {
    logger.warn('Startup autoplay skipped: no startup media file found', {
      checked: candidates,
    });
    return;
  }

  await playMedia(selectedPath, config);
  logger.info('Startup playback started', { mediaPath: selectedPath });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = buildDeviceRuntimeInfo(config);

  logger.info('Starting signage MQTT agent', {
    uid: runtime.uid,
    name: runtime.name,
    username: runtime.username,
    ipv4: runtime.ipv4,
  });

  await maybeStartStartupPlayback(config);

  await createConnectDevice(config, runtime);
  logger.info('Device ensured on Connect', { uid: runtime.uid, folderId: config.connectFolderId });

  const secrets = await resolveMqttSecrets(runtime.uid, config.agentStateFile, config);
  logger.info('MQTT credentials ready', { cid: secrets.cid });

  await runMqttLoop(config, runtime, secrets);
}

main().catch((error) => {
  logger.error('Fatal agent error', error instanceof Error ? error.message : error);
  process.exit(1);
});
