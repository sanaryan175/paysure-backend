import express from 'express';
import upload from '../middleware/upload.js';
import { analyzeAgreement, getAgreementHistory } from '../controllers/agreementController.js';

const router = express.Router();

// multer handles the file — no Zod needed here (file validation is in middleware/upload.js)
router.post('/analyze', upload.single('document'), analyzeAgreement);
router.get('/history',  getAgreementHistory);

export default router;