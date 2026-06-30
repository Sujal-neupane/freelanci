import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON
} from '@simplewebauthn/server';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * WebAuthn (FIDO2 / passkey) passwordless authentication.
 *
 * Why this is genuinely "advanced": a passkey is a per-origin asymmetric key
 * pair held in the authenticator (Touch ID, Windows Hello, a security key).
 * The server only ever stores a PUBLIC key, so a database breach yields nothing
 * an attacker can log in with. Because the signed challenge is bound to the RP
 * ID (origin), passkeys are inherently phishing-proof and immune to credential
 * stuffing, password reuse and replay — entire attack classes that passwords
 * (even strong, MFA-protected ones) remain exposed to.
 *
 * Relying Party config — the RP ID must equal the site's registrable domain and
 * the expected origin must match the browser origin exactly, or verification
 * fails. These come from env so dev/prod differ without code changes.
 */
const RP_NAME = 'Freelanci';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const EXPECTED_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173';

// ─── Registration ────────────────────────────────────────────────

/**
 * Step 1 of enrolling a passkey for an already-authenticated user. Returns the
 * options the browser passes to navigator.credentials.create(). The challenge
 * must be persisted (we put it in the session) for the verify step.
 */
export async function getRegistrationOptions(userId: string, email: string) {
  const existing = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { id: true, transports: true }
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: email,
    userID: Buffer.from(userId),
    attestationType: 'none',
    // Prevent registering the same authenticator twice.
    excludeCredentials: existing.map(c => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[]
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred'
    }
  });

  return options;
}

/**
 * Step 2 of enrolment: verify the attestation the browser produced and, on
 * success, persist the new credential's public key.
 */
export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string
): Promise<boolean> {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: EXPECTED_ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: false
  });

  if (!verification.verified || !verification.registrationInfo) {
    return false;
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  await prisma.webAuthnCredential.create({
    data: {
      id: credential.id,
      userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp
    }
  });

  logger.info('WebAuthn credential registered', { userId, credentialId: credential.id });
  return true;
}

// ─── Authentication (passwordless login) ─────────────────────────

/**
 * Step 1 of passwordless login. Given an email, return the challenge + the
 * allowed credential IDs so the browser can sign with a matching passkey.
 * We always return options (even for unknown emails) to avoid revealing whether
 * an account exists.
 */
export async function getAuthenticationOptions(email: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, webauthnCredentials: { select: { id: true, transports: true } } }
  });

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    allowCredentials: (user?.webauthnCredentials ?? []).map(c => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[]
    }))
  });

  return { options, userId: user?.id };
}

/**
 * Step 2 of passwordless login: verify the assertion. On success we bump the
 * stored signature counter — a counter that goes backwards indicates a cloned
 * authenticator and is rejected.
 */
export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string
): Promise<{ verified: boolean; userId?: string }> {
  const credential = await prisma.webAuthnCredential.findUnique({
    where: { id: response.id }
  });

  if (!credential) {
    return { verified: false };
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: EXPECTED_ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: false,
    credential: {
      id: credential.id,
      publicKey: new Uint8Array(credential.publicKey),
      counter: Number(credential.counter),
      transports: credential.transports as AuthenticatorTransportFuture[]
    }
  });

  if (!verification.verified) {
    return { verified: false };
  }

  await prisma.webAuthnCredential.update({
    where: { id: credential.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date()
    }
  });

  return { verified: true, userId: credential.userId };
}

// Local alias to avoid importing the deep type path everywhere.
type AuthenticatorTransportFuture =
  'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';
