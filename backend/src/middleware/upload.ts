import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // Prevent path traversal by renaming file with UUID
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = crypto.randomUUID();
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

// File filter (MIME type validation)
const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/zip'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPEG, PNG, DOC, DOCX, and ZIP are allowed.'));
  }
};

export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB limit
  }
});

/**
 * Magic-byte (file signature) table. `file.mimetype` is taken from the request
 * and is fully attacker-controlled, so an attacker can label a `.php`/`.html`
 * payload as `image/png` to bypass the MIME filter (PortSwigger: "File upload
 * vulnerabilities"). After the file is written we read its real leading bytes
 * and require them to match the claimed type.
 */
const MAGIC_BYTES: Record<string, number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],                 // %PDF
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'application/msword': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], // OLE2
  // docx and zip are both ZIP containers (PK\x03\x04, or empty/spanned variants)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    [0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]
  ],
  'application/zip': [
    [0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]
  ]
};

/**
 * Returns true if the file at `filePath` actually begins with a signature that
 * matches `mimetype`. Returns false on mismatch or unknown type.
 */
export function fileSignatureMatches(filePath: string, mimetype: string): boolean {
  const signatures = MAGIC_BYTES[mimetype];
  if (!signatures) return false;

  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    return signatures.some(sig => sig.every((byte, i) => header[i] === byte));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
