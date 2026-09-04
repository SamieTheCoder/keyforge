// SPDX-License-Identifier: AGPL-3.0-only
//
// CTAP2 over pico-fido's CCID FIDO applet (AID A0000006472F0001, INS 0x10).
// pico-fido passes the APDU body to the same cbor_parse() used by USB HID,
// so ClientPIN and CredentialManagement work over WebUSB, where browsers
// otherwise block the FIDO HID interface.
//
// PIN/UV auth protocol 1 (CTAP 2.1 section 6.5.6), implemented with WebCrypto.

import { cborDecode, cborEncode, get, type CborValue } from './cbor';
import { buildApdu, concat, toHex } from './protocol';

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

const CTAP_ERRORS: Record<number, string> = {
  0x01: 'Invalid command',
  0x02: 'Invalid parameter',
  0x11: 'Invalid CBOR',
  0x14: 'Missing parameter',
  0x27: 'Operation denied',
  0x2e: 'No credentials',
  0x2f: 'Request timed out waiting for the user',
  0x30: 'Not allowed',
  0x31: 'Wrong PIN',
  0x32: 'PIN blocked. The key must be reset, which erases all passkeys',
  0x33: 'PIN authentication failed',
  0x34: 'Too many wrong PINs. Unplug and replug the key, then try again',
  0x35: 'No PIN is set on this key',
  0x36: 'PIN required',
  0x37: 'PIN does not meet the policy (too short or too long)',
  0x38: 'PIN token expired. Unlock again',
  0x39: 'Request too large',
  0x3e: 'Key is locked',
};

export class CtapError extends Error {
  readonly code: number;
  constructor(code: number, context: string) {
    super(`${context}: ${CTAP_ERRORS[code] ?? `CTAP error 0x${code.toString(16).padStart(2, '0')}`}`);
    this.name = 'CtapError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* APDU framing                                                        */
/* ------------------------------------------------------------------ */

export const FIDO_AID = Uint8Array.of(0xa0, 0x00, 0x00, 0x06, 0x47, 0x2f, 0x00, 0x01);
const CLA = 0x80;
const INS_CBOR = 0x10;

export const CTAP = { GET_INFO: 0x04, CLIENT_PIN: 0x06, CRED_MGMT: 0x0a } as const;

export const selectFidoApdu = () =>
  buildApdu({ cla: 0x00, ins: 0xa4, p1: 0x04, data: FIDO_AID, le: 0 });

/** Short APDU when it fits, extended-length otherwise. */
export function cborApdu(cmd: number, params?: CborValue): Uint8Array {
  const body = params === undefined ? Uint8Array.of(cmd) : concat(Uint8Array.of(cmd), cborEncode(params));
  if (body.length <= 255) return buildApdu({ cla: CLA, ins: INS_CBOR, data: body, le: 0 });
  if (body.length > 0xffff) throw new Error('CTAP request too large');
  return concat(
    Uint8Array.of(CLA, INS_CBOR, 0, 0, 0, body.length >> 8, body.length & 0xff),
    body,
    Uint8Array.of(0, 0)
  );
}

/** Response data = CTAP status byte + CBOR. SW 64xx carries a CTAP error. */
export function parseCtapResponse(data: Uint8Array, sw: number, context: string): CborValue | null {
  if ((sw & 0xff00) === 0x6400 && sw !== 0x6400) throw new CtapError(sw & 0xff, context);
  if (sw !== 0x9000) throw new Error(`${context}: SW ${sw.toString(16).toUpperCase().padStart(4, '0')}`);
  if (data.length === 0) return null;
  if (data[0] !== 0) throw new CtapError(data[0], context);
  return data.length > 1 ? cborDecode(data.subarray(1)) : null;
}

/* ------------------------------------------------------------------ */
/* Crypto (WebCrypto; works in browsers and Node 20+)                  */
/* ------------------------------------------------------------------ */

const subtle = () => globalThis.crypto.subtle;
const buf = (b: Uint8Array) => b as unknown as BufferSource;

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest('SHA-256', buf(data)));
}

async function aesKey(raw: Uint8Array) {
  return subtle().importKey('raw', buf(raw), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

/** AES-256-CBC, IV = 0, no padding (WebCrypto always pads, so drop the pad block). */
export async function aesCbcEncryptNoPad(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length % 16 !== 0) throw new Error('AES input must be a multiple of 16 bytes');
  const k = await aesKey(key);
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, k, buf(data)));
  return out.slice(0, data.length);
}

/** Decrypt unpadded AES-256-CBC (IV = 0) by appending a valid PKCS#7 block. */
export async function aesCbcDecryptNoPad(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error('AES input must be a multiple of 16 bytes');
  const k = await aesKey(key);
  const last = data.slice(data.length - 16);
  // Ciphertext of a full 0x10 padding block chained after `last`.
  const padBlock = new Uint8Array(
    await subtle().encrypt({ name: 'AES-CBC', iv: buf(last) }, k, buf(new Uint8Array(16).fill(16)))
  ).slice(0, 16);
  const out = await subtle().decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, k, buf(concat(data, padBlock)));
  return new Uint8Array(out);
}

export async function hmac16(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', buf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, buf(msg))).slice(0, 16);
}

/** UTF-8 PIN padded with zeros to 64 bytes (protocol 1 newPinEnc input). */
export function padPin(pin: string): Uint8Array {
  const b = new TextEncoder().encode(pin);
  if (b.length < 4) throw new Error('PIN must be at least 4 characters.');
  if (b.length > 63) throw new Error('PIN must be at most 63 bytes.');
  const out = new Uint8Array(64);
  out.set(b);
  return out;
}

export interface KeyAgreement {
  /** COSE_Key the platform sends to the authenticator. */
  platformKey: Map<CborValue, CborValue>;
  /** SHA-256(ECDH shared x-coordinate). */
  shared: Uint8Array;
}

/** ECDH P-256 with the authenticator's key-agreement key (protocol 1). */
export async function deriveShared(authenticatorCose: Map<CborValue, CborValue>): Promise<KeyAgreement> {
  const x = get.bytes(authenticatorCose, -2);
  const y = get.bytes(authenticatorCose, -3);
  if (!x || !y || x.length !== 32 || y.length !== 32) throw new Error('Key returned an invalid key-agreement key');
  const peer = await subtle().importKey('raw', buf(concat(Uint8Array.of(4), x, y)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const mine = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const z = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: peer }, mine.privateKey, 256));
  const pub = new Uint8Array(await subtle().exportKey('raw', mine.publicKey));
  const platformKey = new Map<CborValue, CborValue>([
    [1, 2],
    [3, -25],
    [-1, 1],
    [-2, pub.slice(1, 33)],
    [-3, pub.slice(33, 65)],
  ]);
  return { platformKey, shared: await sha256(z) };
}

/* ------------------------------------------------------------------ */
/* Request builders (pure, unit tested)                                */
/* ------------------------------------------------------------------ */

export const PIN = { RETRIES: 0x01, KEY_AGREEMENT: 0x02, SET: 0x03, CHANGE: 0x04, TOKEN_WITH_PERMISSIONS: 0x09 } as const;
export const PERM_CREDENTIAL_MGMT = 0x04;

export const CM = {
  METADATA: 0x01,
  RPS_BEGIN: 0x02,
  RPS_NEXT: 0x03,
  CREDS_BEGIN: 0x04,
  CREDS_NEXT: 0x05,
  DELETE: 0x06,
} as const;

export async function setPinParams(ka: KeyAgreement, pin: string) {
  const newPinEnc = await aesCbcEncryptNoPad(ka.shared, padPin(pin));
  return new Map<CborValue, CborValue>([
    [1, 1],
    [2, PIN.SET],
    [3, ka.platformKey],
    [4, await hmac16(ka.shared, newPinEnc)],
    [5, newPinEnc],
  ]);
}

export async function pinHashEnc(ka: KeyAgreement, pin: string) {
  return aesCbcEncryptNoPad(ka.shared, (await sha256(new TextEncoder().encode(pin))).slice(0, 16));
}

export async function changePinParams(ka: KeyAgreement, current: string, next: string) {
  const newPinEnc = await aesCbcEncryptNoPad(ka.shared, padPin(next));
  const hashEnc = await pinHashEnc(ka, current);
  return new Map<CborValue, CborValue>([
    [1, 1],
    [2, PIN.CHANGE],
    [3, ka.platformKey],
    [4, await hmac16(ka.shared, concat(newPinEnc, hashEnc))],
    [5, newPinEnc],
    [6, hashEnc],
  ]);
}

export async function tokenParams(ka: KeyAgreement, pin: string, permissions: number) {
  return new Map<CborValue, CborValue>([
    [1, 1],
    [2, PIN.TOKEN_WITH_PERMISSIONS],
    [3, ka.platformKey],
    [6, await pinHashEnc(ka, pin)],
    [9, permissions],
  ]);
}

/** CredentialManagement request; authenticated subcommands get pinUvAuthParam. */
export async function credMgmtParams(subCommand: number, sub?: Map<CborValue, CborValue>, token?: Uint8Array) {
  const m = new Map<CborValue, CborValue>([[1, subCommand]]);
  if (sub) m.set(2, sub);
  if (token) {
    const msg = sub ? concat(Uint8Array.of(subCommand), cborEncode(sub)) : Uint8Array.of(subCommand);
    m.set(3, 1);
    m.set(4, await hmac16(token, msg));
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Parsed results                                                      */
/* ------------------------------------------------------------------ */

export interface AuthenticatorInfo {
  versions: string[];
  aaguid: string;
  pinSet: boolean | null;
  credMgmt: boolean;
  minPinLength: number;
  firmware: number | null;
  remainingCreds: number | null;
}

export function parseInfo(m: CborValue | null): AuthenticatorInfo {
  const opts = get.map(m ?? undefined, 4);
  return {
    versions: (get.arr(m ?? undefined, 1) ?? []).filter((v): v is string => typeof v === 'string'),
    aaguid: toHex(get.bytes(m ?? undefined, 3) ?? new Uint8Array(0), ''),
    pinSet: get.bool(opts, 'clientPin') ?? null,
    credMgmt: !!(get.bool(opts, 'credMgmt') ?? get.bool(opts, 'credentialMgmtPreview')),
    minPinLength: get.num(m ?? undefined, 0x0d) ?? 4,
    firmware: get.num(m ?? undefined, 0x0e) ?? null,
    remainingCreds: get.num(m ?? undefined, 0x14) ?? null,
  };
}

export interface Passkey {
  credentialId: Uint8Array;
  userName: string;
  displayName: string;
  userId: Uint8Array;
  credProtect: number | null;
}

export interface RelyingParty {
  id: string;
  name: string | null;
  rpIdHash: Uint8Array;
  passkeys: Passkey[];
}

export function parseCredential(m: CborValue | null): Passkey {
  const user = get.map(m ?? undefined, 6);
  const desc = get.map(m ?? undefined, 7);
  const id = get.bytes(desc, 'id');
  if (!id) throw new Error('Key returned a credential without an ID');
  return {
    credentialId: id,
    userName: get.str(user, 'name') ?? '',
    displayName: get.str(user, 'displayName') ?? '',
    userId: get.bytes(user, 'id') ?? new Uint8Array(0),
    credProtect: get.num(m ?? undefined, 0x0a) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export interface ApduTransport {
  transmit(apdu: Uint8Array, opts?: { note?: string; timeoutMs?: number }): Promise<{ data: Uint8Array; sw: number }>;
}

export class FidoSession {
  private token: Uint8Array | null = null;

  constructor(private t: ApduTransport) {}

  async select() {
    const r = await this.t.transmit(selectFidoApdu(), { note: 'Select FIDO applet' });
    if (r.sw !== 0x9000) throw new Error('This key does not expose the FIDO applet over USB smart-card (CCID).');
  }

  private async call(cmd: number, params: CborValue | undefined, context: string) {
    const r = await this.t.transmit(cborApdu(cmd, params), { note: context });
    return parseCtapResponse(r.data, r.sw, context);
  }

  async info() {
    return parseInfo(await this.call(CTAP.GET_INFO, undefined, 'Get info'));
  }

  async pinRetries(): Promise<number | null> {
    const r = await this.call(CTAP.CLIENT_PIN, new Map<CborValue, CborValue>([[1, 1], [2, PIN.RETRIES]]), 'PIN retries');
    return get.num(r ?? undefined, 3) ?? null;
  }

  private async keyAgreement(): Promise<KeyAgreement> {
    const r = await this.call(CTAP.CLIENT_PIN, new Map<CborValue, CborValue>([[1, 1], [2, PIN.KEY_AGREEMENT]]), 'Key agreement');
    const cose = get.map(r ?? undefined, 1);
    if (!cose) throw new Error('Key did not return a key-agreement key');
    return deriveShared(cose);
  }

  async setPin(pin: string) {
    await this.call(CTAP.CLIENT_PIN, await setPinParams(await this.keyAgreement(), pin), 'Set PIN');
  }

  async changePin(current: string, next: string) {
    await this.call(CTAP.CLIENT_PIN, await changePinParams(await this.keyAgreement(), current, next), 'Change PIN');
    this.token = null;
  }

  /** Get a credential-management token. The PIN itself never leaves this tab unencrypted. */
  async unlock(pin: string) {
    const ka = await this.keyAgreement();
    const r = await this.call(CTAP.CLIENT_PIN, await tokenParams(ka, pin, PERM_CREDENTIAL_MGMT), 'Unlock');
    const enc = get.bytes(r ?? undefined, 2);
    if (!enc) throw new Error('Key did not return a PIN token');
    this.token = await aesCbcDecryptNoPad(ka.shared, enc);
  }

  get unlocked() {
    return this.token !== null;
  }

  lock() {
    this.token = null;
  }

  private need() {
    if (!this.token) throw new Error('Unlock with your PIN first.');
    return this.token;
  }

  async metadata(): Promise<{ existing: number; remaining: number }> {
    const r = await this.call(CTAP.CRED_MGMT, await credMgmtParams(CM.METADATA, undefined, this.need()), 'Storage info');
    return { existing: get.num(r ?? undefined, 1) ?? 0, remaining: get.num(r ?? undefined, 2) ?? 0 };
  }

  async listPasskeys(): Promise<RelyingParty[]> {
    const token = this.need();
    let first: CborValue | null;
    try {
      first = await this.call(CTAP.CRED_MGMT, await credMgmtParams(CM.RPS_BEGIN, undefined, token), 'List sites');
    } catch (e) {
      if (e instanceof CtapError && e.code === 0x2e) return [];
      throw e;
    }
    const total = get.num(first ?? undefined, 5) ?? 1;
    const rps: RelyingParty[] = [];
    let cur = first;
    for (let i = 0; i < total; i++) {
      if (i > 0) cur = await this.call(CTAP.CRED_MGMT, await credMgmtParams(CM.RPS_NEXT), 'Next site');
      const rp = get.map(cur ?? undefined, 3);
      const hash = get.bytes(cur ?? undefined, 4);
      if (!hash) continue;
      rps.push({ id: get.str(rp, 'id') ?? '(unknown site)', name: get.str(rp, 'name') ?? null, rpIdHash: hash, passkeys: [] });
    }
    for (const rp of rps) {
      const sub = new Map<CborValue, CborValue>([[1, rp.rpIdHash]]);
      const c0 = await this.call(CTAP.CRED_MGMT, await credMgmtParams(CM.CREDS_BEGIN, sub, token), `List passkeys for ${rp.id}`);
      const n = get.num(c0 ?? undefined, 9) ?? 1;
      rp.passkeys.push(parseCredential(c0));
      for (let i = 1; i < n; i++) {
        rp.passkeys.push(parseCredential(await this.call(CTAP.CRED_MGMT, await credMgmtParams(CM.CREDS_NEXT), 'Next passkey')));
      }
    }
    return rps;
  }

  async deletePasskey(credentialId: Uint8Array) {
    const sub = new Map<CborValue, CborValue>([
      [2, new Map<CborValue, CborValue>([['id', credentialId], ['type', 'public-key']])],
    ]);
    await this.call(CTAP.CRED_MGMT, await credMgmtParams(CM.DELETE, sub, this.need()), 'Delete passkey');
  }
}
