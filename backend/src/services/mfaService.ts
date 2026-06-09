import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../utils/crypto';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Generates a TOTP secret for a user.
 * The secret is encrypted with AES-256-GCM before storage.
 * Returns a QR code data URL for Google Authenticator setup.
 */
export async function generateMfaSecret(userId: string): Promise<{
  qrCodeUrl: string;
  manualEntryKey: string;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true }
  });

  if (!user) throw new Error('User not found');

  // Generate TOTP secret
  const secret = speakeasy.generateSecret({
    name: `Freelanci (${user.email})`,
    issuer: 'Freelanci',
    length: 32
  });

  // Encrypt the secret before storing in database
  const encryptedSecret = encrypt(secret.base32);

  // Store encrypted secret (MFA not yet enabled — user must verify first)
  await prisma.user.update({
    where: { id: userId },
    data: { mfaSecret: encryptedSecret }
  });

  // Generate QR code for Google Authenticator
  const otpauthUrl = secret.otpauth_url!;
  const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

  logger.info('MFA secret generated for user', { userId });

  return {
    qrCodeUrl,
    manualEntryKey: secret.base32
  };
}

/**
 * Verifies a TOTP token against the user's encrypted secret.
 * Window of 1 allows for 30-second clock drift.
 */
export async function verifyMfaToken(userId: string, token: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaSecret: true, mfaEnabled: true }
  });

  if (!user || !user.mfaSecret) {
    return false;
  }

  // Decrypt the stored secret
  const decryptedSecret = decrypt(user.mfaSecret);

  // Verify the TOTP token
  const isValid = speakeasy.totp.verify({
    secret: decryptedSecret,
    encoding: 'base32',
    token: token,
    window: 1 // Allow 30 seconds of clock drift
  });

  return isValid;
}

/**
 * Enables MFA for a user after successful first verification.
 */
export async function enableMfa(userId: string, token: string): Promise<boolean> {
  // Verify the token first — user must prove they have the authenticator set up
  const isValid = await verifyMfaToken(userId, token);

  if (!isValid) {
    return false;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: true }
  });

  logger.info('MFA enabled for user', { userId });
  return true;
}

/**
 * Disables MFA for a user. Requires current TOTP token for security.
 */
export async function disableMfa(userId: string, token: string): Promise<boolean> {
  const isValid = await verifyMfaToken(userId, token);

  if (!isValid) {
    return false;
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: false,
      mfaSecret: null
    }
  });

  logger.info('MFA disabled for user', { userId });
  return true;
}
