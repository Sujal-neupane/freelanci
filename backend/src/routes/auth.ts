import { Router, Request, Response } from 'express';
import { register, login, changePassword, forceResetPassword } from '../services/authService';
import { generateMfaSecret, verifyMfaToken, enableMfa, disableMfa } from '../services/mfaService';
import { createAuditLog } from '../services/auditService';
import { requireAuth, requireMfaComplete } from '../middleware/auth';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

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
      // Store pending MFA state in session
      req.session.mfaPending = true;
      req.session.pendingUserId = result.userId;
      req.session.mfaVerified = false;

      res.json({
        message: 'Credentials verified — MFA code required',
        requiresMfa: true
      });
      return;
    }

    // No MFA — create full session
    req.session.userId = result.user!.id;
    req.session.email = result.user!.email;
    req.session.role = result.user!.role;
    req.session.userAgent = userAgent;
    req.session.mfaVerified = true;
    req.session.mfaPending = false;

    res.json({
      message: 'Login successful',
      user: result.user
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

      await createAuditLog({
        userId,
        action: 'MFA_VERIFICATION_FAILED',
        resourceType: 'auth',
        resourceId: userId,
        ipAddress: ip,
        userAgent
      });

      res.status(401).json({ error: 'Invalid MFA code' });
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

    // Complete session
    const userAgent = req.get('User-Agent') || 'unknown';
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role;
    req.session.userAgent = userAgent;
    req.session.mfaVerified = true;
    req.session.mfaPending = false;
    req.session.pendingUserId = undefined;

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
      res.clearCookie('__freelanci_sid');
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
    const userAgent = req.get('User-Agent') || 'unknown';

    await createAuditLog({
      userId,
      action: 'MFA_ENABLED',
      resourceType: 'auth',
      resourceId: userId,
      ipAddress: ip,
      userAgent
    });

    res.json({ message: 'MFA enabled successfully' });
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
    const userAgent = req.get('User-Agent') || 'unknown';

    await createAuditLog({
      userId,
      action: 'MFA_DISABLED',
      resourceType: 'auth',
      resourceId: userId,
      ipAddress: ip,
      userAgent
    });

    res.json({ message: 'MFA disabled successfully' });
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
    const ip = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: 'Old and new passwords are required' });
      return;
    }

    const result = await changePassword(userId, oldPassword, newPassword, ip, userAgent);

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Change password error', { error: (error as Error).message });
    res.status(500).json({ error: 'Password change failed' });
  }
});

// ─── POST /api/auth/force-reset ──────────────────────────────────
router.post('/force-reset', async (req: Request, res: Response) => {
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

export default router;
