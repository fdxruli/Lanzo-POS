// This protocol is informational. No message grants or revokes a Web Lock.
export const INSTANCE_LOCK_NAME = 'lanzo-pos-administrative-instance';
export const INSTANCE_CHANNEL_NAME = 'lanzo-pos-administrative-coordination';
export const INSTANCE_PROTOCOL_VERSION = 1;
export const INSTANCE_STATES = Object.freeze({
  STARTING: 'STARTING', CHECKING: 'CHECKING', SECONDARY: 'SECONDARY',
  RECOVERING: 'RECOVERING', COORDINATOR_HELD: 'COORDINATOR_HELD',
  QUIESCING: 'QUIESCING', RELEASED: 'RELEASED', ERROR: 'ERROR',
});
export const COORDINATION_MODE = 'web-locks';
const states = new Set(Object.values(INSTANCE_STATES));
const types = new Set(['PROBE', 'STATUS', 'CANDIDATE', 'RELEASE']);
const keys = ['v', 'type', 'from', 'to', 'requestId', 'messageId', 'epoch', 'mode', 'state'];
const idPattern = /^[a-f0-9]{32}$/;
export const validInstanceId = value => typeof value === 'string' && idPattern.test(value);

export function randomInstanceId(cryptoTarget) {
  const bytes = new Uint8Array(16);
  cryptoTarget.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Exact flat envelope: no arbitrary payload, nested objects, identifiers or secrets.
// Message sequence is local to one random document identity, never a global clock.
export function validateInstanceMessage(message, ownId, requestId) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const ownKeys = Object.keys(message);
  if (ownKeys.length !== keys.length || !keys.every(key => Object.hasOwn(message, key))) return false;
  if (message.v !== INSTANCE_PROTOCOL_VERSION || !types.has(message.type)) return false;
  if (!validInstanceId(message.from) || message.from === ownId || !validInstanceId(message.requestId)) return false;
  if (message.mode !== COORDINATION_MODE || !states.has(message.state)) return false;
  if (!Number.isSafeInteger(message.epoch) || message.epoch < 1) return false;
  if (typeof message.messageId !== 'string' || message.messageId.length > 50) return false;
  const [sender, serial, extra] = message.messageId.split(':');
  if (extra !== undefined || sender !== message.from || !/^[1-9][0-9]{0,15}$/.test(serial)) return false;
  if (!Number.isSafeInteger(Number(serial))) return false;
  if (message.type === 'PROBE') return message.to === null;
  if (message.to !== ownId || message.requestId !== requestId) return false;
  if (message.type === 'STATUS') return ['COORDINATOR_HELD', 'QUIESCING'].includes(message.state);
  if (message.type === 'RELEASE') return message.state === 'RELEASED';
  return ['CHECKING', 'SECONDARY', 'RECOVERING'].includes(message.state);
}
