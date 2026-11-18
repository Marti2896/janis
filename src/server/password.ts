import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { ValidationError } from "./scope.ts";

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function assertPasswordPolicy(plain: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`, "password");
  }
}

/** Password temporanea casuale (mostrata una sola volta), sempre conforme alla policy. */
export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
