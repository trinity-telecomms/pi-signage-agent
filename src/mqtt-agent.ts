import mqtt, { type MqttClient } from 'mqtt';
import fs from 'node:fs';

import { createSessionPassword } from './mqtt-credentials';
import { logger } from './logger';
import { handleInboundCommand } from './command-handler';
import type { AgentConfig, DeviceRuntimeInfo, ParsedInboundCommand } from './types';

interface RuntimeSecrets {
  cid: string;
  key: string;
}

function parseInboundCommand(topic: string, payloadBuffer: Buffer): ParsedInboundCommand | null {
  const payloadText = payloadBuffer.toString('utf8');
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(payloadText);
  } catch {
    return null;
  }

  if (!parsedJson || typeof parsedJson !== 'object') {
    return null;
  }

  const commandEnvelope = (parsedJson as Record<string, unknown>).c;
  if (!Array.isArray(commandEnvelope) || commandEnvelope.length < 2) {
    return null;
  }

  const [, second, third] = commandEnvelope;
  let tct: string | null = null;
  let cmdArray: unknown;

  if (Array.isArray(second)) {
    cmdArray = second;
  } else if (typeof second === 'string' && Array.isArray(third)) {
    tct = second;
    cmdArray = third;
  } else {
    return null;
  }

  if (!Array.isArray(cmdArray) || cmdArray.length < 1 || typeof cmdArray[0] !== 'string') {
    return null;
  }

  const topicParts = topic.split('/');
  const pidFromTopic = topicParts[2]?.trim();
  const pid = pidFromTopic && pidFromTopic.length > 0 ? pidFromTopic : '0';

  return {
    rpc: cmdArray[0],
    args: cmdArray.slice(1),
    tct,
    pid,
  };
}

function toBrokerUrl(config: AgentConfig): string {
  return `${config.mqttProtocol}://${config.mqttHost}:${config.mqttPort}`;
}

function toCommandSubscribeTopic(runtime: DeviceRuntimeInfo, secrets: RuntimeSecrets): string {
  return `${secrets.cid}/${runtime.uid}/+/</#`;
}

function toReplyTopic(runtime: DeviceRuntimeInfo, secrets: RuntimeSecrets, pid: string, tct: string): string {
  return `${secrets.cid}/${runtime.uid}/${pid}/>/${tct}`;
}

function toDataMessage(payload: Record<string, unknown>): string {
  return JSON.stringify({ d: [Math.floor(Date.now() / 1000), [payload]] });
}

function toAgentStatusPayload(config: AgentConfig, runtime: DeviceRuntimeInfo): Record<string, unknown> {
  return {
    signage_agent: {
      status: 'online',
      username: runtime.username,
      ipv4: runtime.ipv4,
      hostname: runtime.hostname,
      connect_company_id: config.connectCompanyId,
      connect_folder_id: config.connectFolderId,
      ts: Math.floor(Date.now() / 1000),
    },
  };
}

async function connectMqtt(config: AgentConfig, runtime: DeviceRuntimeInfo, secrets: RuntimeSecrets): Promise<MqttClient> {
  const username = `${secrets.cid}${runtime.uid}`;
  const password = createSessionPassword(secrets.key, Math.floor(Date.now() / 1000));
  const brokerUrl = toBrokerUrl(config);

  const tlsOptions: Record<string, unknown> = {};
  if (config.mqttProtocol === 'mqtts' || config.mqttProtocol === 'wss') {
    tlsOptions.rejectUnauthorized = config.mqttRejectUnauthorized;

    if (config.mqttCaCertPath) {
      tlsOptions.ca = fs.readFileSync(config.mqttCaCertPath);
    }

    if (config.mqttServername) {
      tlsOptions.servername = config.mqttServername;
    }
  }

  const client = mqtt.connect(brokerUrl, {
    username,
    password,
    reconnectPeriod: 0,
    clean: true,
    connectTimeout: 10_000,
    clientId: `signage-${runtime.uid}-${Math.random().toString(16).slice(2, 10)}`,
    ...tlsOptions,
  });

  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('error', reject);
  });

  return client;
}

async function publish(client: MqttClient, topic: string, payload: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.publish(topic, payload, { qos: 1 }, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function subscribe(client: MqttClient, topic: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function publishCommandReply(
  client: MqttClient,
  runtime: DeviceRuntimeInfo,
  secrets: RuntimeSecrets,
  command: ParsedInboundCommand,
  resultCode: number,
  detail: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!command.tct) {
    return;
  }

  const topic = toReplyTopic(runtime, secrets, command.pid, command.tct);
  const payload = JSON.stringify({
    x: [0, resultCode, { detail, ...(data ?? {}) }],
  });

  await publish(client, topic, payload);
}

async function runConnectedSession(
  client: MqttClient,
  config: AgentConfig,
  runtime: DeviceRuntimeInfo,
  secrets: RuntimeSecrets,
): Promise<void> {
  const pid = config.mqttPid;
  const publishTopic = `${secrets.cid}/${runtime.uid}/${pid}/>`;
  const publishStatus = async (): Promise<void> => {
    const payload = toDataMessage(toAgentStatusPayload(config, runtime));
    await publish(client, publishTopic, payload);
    logger.info('Agent status payload published', { topic: publishTopic });
  };

  await publishStatus();

  const commandTopic = toCommandSubscribeTopic(runtime, secrets);
  await subscribe(client, commandTopic);
  logger.info('Subscribed to command topic', { topic: commandTopic });

  const heartbeatTimer = setInterval(() => {
    void publishStatus().catch((error) => {
      logger.warn('Agent heartbeat publish failed', error instanceof Error ? error.message : error);
    });
  }, config.agentHeartbeatIntervalMs);

  client.on('message', (topic, payloadBuffer) => {
    const command = parseInboundCommand(topic, payloadBuffer);
    if (!command) {
      return;
    }

    void (async () => {
      const outcome = await handleInboundCommand(command, config);
      logger.info('Command processed', {
        rpc: command.rpc,
        resultCode: outcome.resultCode,
        detail: outcome.detail,
      });

      await publishCommandReply(
        client,
        runtime,
        secrets,
        command,
        outcome.resultCode,
        outcome.detail,
        outcome.data,
      ).catch((error) => {
        logger.warn('Failed to publish command reply', error instanceof Error ? error.message : error);
      });
    })().catch((error) => {
      logger.error('Command pipeline failed', error instanceof Error ? error.message : error);
    });
  });

  await new Promise<void>((resolve) => {
    client.once('close', () => resolve());
    client.once('offline', () => resolve());
    client.once('end', () => resolve());
    client.once('error', () => resolve());
  });

  clearInterval(heartbeatTimer);
}

export async function runMqttLoop(config: AgentConfig, runtime: DeviceRuntimeInfo, secrets: RuntimeSecrets): Promise<never> {
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  while (true) {
    let client: MqttClient | null = null;

    try {
      client = await connectMqtt(config, runtime, secrets);
      logger.info('Connected to MQTT broker', {
        host: config.mqttHost,
        port: config.mqttPort,
        protocol: config.mqttProtocol,
      });

      await runConnectedSession(client, config, runtime, secrets);
    } catch (error) {
      logger.error('MQTT session error', error instanceof Error ? error.message : error);
    } finally {
      if (client) {
        client.end(true);
      }
    }

    logger.warn('Reconnecting to MQTT broker', { delayMs: config.mqttReconnectDelayMs });
    await sleep(config.mqttReconnectDelayMs);
  }
}
