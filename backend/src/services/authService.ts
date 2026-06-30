import bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';
import { validateEmail, validatePasswordStrength, checkHaveIBeenPwned } from '../utils/validators';
import { createAuditLog } from './auditService';
import { checkLockout, recordFailedAttempt, resetAttempts, MAX_ATTEMPTS } from './lockoutService';
import logger from '../utils/logger';

const prisma = new PrismaClient();
const BCRYPT_COST_FACTOR = 12;
const PASSWORD_HISTORY_LIMIT = 5;
const PASSWORD_EXPIRY_DAYS = 90;

// A real bcrypt hash (of a value no user will ever submit) used to equalise
// login response time when the account does not exist. Without this, a missing
// account skips the ~200ms bcrypt comparison and returns noticeably faster,
// letting an attacker enumerate valid emails by timing alone
// (PortSwigger: "Username enumeration via response timing"). Computed once at
// startup so the per-request cost matches a genuine comparison.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-attack-mitigation-placeholder', BCRYPT_COST_FACTOR);

// ─── Registration ────────────────────────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  role: 'CLIENT' | 'FREELANCER';
}

export async function register(input: RegisterInput, ip: string, userAgent: string) {
  const { email, password, name, role } = input;

  // Validate email format
  if (!validateEmail(email)) {
    return { success: false, error: 'Invalid email format' };
  }

  // Check if email already exists
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return { success: false, error: 'An account with this email already exists' };
  }

  // Validate password strength (zxcvbn + policy)
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    return {
      success: false,
      error: 'Password does not meet requirements',
      details: passwordValidation.errors,
      score: passwordValidation.score,
      feedback: passwordValidation.feedback
    };
  }

  // Check against HaveIBeenPwned database
  const breachCount = await checkHaveIBeenPwned(password);
  if (breachCount > 0) {
    return {
      success: false,
      error: `This password has appeared in ${breachCount.toLocaleString()} data breaches. Please choose a different password.`
    };
  }

  // Hash password with bcrypt cost factor 12
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);

  // Create user
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      name: name.trim(),
      passwordHash,
      role: role as Role,
      passwordChangedAt: new Date()
    }
  });

  // Store initial password in history
  await prisma.passwordHistory.create({
    data: {
      userId: user.id,
      passwordHash
    }
  });

  // Audit log
  await createAuditLog({
    userId: user.id,
    action: 'USER_REGISTERED',
    resourceType: 'user',
    resourceId: user.id,
    ipAddress: ip,
    userAgent,
    metadata: { role }
  });

  logger.info('User registered', { userId: user.id, role });

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  };
}

// ─── Login ───────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
  ip: string,
  userAgent: string
) {
  const normalizedEmail = email.toLowerCase().trim();

  // Check account lockout
  const lockoutStatus = await checkLockout(normalizedEmail);
  if (lockoutStatus.locked) {
    return {
      success: false,
      error: 'Account temporarily locked due to multiple failed login attempts',
      lockedUntil: lockoutStatus.remainingSeconds
    };
  }

  // Find user
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    // Perform a dummy bcrypt comparison so the response takes the same time as
    // a real (wrong-password) login. This removes the timing side-channel that
    // would otherwise reveal whether an email is registered.
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    // Still record failed attempt to prevent user enumeration via lockout state.
    await recordFailedAttempt(normalizedEmail, ip, userAgent);
    return { success: false, error: 'Invalid email or password' };
  }

  // Check if account is suspended
  if (user.suspended) {
    return { success: false, error: 'Account has been suspended. Contact support.' };
  }

  // Verify password
  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    const lockResult = await recordFailedAttempt(normalizedEmail, ip, userAgent);

    await createAuditLog({
      userId: user.id,
      action: 'LOGIN_FAILED',
      resourceType: 'auth',
      resourceId: user.id,
      ipAddress: ip,
      userAgent,
      metadata: { attempts: lockResult.attempts }
    });

    if (lockResult.locked) {
      return {
        success: false,
        error: 'Account temporarily locked due to multiple failed login attempts',
        lockedUntil: lockResult.remainingSeconds
      };
    }

    return {
      success: false,
      error: 'Invalid email or password',
      remainingAttempts: MAX_ATTEMPTS - lockResult.attempts
    };
  }

  // Reset failed attempts on successful password verification
  await resetAttempts(normalizedEmail);

  // Check 90-day password expiry
  const daysSinceChange = Math.floor(
    (Date.now() - user.passwordChangedAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysSinceChange >= PASSWORD_EXPIRY_DAYS) {
    await createAuditLog({
      userId: user.id,
      action: 'PASSWORD_EXPIRED',
      resourceType: 'auth',
      resourceId: user.id,
      ipAddress: ip,
      userAgent,
      metadata: { daysSinceChange }
    });

    return {
      success: false,
      error: 'Password has expired — please reset your password',
      passwordExpired: true,
      userId: user.id
    };
  }

  // Audit log successful login
  await createAuditLog({
    userId: user.id,
    action: 'LOGIN_SUCCESS',
    resourceType: 'auth',
    resourceId: user.id,
    ipAddress: ip,
    userAgent
  });

  // Check if MFA is required
  if (user.mfaEnabled) {
    return {
      success: true,
      requiresMfa: true,
      userId: user.id,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    };
  }

  return {
    success: true,
    requiresMfa: false,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mfaEnabled: user.mfaEnabled
    }
  };
}

// ─── Change Password ─────────────────────────────────────────────

export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
  ip: string,
  userAgent: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  // Verify old password
  const oldPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!oldPasswordValid) {
    return { success: false, error: 'Current password is incorrect' };
  }

  // Validate new password strength
  const validation = validatePasswordStrength(newPassword);
  if (!validation.valid) {
    return {
      success: false,
      error: 'New password does not meet requirements',
      details: validation.errors
    };
  }

  // Check against HaveIBeenPwned
  const breachCount = await checkHaveIBeenPwned(newPassword);
  if (breachCount > 0) {
    return {
      success: false,
      error: `This password has appeared in ${breachCount.toLocaleString()} data breaches`
    };
  }

  // Check against last 5 passwords (password history)
  const passwordHistories = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: PASSWORD_HISTORY_LIMIT
  });

  for (const history of passwordHistories) {
    const isReused = await bcrypt.compare(newPassword, history.passwordHash);
    if (isReused) {
      return {
        success: false,
        error: 'Cannot reuse any of your last 5 passwords'
      };
    }
  }

  // Hash new password
  const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_COST_FACTOR);

  // Update user password and timestamp
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: newPasswordHash,
      passwordChangedAt: new Date()
    }
  });

  // Add to password history
  await prisma.passwordHistory.create({
    data: {
      userId,
      passwordHash: newPasswordHash
    }
  });

  // Clean up old history entries (keep only last 5)
  const allHistory = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
  if (allHistory.length > PASSWORD_HISTORY_LIMIT) {
    const toDelete = allHistory.slice(PASSWORD_HISTORY_LIMIT).map(h => h.id);
    await prisma.passwordHistory.deleteMany({
      where: { id: { in: toDelete } }
    });
  }

  // Audit log
  await createAuditLog({
    userId,
    action: 'PASSWORD_CHANGED',
    resourceType: 'auth',
    resourceId: userId,
    ipAddress: ip,
    userAgent
  });

  logger.info('Password changed', { userId });

  return { success: true };
}

// ─── Force Reset (for expired passwords) ─────────────────────────

export async function forceResetPassword(
  userId: string,
  newPassword: string,
  ip: string,
  userAgent: string
) {
  // Same validation as changePassword but without requiring old password
  const validation = validatePasswordStrength(newPassword);
  if (!validation.valid) {
    return { success: false, error: 'Password does not meet requirements', details: validation.errors };
  }

  const breachCount = await checkHaveIBeenPwned(newPassword);
  if (breachCount > 0) {
    return { success: false, error: `Password found in ${breachCount.toLocaleString()} data breaches` };
  }

  // Check password history
  const passwordHistories = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: PASSWORD_HISTORY_LIMIT
  });

  for (const history of passwordHistories) {
    const isReused = await bcrypt.compare(newPassword, history.passwordHash);
    if (isReused) {
      return { success: false, error: 'Cannot reuse any of your last 5 passwords' };
    }
  }

  const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_COST_FACTOR);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newPasswordHash, passwordChangedAt: new Date() }
  });

  await prisma.passwordHistory.create({
    data: { userId, passwordHash: newPasswordHash }
  });

  await createAuditLog({
    userId,
    action: 'PASSWORD_FORCE_RESET',
    resourceType: 'auth',
    resourceId: userId,
    ipAddress: ip,
    userAgent
  });

  return { success: true };
}
