import { Router, Request, Response } from 'express';
import { register, login, changePassword, forceResetPassword } from '../services/authService';
import { generateMfaSecret, verifyMfaToken, enableMfa, disableMfa } from '../services/mfaService';
import {
  getRegistrationOptions, verifyRegistration,
  getAuthenticationOptions, verifyAuthentication
} from '../services/webauthnService';
import { createAuditLog, getAuditLogs } from '../services/auditService';
import { createSecurityAlert } from '../services/alertService';
import { requireAuth, requireMfaComplete } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

// Max TOTP guesses allowed within a single pending-MFA session before we tear
// it down. A 6-digit code has 10^6 possibilities; capping attempts per session
// (and requiring a fresh credential check to get a new pending session) makes
// brute-forcing the second factor infeasible.
const MAX_MFA_ATTEMPTS = 5;

// ─── Helper: Session Regeneration that Preserves CSRF Token ──────
// The core bug fix: when Express regenerates the session (to prevent
// session fixation), the old session data is discarded — including
// the CSRF token. This helper saves the CSRF token before regeneration
// and restores it into the new session.
function regenerateSessionSafe(
  req: Request,
  sessionData: Record<string, unknown>,
  callback: (err: Error | null) => void
): void {
  const oldCsrfToken = req.session?.csrfToken;

  req.session.regenerate((err) => {
    if (err) {
      return callback(err);
    }

    // Restore CSRF token so the browser's XSRF-TOKEN cookie stays valid
    if (oldCsrfToken) {
      req.session.csrfToken = oldCsrfToken;
    }

    // Apply all provided session data
    for (const [key, value] of Object.entries(sessionData)) {
      (req.session as any)[key] = value;
    }

    // Always set timestamps
    req.session.createdAt = Date.now();
    req.session.lastActive = Date.now();

    callback(null);
  });
}

// ─── POST /api/auth/register ─────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name || !role) {
      res.status(400).json({ error: 'Email, password, name, and role are required' });
      return;
    }

    if (!['CLIENT', 'FREELANCER'].includes(role)) {
      res.status(400).json({ error: 'Role must be CLIENT or FREELANCER' });
      return;
    }

    const ip = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    const result = await register({ email, password, name, role }, ip, userAgent);

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.status(201).json({
      message: 'Registration successful',
      user: result.user
    });
  } catch (error) {
    logger.error('Registration error', { error: (error as Error).message });
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /api/auth/login ────────────────────────────────────────
// Step 1: Verify credentials. If MFA enabled, returns requiresMfa: true
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const ip = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    const result = await login(email, password, ip, userAgent);

    if (!result.success) {
      const statusCode = (result as any).lockedUntil ? 423 : 401;
      res.status(statusCode).json(result);
      return;
    }

    if (result.requiresMfa) {
      // Regenerate session to prevent fixation, then set pending MFA state
      regenerateSessionSafe(req, {
        mfaPending: true,
        pendingUserId: result.userId,
        mfaVerified: false,
        userAgent
      }, (err) => {
        if (err) {
          logger.error('Session regen failed (MFA init)', { error: err.message });
          res.status(500).json({ error: 'Failed to initialize MFA session' });
          return;
        }

        res.json({
          message: 'Credentials verified — MFA code required',
          requiresMfa: true
        });
      });
      return;
    }

    // No MFA — regenerate session to prevent fixation and establish authenticated session
    regenerateSessionSafe(req, {
      userId: result.user!.id,
      email: result.user!.email,
      role: result.user!.role,
      userAgent,
      mfaVerified: true,
      mfaPending: false
    }, (err) => {
      if (err) {
        logger.error('Session regen failed (login)', { error: err.message });
        res.status(500).json({ error: 'Failed to establish session' });
        return;
      }

      res.json({
        message: 'Login successful',
        user: result.user
      });
    });
  } catch (error) {
    logger.error('Login error', { error: (error as Error).message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── POST /api/auth/login/mfa ────────────────────────────────────
// Step 2: Verify TOTP code after credentials
router.post('/login/mfa', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!req.session.mfaPending || !req.session.pendingUserId) {
      res.status(400).json({ error: 'No pending MFA verification' });
      return;
    }

    if (!token || token.length !== 6) {
      res.status(400).json({ error: 'A 6-digit code is required' });
      return;
    }

    const userId = req.session.pendingUserId;
    const isValid = await verifyMfaToken(userId, token);

    if (!isValid) {
      const ip = req.ip || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Count this failed guess against the pending session.
      req.session.mfaAttempts = (req.session.mfaAttempts || 0) + 1;
      const attempts = req.session.mfaAttempts;

      await createAuditLog({
        userId,
        action: 'MFA_VERIFICATION_FAILED',
        resourceType: 'auth',
        resourceId: userId,
        ipAddress: ip,
        userAgent,
        metadata: { attempts }
      });

      // Too many guesses → assume brute-force. Destroy the pending session so
      // the attacker must pass the password check again to get a new one, and
      // surface a security alert for the admins.
      if (attempts >= MAX_MFA_ATTEMPTS) {
        await createSecurityAlert(
          'MFA_BRUTE_FORCE',
          'HIGH',
          `Pending MFA session exceeded ${MAX_MFA_ATTEMPTS} failed code attempts`,
          ip,
          userId
        );

        req.session.destroy(() => {});
        res.clearCookie('__freelanci_sid');
        res.status(429).json({
          error: 'Too many incorrect codes — please log in again',
          mfaSessionTerminated: true
        });
        return;
      }

      res.status(401).json({
        error: 'Invalid MFA code',
        remainingAttempts: MAX_MFA_ATTEMPTS - attempts
      });
      return;
    }

    // Fetch user details
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, mfaEnabled: true }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Complete session — regenerate to bind fresh session id after 2nd factor
    const userAgent = req.get('User-Agent') || 'unknown';
    regenerateSessionSafe(req, {
      userId: user.id,
      email: user.email,
      role: user.role,
      userAgent,
      mfaVerified: true,
      mfaPending: false,
      pendingUserId: undefined
    }, (err) => {
      if (err) {
        logger.error('Session regen failed (MFA complete)', { error: err.message });
        res.status(500).json({ error: 'Failed to establish session' });
        return;
      }

      res.json({
        message: 'MFA verification successful',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mfaEnabled: user.mfaEnabled
        }
      });
    });
  } catch (error) {
    logger.error('MFA verification error', { error: (error as Error).message });
    res.status(500).json({ error: 'MFA verification failed' });
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    const ip = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    await createAuditLog({
      userId,
      action: 'LOGOUT',
      resourceType: 'auth',
      resourceId: userId,
      ipAddress: ip,
      userAgent
    });

    // Fully destroy session — removes from Redis
    req.session.destroy((err) => {
      if (err) {
        logger.error('Session destruction failed', { error: err.message });
        res.status(500).json({ error: 'Logout failed' });
        return;
      }
      // Clear cookie with same attributes to ensure browser removes it
      res.clearCookie('__freelanci_sid', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        path: '/'
      });
      res.json({ message: 'Logged out successfully' });
    });
  } catch (error) {
    logger.error('Logout error', { error: (error as Error).message });
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────
router.get('/me', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        mfaEnabled: true,
        passwordChangedAt: true,
        createdAt: true
      }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (error) {
    logger.error('Get user error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ─── POST /api/auth/mfa/setup ────────────────────────────────────
router.post('/mfa/setup', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    // Check if MFA already enabled
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true }
    });

    if (user?.mfaEnabled) {
      res.status(400).json({ error: 'MFA is already enabled' });
      return;
    }

    const result = await generateMfaSecret(userId);

    res.json({
      message: 'Scan the QR code with Google Authenticator, then verify with a code',
      qrCodeUrl: result.qrCodeUrl,
      manualEntryKey: result.manualEntryKey
    });
  } catch (error) {
    logger.error('MFA setup error', { error: (error as Error).message });
    res.status(500).json({ error: 'MFA setup failed' });
  }
});

// ─── POST /api/auth/mfa/verify-setup ─────────────────────────────
router.post('/mfa/verify-setup', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    const userId = req.session.userId!;
    const email = req.session.email!;
    const role = req.session.role!;
    const userAgent = req.session.userAgent || req.get('User-Agent') || 'unknown';

    if (!token || token.length !== 6) {
      res.status(400).json({ error: 'A 6-digit code is required' });
      return;
    }

    const success = await enableMfa(userId, token);

    if (!success) {
      res.status(400).json({ error: 'Invalid code — please try again' });
      return;
    }

    const ip = req.ip || 'unknown';

    await createAuditLog({
      userId,
      action: 'MFA_ENABLED',
      resourceType: 'auth',
      resourceId: userId,
      ipAddress: ip,
      userAgent
    });

    // Rotate session after enabling MFA — preserve ALL session state
    regenerateSessionSafe(req, {
      userId,
      email,
      role,
      userAgent,
      mfaVerified: true,
      mfaPending: false
    }, (err) => {
      if (err) {
        logger.error('Session regen failed (mfa enable)', { error: err.message });
      }
      res.json({ message: 'MFA enabled successfully' });
    });
  } catch (error) {
    logger.error('MFA verify setup error', { error: (error as Error).message });
    res.status(500).json({ error: 'MFA verification failed' });
  }
});

// ─── POST /api/auth/mfa/disable ──────────────────────────────────
router.post('/mfa/disable', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    const userId = req.session.userId!;
    const email = req.session.email!;
    const role = req.session.role!;
    const userAgent = req.session.userAgent || req.get('User-Agent') || 'unknown';

    if (!token || token.length !== 6) {
      res.status(400).json({ error: 'Current MFA code required to disable' });
      return;
    }

    const success = await disableMfa(userId, token);

    if (!success) {
      res.status(400).json({ error: 'Invalid MFA code' });
      return;
    }

    const ip = req.ip || 'unknown';

    await createAuditLog({
      userId,
      action: 'MFA_DISABLED',
      resourceType: 'auth',
      resourceId: userId,
      ipAddress: ip,
      userAgent
    });

    // Rotate session after disabling MFA — preserve session state
    regenerateSessionSafe(req, {
      userId,
      email,
      role,
      userAgent,
      mfaVerified: true,
      mfaPending: false
    }, (err) => {
      if (err) {
        logger.error('Session regen failed (mfa disable)', { error: err.message });
      }
      res.json({ message: 'MFA disabled successfully' });
    });
  } catch (error) {
    logger.error('MFA disable error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to disable MFA' });
  }
});

// ─── POST /api/auth/change-password ──────────────────────────────
router.post('/change-password', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.session.userId!;
    const email = req.session.email!;
    const role = req.session.role!;
    const ip = req.ip || 'unknown';
    const userAgent = req.session.userAgent || req.get('User-Agent') || 'unknown';

    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: 'Old and new passwords are required' });
      return;
    }

    const result = await changePassword(userId, oldPassword, newPassword, ip, userAgent);

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    // Rotate session after password change — preserve session state
    regenerateSessionSafe(req, {
      userId,
      email,
      role,
      userAgent,
      mfaVerified: true,
      mfaPending: false
    }, (err) => {
      if (err) {
        logger.error('Session regen failed (password change)', { error: err.message });
      }
      res.json({ message: 'Password changed successfully' });
    });
  } catch (error) {
    logger.error('Change password error', { error: (error as Error).message });
    res.status(500).json({ error: 'Password change failed' });
  }
});

// ─── POST /api/auth/force-reset ──────────────────────────────────
// SECURITY FIX: Now requires admin authentication
router.post('/force-reset', requireAuth, requireMfaComplete, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { userId, newPassword } = req.body;
    const ip = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    if (!userId || !newPassword) {
      res.status(400).json({ error: 'User ID and new password are required' });
      return;
    }

    const result = await forceResetPassword(userId, newPassword, ip, userAgent);

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.json({ message: 'Password reset successfully — please log in' });
  } catch (error) {
    logger.error('Force reset error', { error: (error as Error).message });
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ─── WebAuthn / Passkey (passwordless) ───────────────────────────

// POST /api/auth/webauthn/register/options — begin passkey enrolment
router.post('/webauthn/register/options', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const email = req.session.email!;
    const options = await getRegistrationOptions(userId, email);

    // Stash the challenge server-side; the verify step must match it.
    req.session.webauthnChallenge = options.challenge;
    res.json(options);
  } catch (error) {
    logger.error('WebAuthn register options error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to start passkey registration' });
  }
});

// POST /api/auth/webauthn/register/verify — finish passkey enrolment
router.post('/webauthn/register/verify', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const expectedChallenge = req.session.webauthnChallenge;

    if (!expectedChallenge) {
      res.status(400).json({ error: 'No passkey registration in progress' });
      return;
    }

    const verified = await verifyRegistration(userId, req.body, expectedChallenge);
    req.session.webauthnChallenge = undefined;

    if (!verified) {
      res.status(400).json({ error: 'Passkey registration could not be verified' });
      return;
    }

    await createAuditLog({
      userId,
      action: 'WEBAUTHN_REGISTERED',
      resourceType: 'auth',
      resourceId: userId,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown'
    });

    res.json({ message: 'Passkey registered successfully' });
  } catch (error) {
    logger.error('WebAuthn register verify error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to register passkey' });
  }
});

// POST /api/auth/webauthn/login/options — begin passwordless login
router.post('/webauthn/login/options', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const { options, userId } = await getAuthenticationOptions(email);

    // Bind the challenge (and resolved user, if any) to the session.
    req.session.webauthnChallenge = options.challenge;
    req.session.webauthnUserId = userId;
    res.json(options);
  } catch (error) {
    logger.error('WebAuthn login options error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to start passwordless login' });
  }
});

// POST /api/auth/webauthn/login/verify — finish passwordless login
router.post('/webauthn/login/verify', async (req: Request, res: Response) => {
  try {
    const expectedChallenge = req.session.webauthnChallenge;
    if (!expectedChallenge) {
      res.status(400).json({ error: 'No passwordless login in progress' });
      return;
    }

    const { verified, userId } = await verifyAuthentication(req.body, expectedChallenge);
    req.session.webauthnChallenge = undefined;
    req.session.webauthnUserId = undefined;

    if (!verified || !userId) {
      res.status(401).json({ error: 'Passkey authentication failed' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, mfaEnabled: true, suspended: true }
    });

    if (!user || user.suspended) {
      res.status(403).json({ error: 'Account unavailable' });
      return;
    }

    const userAgent = req.get('User-Agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      action: 'WEBAUTHN_LOGIN_SUCCESS',
      resourceType: 'auth',
      resourceId: user.id,
      ipAddress: req.ip || 'unknown',
      userAgent
    });

    // Passkey verification is itself a strong, phishing-resistant factor, so it
    // establishes a fully authenticated session (mfaVerified). Regenerate to
    // prevent session fixation.
    regenerateSessionSafe(req, {
      userId: user.id,
      email: user.email,
      role: user.role,
      userAgent,
      mfaVerified: true,
      mfaPending: false
    }, (err) => {
      if (err) {
        logger.error('Session regen failed (webauthn login)', { error: err.message });
        res.status(500).json({ error: 'Failed to establish session' });
        return;
      }
      res.json({
        message: 'Passwordless login successful',
        user: { id: user.id, email: user.email, name: user.name, role: user.role, mfaEnabled: user.mfaEnabled }
      });
    });
  } catch (error) {
    logger.error('WebAuthn login verify error', { error: (error as Error).message });
    res.status(500).json({ error: 'Passwordless login failed' });
  }
});

// ─── GET /api/auth/activity ──────────────────────────────────────
// User-facing activity log: shows the current user's own audit events
router.get('/activity', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const action = req.query.action as string;

    const options: {
      userId: string;
      action?: string;
      page: number;
      limit: number;
    } = { userId, page, limit };

    if (action) {
      options.action = action;
    }

    const result = await getAuditLogs(options);

    res.json(result);
  } catch (error) {
    logger.error('Activity log error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

export default router;
