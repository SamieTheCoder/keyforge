// SPDX-License-Identifier: AGPL-3.0-only
//
// CBOR for CTAP2: unsigned/negative ints, byte and text strings, arrays,
// maps, booleans and null. Maps are encoded in CTAP2 canonical order
// (shorter encoded key first, then bytewise), which pico-fido enforces.

export type CborValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>;

function head(major: number, n: number | bigint, out: number[]) {
  const v = BigInt(n);
  const mt = major << 5;
  if (v < 24n) out.push(mt | Number(v));
  else if (v < 0x100n) out.push(mt | 24, Number(v));
  else if (v < 0x10000n) out.push(mt | 25, Number(v >> 8n), Number(v & 0xffn));
  else if (v < 0x100000000n) {
    out.push(mt | 26);
    for (let s = 24n; s >= 0n; s -= 8n) out.push(Number((v >> s) & 0xffn));
  } else {
    out.push(mt | 27);
    for (let s = 56n; s >= 0n; s -= 8n) out.push(Number((v >> s) & 0xffn));
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function enc(v: CborValue, out: number[]): void {
  if (typeof v === 'number' || typeof v === 'bigint') {
    if (typeof v === 'number' && !Number.isInteger(v))
      throw new Error('CBOR: floats are not supported');
    const b = BigInt(v);
    if (b >= 0n) head(0, b, out);
    else head(1, -1n - b, out);
  } else if (typeof v === 'boolean') out.push(v ? 0xf5 : 0xf4);
  else if (v === null) out.push(0xf6);
  else if (v instanceof Uint8Array) {
    head(2, v.length, out);
    for (const x of v) out.push(x);
  } else if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    head(3, b.length, out);
    for (const x of b) out.push(x);
  } else if (Array.isArray(v)) {
    head(4, v.length, out);
    for (const x of v) enc(x, out);
  } else if (v instanceof Map) {
    const entries = [...v.entries()].map(
      ([k, val]) => [cborEncode(k), cborEncode(val)] as const
    );
    entries.sort((a, b) => compareBytes(a[0], b[0]));
    head(5, entries.length, out);
    for (const [k, val] of entries) {
      for (const x of k) out.push(x);
      for (const x of val) out.push(x);
    }
  } else {
    throw new Error(`CBOR: cannot encode ${typeof v}`);
  }
}

export function cborEncode(v: CborValue): Uint8Array {
  const out: number[] = [];
  enc(v, out);
  return Uint8Array.from(out);
}

function dec(b: Uint8Array, p: number): [CborValue, number] {
  if (p >= b.length) throw new Error('CBOR: truncated input');
  const ib = b[p++];
  const major = ib >> 5;
  const info = ib & 0x1f;
  if (major === 7) {
    if (info === 20) return [false, p];
    if (info === 21) return [true, p];
    if (info === 22 || info === 23) return [null, p];
    throw new Error('CBOR: unsupported simple/float value');
  }
  let n: bigint;
  if (info < 24) n = BigInt(info);
  else if (info <= 27) {
    const len = 1 << (info - 24);
    if (p + len > b.length) throw new Error('CBOR: truncated input');
    n = 0n;
    for (let i = 0; i < len; i++) n = (n << 8n) | BigInt(b[p++]);
  } else throw new Error('CBOR: indefinite lengths are not supported');

  const small = () => {
    if (n > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('CBOR: length too large');
    return Number(n);
  };
  switch (major) {
    case 0:
      return [n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n, p];
    case 1: {
      const v = -1n - n;
      return [v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v, p];
    }
    case 2: {
      const len = small();
      if (p + len > b.length) throw new Error('CBOR: truncated byte string');
      return [b.slice(p, p + len), p + len];
    }
    case 3: {
      const len = small();
      if (p + len > b.length) throw new Error('CBOR: truncated text string');
      return [new TextDecoder().decode(b.subarray(p, p + len)), p + len];
    }
    case 4: {
      const arr: CborValue[] = [];
      for (let i = small(); i > 0; i--) {
        const [v, q] = dec(b, p);
        arr.push(v);
        p = q;
      }
      return [arr, p];
    }
    case 5: {
      const m = new Map<CborValue, CborValue>();
      for (let i = small(); i > 0; i--) {
        const [k, q] = dec(b, p);
        const [v, r] = dec(b, q);
        m.set(k, v);
        p = r;
      }
      return [m, p];
    }
    default:
      throw new Error(`CBOR: unsupported major type ${major}`);
  }
}

export function cborDecode(bytes: Uint8Array): CborValue {
  const [v, p] = dec(bytes, 0);
  if (p !== bytes.length) throw new Error('CBOR: trailing bytes');
  return v;
}

/** Typed accessors for decoded CTAP maps. */
export const get = {
  map: (
    m: CborValue | undefined,
    k: CborValue
  ): Map<CborValue, CborValue> | undefined => {
    const v = m instanceof Map ? m.get(k) : undefined;
    return v instanceof Map ? v : undefined;
  },
  bytes: (m: CborValue | undefined, k: CborValue): Uint8Array | undefined => {
    const v = m instanceof Map ? m.get(k) : undefined;
    return v instanceof Uint8Array ? v : undefined;
  },
  num: (m: CborValue | undefined, k: CborValue): number | undefined => {
    const v = m instanceof Map ? m.get(k) : undefined;
    return typeof v === 'number' ? v : undefined;
  },
  str: (m: CborValue | undefined, k: CborValue): string | undefined => {
    const v = m instanceof Map ? m.get(k) : undefined;
    return typeof v === 'string' ? v : undefined;
  },
  bool: (m: CborValue | undefined, k: CborValue): boolean | undefined => {
    const v = m instanceof Map ? m.get(k) : undefined;
    return typeof v === 'boolean' ? v : undefined;
  },
  arr: (m: CborValue | undefined, k: CborValue): CborValue[] | undefined => {
    const v = m instanceof Map ? m.get(k) : undefined;
    return Array.isArray(v) ? v : undefined;
  },
};
