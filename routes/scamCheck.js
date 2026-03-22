import express from 'express';
import multer from 'multer';
import path from 'path';
import { analyzeScam, getScamHistory } from '../controllers/scamCheckController.js';

const router = express.Router();

// Accept multiple files — images + docs
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images (JPG/PNG/WEBP) and documents (PDF/DOCX) are allowed'));
  },
});

router.post('/analyze', upload.array('files', 10), analyzeScam); // up to 10 files
router.get('/history', getScamHistory);

export default router;