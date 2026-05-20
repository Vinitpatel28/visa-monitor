// ============================================================
// Encryption Utilities — AES-256 for PII data (passport, names)
// ============================================================

import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-cbc';

// Ensure key is exactly 32 bytes
function getKey(): Buffer {
  return crypto.createHash('sha256').update(config.encryption.key).digest();
}

// Ensure IV is exactly 16 bytes
function getIV(): Buffer {
  return crypto.createHash('md5').update(config.encryption.iv).digest();
}

/**
 * Encrypt a plaintext string (e.g., passport number, full name)
 */
export function encrypt(text: string): string {
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), getIV());
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

/**
 * Decrypt an encrypted string back to plaintext
 */
export function decrypt(encryptedText: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), getIV());
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Hash a value (one-way, for passport_hash in logs)
 */
export function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Generate a random OTP of specified length
 */
export function generateOTP(length: number = 6): string {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[crypto.randomInt(0, digits.length)];
  }
  return otp;
}
