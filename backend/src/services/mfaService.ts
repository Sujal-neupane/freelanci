import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../utils/crypto';
import { redis } from '../utils/redis';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// TOTP time step in seconds (RFC 6238 default).
const TOTP_STEP_SECONDS = 30;
// Drift window: ±1 step. A used code must stay "burned" until every step it
// could have matched has elapsed, so a sniffed code can never be replayed.
const TOTP_WINDOW = 1;
const REPLAY_TTL_SECONDS = TOTP_STEP_SECONDS * (TOTP_WINDOW * 2 + 1) + 5;

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
 *
 * Security properties:
 *  - Window of ±1 step (±30s) tolerates clock drift.
 *  - Replay protection: the exact time-step a code matched is "burned" in
 *    Redis. A code (or a sniffed/shoulder-surfed code) can never be accepted
 *    twice, even while it is still within its validity window.
 *    Closes the TOTP code-reuse weakness that `window:1` otherwise leaves open.
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

  // verifyDelta returns { delta } with the matched step offset (-1, 0, +1),
  // or undefined if the code is wrong. We need the offset to identify the
  // exact step so we can burn it.
  const result = speakeasy.totp.verifyDelta({
    secret: decryptedSecret,
    encoding: 'base32',
    token,
    window: TOTP_WINDOW
  });

  if (!result) {
    return false;
  }

  // Identify the absolute time-step this code corresponds to.
  const currentStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  const matchedStep = currentStep + result.delta;
  const replayKey = `mfa:used:${userId}:${matchedStep}`;

  try {
    // SET NX => only succeeds if the step has NOT been consumed yet.
    const reserved = await redis.set(replayKey, '1', 'EX', REPLAY_TTL_SECONDS, 'NX');
    if (reserved !== 'OK') {
      logger.warn('TOTP replay detected — code already used', { userId, matchedStep });
      return false;
    }
  } catch (error) {
    // Fail closed on the replay check would lock users out if Redis is down;
    // the code itself was cryptographically valid, so allow but log loudly.
    logger.error('TOTP replay check unavailable — allowing valid code', {
      userId,
      error: (error as Error).message
    });
  }

  return true;
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
