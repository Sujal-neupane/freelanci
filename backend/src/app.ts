import express from 'express';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { Redis } from 'ioredis';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import logger from './utils/logger';
import { globalLimiter, authLimiter } from './middleware/rateLimit';
import authRoutes from './routes/auth';
import jobRoutes from './routes/jobs';
import bidRoutes from './routes/bids';
import paymentRoutes from './routes/payments';
import adminRoutes from './routes/admin';
import disputeRoutes from './routes/disputes';
import fileRoutes from './routes/files';

dotenv.config({ path: '../.env' });

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Redis Client ────────────────────────────────────────────────
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

// ─── Security Headers (Helmet) ──────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    }
  },
  hsts: {
    maxAge: 31536000,       // 1 year
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// ─── CORS ────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ─── Body Parsers ────────────────────────────────────────────────
// Stripe webhooks need raw body — mount before json parser
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Server-Side Sessions with Redis Store ───────────────────────
const redisStore = new RedisStore({
  client: redis,
  prefix: 'sess:',
  ttl: 86400 // 24 hours
});

app.use(session({
  store: redisStore,
  secret: process.env.SESSION_SECRET || 'change-this-in-production',
  resave: false,
  saveUninitialized: false,
  name: '__freelanci_sid',    // Non-default name hides tech stack
  cookie: {
    httpOnly: true,           // Prevents XSS access to cookie
    secure: process.env.NODE_ENV === 'production',   // HTTPS only in prod
    sameSite: 'strict',       // CSRF protection
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
    domain: undefined         // Let browser infer
  }
}));

// ─── Trust Proxy (for rate limiting behind reverse proxy) ────────
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ─── Rate Limiting ───────────────────────────────────────────────
app.use('/api/', globalLimiter);
app.use('/api/auth/', authLimiter);

// ─── Request Logging ─────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')?.substring(0, 100)
  });
  next();
});

// ─── API Routes ──────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/jobs', bidRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/files', fileRoutes);

// ─── Health Check ────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await redis.ping();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch {
    res.status(503).json({ status: 'unhealthy', error: 'Redis connection failed' });
  }
});

// ─── 404 Handler ─────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global Error Handler ────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  res.status(500).json({
    error: process.env.NODE_ENV === 'development'
      ? err.message
      : 'Internal server error'
  });
});

// ─── Start Server ────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Freelanci API running on port ${PORT}`, {
    env: process.env.NODE_ENV || 'development',
    port: PORT
  });
});

export default app;
