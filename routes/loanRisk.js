import express from 'express';
import { z } from 'zod';
import upload from '../middleware/upload.js';
import { analyzeLoanRisk, getLoanHistory } from '../controllers/loanRiskController.js';

const router = express.Router();

const loanSchema = z.object({
  // ── Always required ──────────────────────────────────────
  monthlyIncome:   z.coerce.number({ invalid_type_error: 'Monthly income must be a number' })
                    .positive('Monthly income must be positive'),
  monthlyExpenses: z.coerce.number({ invalid_type_error: 'Monthly expenses must be a number' })
                    .min(0, 'Monthly expenses cannot be negative'),
  existingEMIs:    z.coerce.number().min(0).default(0),
  savings:         z.coerce.number({ invalid_type_error: 'Savings must be a number' })
                    .min(0, 'Savings cannot be negative'),
  jobType:         z.enum(['salaried', 'self-employed', 'freelance', 'student', 'other'], {
                     errorMap: () => ({ message: 'Please select a valid job type' }),
                   }),

  // ── Optional when document is uploaded ───────────────────
  // coerce handles empty string → undefined, then optional() allows undefined
  loanAmount:   z.preprocess(
                  v => (v === '' || v === null || v === undefined) ? undefined : Number(v),
                  z.number().positive('Loan amount must be positive').optional()
                ),
  interestRate: z.preprocess(
                  v => (v === '' || v === null || v === undefined) ? undefined : Number(v),
                  z.number().min(0.1).max(100).optional()
                ),
  tenureMonths: z.preprocess(
                  v => (v === '' || v === null || v === undefined) ? undefined : Number(v),
                  z.number().int().min(1).max(360).optional()
                ),

  // ── Internal flags ────────────────────────────────────────
  loanDetailsFromDoc: z.string().optional(),
});

// Inline validation middleware
const validateLoan = (req, res, next) => {
  const result = loanSchema.safeParse(req.body);

  if (!result.success) {
    const message = result.error.errors.map(e => e.message).join(', ');
    return res.status(400).json({ success: false, message });
  }

  // Extra check: if no document uploaded AND loan fields missing → reject
  const hasFile = !!req.file;
  const { loanAmount, interestRate, tenureMonths } = result.data;

  if (!hasFile && (!loanAmount || !interestRate || !tenureMonths)) {
    return res.status(400).json({
      success: false,
      message: 'Please enter loan amount, interest rate, and tenure — or upload a loan document.',
    });
  }

  req.body = result.data;
  next();
};

router.post('/analyze', upload.single('document'), validateLoan, analyzeLoanRisk);
router.get('/history',  getLoanHistory);

export default router;