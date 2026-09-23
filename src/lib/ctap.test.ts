import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { cborDecode, cborEncode, type CborValue } from './cbor';
import {
  aesCbcDecryptNoPad,
  aesCbcEncryptNoPad,
  changePinParams,
  cborApdu,
  credMgmtParams,
  CtapError,
  deriveShared,
  hmac16,
  padPin,
  parseCredential,
  parseCtapResponse,
  parseInfo,
  selectFidoApdu,
  setPinParams,
  tokenParams,
  type KeyAgreement,
} from './ctap';
import { toHex } from './protocol';

const hex = (b: Uint8Array) => toHex(b, '').toLowerCase();
const M = (...e: [CborValue, CborValue][]) => new Map<CborValue, CborValue>(e);

describe('CBOR', () => {
  test('negative ints, booleans, null and nested maps round-trip', () => {
    const v = M([1, -1], [2, true], [3, null], [4, 'hé'], [5, [1, -25]]);
    const back = cborDecode(cborEncode(v)) as Map<CborValue, CborValue>;
    expect(back.get(1)).toBe(-1);
    expect(back.get(2)).toBe(true);
    expect(back.get(3)).toBe(null);
    expect(back.get(4)).toBe('hé');
    expect(back.get(5)).toEqual([1, -25]);
  });

  test('COSE key encodes in CTAP2 canonical order regardless of insertion order', () => {
    const k = M(
      [-3, Uint8Array.of(3)],
      [-1, 1],
      [3, -25],
      [1, 2],
      [-2, Uint8Array.of(2)]
    );
    // 1, 3, -1, -2, -3 -> keys 01 03 20 21 22
    expect(hex(cborEncode(k))).toBe(
      'a5' + '0102' + '033818' + '2001' + '214102' + '224103'
    );
  });

  test('text keys sort shorter first', () => {
    expect(
      hex(cborEncode(M(['type', 'public-key'], ['id', Uint8Array.of(1)])))
    ).toMatch(/^a262696441/);
  });

  test('rejects trailing bytes and truncation', () => {
    expect(() => cborDecode(Uint8Array.of(0x01, 0x02))).toThrow(/trailing/);
    expect(() => cborDecode(Uint8Array.of(0x42, 0x01))).toThrow(/truncated/);
  });
});

describe('AES-256-CBC without padding', () => {
  test('matches Node crypto in both directions', async () => {
    const key = new Uint8Array(randomBytes(32));
    const data = new Uint8Array(randomBytes(64));
    const ours = await aesCbcEncryptNoPad(key, data);
    const c = createCipheriv('aes-256-cbc', key, Buffer.alloc(16));
    c.setAutoPadding(false);
    const node = Buffer.concat([c.update(data), c.final()]);
    expect(hex(ours)).toBe(hex(node));
    expect(hex(await aesCbcDecryptNoPad(key, ours))).toBe(hex(data));
    const d = createDecipheriv('aes-256-cbc', key, Buffer.alloc(16));
    d.setAutoPadding(false);
    expect(hex(Buffer.concat([d.update(ours), d.final()]))).toBe(hex(data));
  });

  test('rejects non-block input', async () => {
    await expect(
      aesCbcEncryptNoPad(new Uint8Array(32), new Uint8Array(15))
    ).rejects.toThrow();
  });
});

describe('PIN protocol 1', () => {
  const ka: KeyAgreement = {
    shared: new Uint8Array(32).fill(7),
    platformKey: M([1, 2]),
  };

  test('padPin enforces length', () => {
    expect(padPin('1234').length).toBe(64);
    expect(() => padPin('123')).toThrow(/at least 4/);
    expect(() => padPin('x'.repeat(64))).toThrow(/63/);
  });

  test('setPIN params: newPinEnc is 64 bytes and pinAuth = HMAC(shared, newPinEnc)[0..16]', async () => {
    const p = await setPinParams(ka, '1234');
    const enc = p.get(5) as Uint8Array;
    expect(p.get(2)).toBe(3);
    expect(enc.length).toBe(64);
    const want = createHmac('sha256', ka.shared)
      .update(enc)
      .digest()
      .subarray(0, 16);
    expect(hex(p.get(4) as Uint8Array)).toBe(hex(want));
    const d = createDecipheriv('aes-256-cbc', ka.shared, Buffer.alloc(16));
    d.setAutoPadding(false);
    expect(
      Buffer.concat([d.update(enc), d.final()])
        .subarray(0, 4)
        .toString()
    ).toBe('1234');
  });

  test('changePIN authenticates newPinEnc || pinHashEnc', async () => {
    const p = await changePinParams(ka, '1234', '5678');
    const msg = Buffer.concat([p.get(5) as Uint8Array, p.get(6) as Uint8Array]);
    expect(hex(p.get(4) as Uint8Array)).toBe(
      hex(createHmac('sha256', ka.shared).update(msg).digest().subarray(0, 16))
    );
    const d = createDecipheriv('aes-256-cbc', ka.shared, Buffer.alloc(16));
    d.setAutoPadding(false);
    const hash = Buffer.concat([d.update(p.get(6) as Uint8Array), d.final()]);
    expect(hex(hash)).toBe(
      hex(createHash('sha256').update('1234').digest().subarray(0, 16))
    );
  });

  test('token request asks for credential-management permission', async () => {
    const p = await tokenParams(ka, '1234', 0x04);
    expect(p.get(2)).toBe(9);
    expect(p.get(9)).toBe(4);
  });

  test('credMgmt auth covers subCommand || CBOR(params)', async () => {
    const token = new Uint8Array(32).fill(1);
    const sub = M([1, Uint8Array.of(9)]);
    const p = await credMgmtParams(4, sub, token);
    const msg = Buffer.concat([Buffer.of(4), cborEncode(sub)]);
    expect(hex(p.get(4) as Uint8Array)).toBe(hex(await hmac16(token, msg)));
    expect((await credMgmtParams(3)).has(4)).toBe(false);
  });

  test('ECDH derives the same secret as the authenticator would', async () => {
    const auth = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    const raw = new Uint8Array(
      await crypto.subtle.exportKey('raw', auth.publicKey)
    );
    const ka = await deriveShared(
      M([1, 2], [3, -25], [-1, 1], [-2, raw.slice(1, 33)], [-3, raw.slice(33)])
    );
    const px = ka.platformKey.get(-2) as Uint8Array;
    const py = ka.platformKey.get(-3) as Uint8Array;
    const peer = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from([4, ...px, ...py]),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
    const z = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: peer },
        auth.privateKey,
        256
      )
    );
    expect(hex(ka.shared)).toBe(hex(createHash('sha256').update(z).digest()));
  });
});

describe('framing and parsing', () => {
  test('select and short/extended CBOR APDUs', () => {
    expect(hex(selectFidoApdu())).toBe('00a4040008a0000006472f000100');
    expect(hex(cborApdu(4))).toBe('80100000010400');
    const big = cborApdu(0x0a, M([1, new Uint8Array(300)]));
    // body = cmd(1) + a1 01 59 012c (4) + 300 = 306 = 0x0132 -> extended Lc 00 01 32
    expect(hex(big.slice(0, 7))).toBe('80100000000132');
    expect(big.length).toBe(7 + 0x132 + 2);
  });

  test('CTAP status mapping', () => {
    expect(parseCtapResponse(Uint8Array.of(0, 0xa0), 0x9000, 'x')).toEqual(
      new Map()
    );
    expect(() =>
      parseCtapResponse(new Uint8Array(0), 0x6431, 'Unlock')
    ).toThrow(/Wrong PIN/);
    expect(() => parseCtapResponse(Uint8Array.of(0x35), 0x9000, 'x')).toThrow(
      CtapError
    );
  });

  test('getInfo and credential parsing', () => {
    const info = parseInfo(
      M(
        [1, ['FIDO_2_1']],
        [3, new Uint8Array(16)],
        [4, M(['clientPin', false], ['credMgmt', true])],
        [0x0d, 6]
      )
    );
    expect(info.pinSet).toBe(false);
    expect(info.credMgmt).toBe(true);
    expect(info.minPinLength).toBe(6);
    const c = parseCredential(
      M(
        [
          6,
          M(
            ['id', Uint8Array.of(1)],
            ['name', 'ana@example.com'],
            ['displayName', 'Ana']
          ),
        ],
        [7, M(['id', Uint8Array.of(9, 9)], ['type', 'public-key'])]
      )
    );
    expect(c.userName).toBe('ana@example.com');
    expect(hex(c.credentialId)).toBe('0909');
  });
});
