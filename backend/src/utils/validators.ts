import validator from 'validator';
import crypto from 'crypto';
import https from 'https';
import logger from './logger';

// We'll import zxcvbn dynamically since it's a CJS module
let zxcvbn: (password: string) => { score: number; feedback: { warning: string; suggestions: string[] } };

// Load zxcvbn synchronously
try {
  zxcvbn = require('zxcvbn');
} catch {
  logger.warn('zxcvbn not loaded — password strength checking disabled');
  zxcvbn = () => ({ score: 4, feedback: { warning: '', suggestions: [] } });
}

/**
 * Password policy requirements:
 * - Minimum 12 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 * - zxcvbn score >= 3
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  score: number;
  feedback: {
    warning: string;
    suggestions: string[];
  };
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  const result = zxcvbn(password);

  if (result.score < 3) {
    errors.push('Password is too weak — please choose a stronger password');
  }

  return {
    valid: errors.length === 0,
    errors,
    score: result.score,
    feedback: result.feedback
  };
}

/**
 * Validates email format using validator.js
 */
export function validateEmail(email: string): boolean {
  return validator.isEmail(email);
}

/**
 * Sanitises string input — trims and escapes HTML entities
 */
export function sanitiseInput(input: string): string {
  return validator.trim(validator.escape(input));
}

/**
 * Checks password against HaveIBeenPwned database using k-anonymity model.
 * Only sends first 5 characters of SHA-1 hash — password never leaves the server.
 * Returns the number of times the password has been found in breaches.
 */
export async function checkHaveIBeenPwned(password: string): Promise<number> {
  if (process.env.HIBP_API_ENABLED !== 'true') {
    return 0;
  }

  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.substring(0, 5);
    const suffix = sha1.substring(5);

    const responseBody = await new Promise<string>((resolve, reject) => {
      const req = https.get(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        {
          headers: { 'User-Agent': 'Freelanci-Security-Check' }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve(data));
        }
      );
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('HIBP request timed out'));
      });
    });

    const lines = responseBody.split('\n');
    for (const line of lines) {
      const [hashSuffix, count] = line.trim().split(':');
      if (hashSuffix === suffix) {
        return parseInt(count, 10);
      }
    }

    return 0;
  } catch (error) {
    // Fail open — don't block registration if HIBP is down
    logger.warn('HaveIBeenPwned check failed — allowing password', { error });
    return 0;
  }
}

/**
 * Validates job posting input
 */
export function validateJobInput(data: {
  title?: string;
  description?: string;
  budget?: number;
  skills?: string[];
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.title || data.title.trim().length < 5) {
    errors.push('Title must be at least 5 characters');
  }
  if (!data.title || data.title.trim().length > 200) {
    errors.push('Title must not exceed 200 characters');
  }
  if (!data.description || data.description.trim().length < 20) {
    errors.push('Description must be at least 20 characters');
  }
  if (!data.description || data.description.trim().length > 5000) {
    errors.push('Description must not exceed 5000 characters');
  }
  if (!data.budget || data.budget <= 0) {
    errors.push('Budget must be a positive number');
  }
  if (data.budget && data.budget > 1000000) {
    errors.push('Budget must not exceed 1,000,000');
  }
  if (!data.skills || !Array.isArray(data.skills) || data.skills.length === 0) {
    errors.push('At least one skill is required');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates bid input
 */
export function validateBidInput(data: {
  amount?: number;
  proposal?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.amount || data.amount <= 0) {
    errors.push('Bid amount must be a positive number');
  }
  if (!data.proposal || data.proposal.trim().length < 20) {
    errors.push('Proposal must be at least 20 characters');
  }
  if (data.proposal && data.proposal.trim().length > 3000) {
    errors.push('Proposal must not exceed 3000 characters');
  }

  return { valid: errors.length === 0, errors };
}
