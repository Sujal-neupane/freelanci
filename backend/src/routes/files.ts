import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { uploadMiddleware, fileSignatureMatches } from '../middleware/upload';
import { requireAuth, requireMfaComplete } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import logger from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();
const uploadDir = path.join(__dirname, '../../../uploads');

// ─── POST /api/files/:jobId — Upload a file for a job ─────────────
router.post('/:jobId', requireAuth, requireMfaComplete, (req, res, next) => {
  uploadMiddleware.single('file')(req, res, (err) => {
    if (err) {
      logger.warn('File upload rejected', { error: err.message, ip: req.ip });
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const userId = req.session.userId!;

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Verify the file's real magic bytes match its claimed MIME type. Blocks
    // disguised payloads (e.g. an HTML/PHP file relabelled as image/png).
    if (!fileSignatureMatches(req.file.path, req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      logger.warn('File upload rejected — signature/MIME mismatch', {
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
        ip: req.ip
      });
      res.status(400).json({ error: 'File content does not match its declared type' });
      return;
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      // Clean up uploaded file if job not found
      fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Only allow client or hired freelancer to upload files
    if (job.clientId !== userId && job.hiredFreelancerId !== userId) {
      fs.unlinkSync(req.file.path);
      res.status(403).json({ error: 'Not authorized to upload files for this job' });
      return;
    }

    await createAuditLog({
      userId,
      action: 'FILE_UPLOADED',
      resourceType: 'file',
      resourceId: req.file.filename,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      metadata: { jobId, originalName: req.file.originalname, size: req.file.size }
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      filename: req.file.filename // Return new secure filename
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    logger.error('File upload error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to process file upload' });
  }
});

// ─── GET /api/files/:jobId/:filename — Download a file ────────────
router.get('/:jobId/:filename', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const filename = req.params.filename as string;
    const userId = req.session.userId!;

    // Prevent directory traversal (just in case)
    if (filename.includes('..') || filename.includes('/')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Only allow client, hired freelancer, or admin to download
    if (job.clientId !== userId && job.hiredFreelancerId !== userId && req.session.role !== 'ADMIN') {
      res.status(403).json({ error: 'Not authorized to download this file' });
      return;
    }

    const filePath = path.join(uploadDir, filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    await createAuditLog({
      userId,
      action: 'FILE_DOWNLOADED',
      resourceType: 'file',
      resourceId: filename,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      metadata: { jobId }
    });

    // Force download instead of inline rendering, and stop the browser from
    // MIME-sniffing the content into something executable — neutralises
    // stored-XSS / drive-by via uploaded files.
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.sendFile(filePath);
  } catch (error) {
    logger.error('File download error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to download file' });
  }
});

export default router;
