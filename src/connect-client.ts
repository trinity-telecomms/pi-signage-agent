import type { AgentConfig, DeviceRuntimeInfo, ZteEnrollment } from './types';

interface ApiError {
  status: number;
  payload: unknown;
  message: string;
}

function toApiError(status: number, message: string, payload: unknown): ApiError {
  return { status, payload, message };
}

function isApiError(value: unknown): value is ApiError {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const v = value as Record<string, unknown>;
  return typeof v.status === 'number' && typeof v.message === 'string' && 'payload' in v;
}

function toBasicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function parseJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function payloadContainsAlreadyExists(payload: unknown): boolean {
  if (typeof payload === 'string') {
    return /already exists/i.test(payload);
  }

  if (Array.isArray(payload)) {
    return payload.some(payloadContainsAlreadyExists);
  }

  if (payload && typeof payload === 'object') {
    return Object.values(payload as Record<string, unknown>).some(payloadContainsAlreadyExists);
  }

  return false;
}

function payloadContainsEnrollmentComplete(payload: unknown): boolean {
  if (typeof payload === 'string') {
    return /enrolment complete|enrollment complete/i.test(payload);
  }

  if (Array.isArray(payload)) {
    return payload.some(payloadContainsEnrollmentComplete);
  }

  if (payload && typeof payload === 'object') {
    return Object.values(payload as Record<string, unknown>).some(payloadContainsEnrollmentComplete);
  }

  return false;
}

export async function createConnectDevice(config: AgentConfig, device: DeviceRuntimeInfo): Promise<void> {
  const folder = Number(config.connectFolderId);
  if (!Number.isInteger(folder) || folder <= 0) {
    throw new Error('CONNECT_FOLDER_ID must be a positive integer');
  }

  const response = await fetch(`${config.connectApiBaseUrl}/devices/device/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.connectApiKey}`,
    },
    body: JSON.stringify({
      folder,
      uid: device.uid,
      name: device.name,
      description: device.description,
    }),
  });

  if (response.ok) {
    return;
  }

  const payload = await parseJsonOrText(response);

  if ((response.status === 400 || response.status === 409) && payloadContainsAlreadyExists(payload)) {
    return;
  }

  throw toApiError(response.status, 'Connect device creation failed', payload);
}

export async function enrollDeviceWithZte(config: AgentConfig, uid: string): Promise<ZteEnrollment> {
  const url = `${config.connectApiBaseUrl}/devices/zte/${encodeURIComponent(uid)}/${config.zteEndpointToken}/`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: toBasicAuth(config.zteUsername, config.ztePassword),
    },
  });

  const payload = await parseJsonOrText(response);
  if (!response.ok) {
    throw toApiError(response.status, 'ZTE enrollment failed', payload);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid ZTE enrollment payload: expected object');
  }

  const parsed = payload as Record<string, unknown>;
  if (
    typeof parsed.cid !== 'string' ||
    typeof parsed.key !== 'string' ||
    typeof parsed.kai !== 'number' ||
    typeof parsed.pdr !== 'number'
  ) {
    throw new Error(`Invalid ZTE payload shape: ${JSON.stringify(payload)}`);
  }

  return {
    cid: parsed.cid,
    key: parsed.key,
    kai: parsed.kai,
    pdr: parsed.pdr,
  };
}

export async function acknowledgeZteEnrollment(
  config: AgentConfig,
  uid: string,
  cid: string,
  sessionPassword: string,
): Promise<void> {
  const url = `${config.connectApiBaseUrl}/devices/zte/${encodeURIComponent(uid)}/${config.zteEndpointToken}/`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: toBasicAuth(`${cid}${uid}`, sessionPassword),
    },
    body: JSON.stringify({ cid }),
  });

  if (response.ok) {
    return;
  }

  const payload = await parseJsonOrText(response);
  if (payloadContainsEnrollmentComplete(payload)) {
    return;
  }

  throw toApiError(response.status, 'ZTE enrollment acknowledgment failed', payload);
}

export function isEnrollmentAlreadyCompleteError(error: unknown): boolean {
  if (!isApiError(error)) {
    return false;
  }
  return payloadContainsEnrollmentComplete(error.payload);
}

export function getApiErrorDetails(error: unknown): unknown {
  if (!isApiError(error)) {
    return error;
  }
  return {
    status: error.status,
    message: error.message,
    payload: error.payload,
  };
}
