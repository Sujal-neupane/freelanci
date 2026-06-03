import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts text using AES-256-GCM.
 * Used for encrypting TOTP secrets before database storage.
 * Format: iv:authTag:encrypted (hex encoded)
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted text.
 * Throws if tampered with (GCM authentication).
 */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generates a cryptographically secure random string.
 */
export function generateSecureToken(length: number = 64): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Gets the 32-byte encryption key from environment variable.
 * Pads or hashes to ensure exact 32 bytes.
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.TOTP_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error('TOTP_ENCRYPTION_KEY environment variable is required');
  }
  // Hash the key to ensure exactly 32 bytes regardless of input length
  return crypto.createHash('sha256').update(envKey).digest();
}
