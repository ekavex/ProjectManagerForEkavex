/**
 * Password hashing.
 *
 * Argon2id with parameters that are deliberate rather than defaults: 19 MiB of memory and
 * three passes is the OWASP baseline, which keeps a login under ~100 ms on modest hardware
 * while making offline cracking expensive.
 */
import argon2 from 'argon2';
import { env } from '../config/env.js';

/**
 * Production parameters are the OWASP baseline: 19 MiB and three passes.
 *
 * The test suite signs dozens of users in per file, and at those settings the hashing
 * alone dominates the run. Tests therefore use the cheapest parameters argon2 accepts —
 * they verify the login *logic*, not the cost factor. This branch is on `NODE_ENV`, which
 * `env.ts` refuses to set to "test" in a deployed environment.
 */
const OPTIONS: argon2.Options = env.isTest
  ? // 1024 KiB and two passes are the lowest values this argon2 build accepts.
    { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 }
  : { type: argon2.argon2id, memoryCost: 19_456, timeCost: 3, parallelism: 1 };

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/**
 * Verifies a password. A malformed stored hash is treated as a mismatch rather than an
 * exception, so a corrupted row cannot turn into a 500 on the login route.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** True when the stored hash was produced with weaker parameters and should be upgraded. */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, OPTIONS);
  } catch {
    return true;
  }
}
