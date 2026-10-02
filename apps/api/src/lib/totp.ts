/**
 * Time-based one-time passwords (RFC 6238, with RFC 4226 HOTP underneath): HMAC-SHA1,
 * 30-second steps, six digits — the defaults every authenticator app uses.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new 160-bit secret, base32-encoded for the authenticator app. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] as number) & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totp(secret: string, at: Date = new Date()): string {
  return hotp(secret, Math.floor(at.getTime() / 1000 / STEP_SECONDS));
}

/**
 * Accepts the code for the current step and one step either side, which absorbs clock
 * drift between the server and the phone without widening the window much.
 */
export function verifyTotp(secret: string, code: string, at: Date = new Date()): boolean {
  const candidate = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;
  const step = Math.floor(at.getTime() / 1000 / STEP_SECONDS);
  for (const drift of [-1, 0, 1]) {
    const expected = Buffer.from(hotp(secret, step + drift));
    if (timingSafeEqual(expected, Buffer.from(candidate))) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, accountName: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Ten single-use recovery codes, formatted xxxxx-xxxxx for reading aloud. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
}
