import winston from 'winston';
import path from 'path';

// Custom format that NEVER logs sensitive fields
const sanitiseFields = winston.format((info) => {
  const sensitiveKeys = [
    'password', 'passwordHash', 'mfaSecret', 'token',
    'secret', 'cardNumber', 'cvv', 'sessionId', 'cookie'
  ];

  const sanitise = (obj: Record<string, unknown>): Record<string, unknown> => {
    const sanitised: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitised[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitised[key] = sanitise(value as Record<string, unknown>);
      } else {
        sanitised[key] = value;
      }
    }
    return sanitised;
  };

  return sanitise(info as unknown as Record<string, unknown>) as unknown as winston.Logform.TransformableInfo;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    sanitiseFields(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'freelanci-api' },
  transports: [
    // Console transport — always active
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 1
            ? ` ${JSON.stringify(meta)}`
            : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      )
    }),
    // File transport — structured JSON for production analysis
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

export default logger;
