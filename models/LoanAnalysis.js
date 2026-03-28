import mongoose from 'mongoose';

const loanAnalysisSchema = new mongoose.Schema(
  {
    // ── Financial inputs ──────────────────────────────────
    monthlyIncome:    { type: Number, required: true },
    monthlyExpenses:  { type: Number, required: true },
    existingEMIs:     { type: Number, default: 0 },
    savings:          { type: Number, required: true },
    jobType:          { type: String, enum: ['salaried', 'self-employed', 'freelance', 'student', 'other'], required: true },

    // ── Loan inputs — optional (may come from doc) ────────
    loanAmount:       { type: Number, default: null },
    interestRate:     { type: Number, default: null },
    tenureMonths:     { type: Number, default: null },

    // ── Calculated metrics — default 0 if no loan data ───
    calculatedEMI:            { type: Number, default: 0 },
    emiToIncomeRatio:         { type: Number, default: 0 },
    disposableIncome:         { type: Number, default: 0 },
    totalDebtBurden:          { type: Number, default: 0 },
    totalRepayment:           { type: Number, default: 0 },
    totalInterest:            { type: Number, default: 0 },
    emergencyBufferMonths:    { type: Number, default: 0 },
    monthlySavingsAfterLoan:  { type: Number, default: 0 },

    // ── Engine 1 — AI output ──────────────────────────────
    capacityScore:            { type: String, enum: ['Strong', 'Moderate', 'Low'], required: true },
    financialStressLevel:     { type: String, enum: ['Low', 'Medium', 'High'],     required: true },
    emergencyBufferStatus:    { type: String, enum: ['Strong', 'Okay', 'Weak', 'Critical'], required: true },
    finalDecisionStatement:   { type: String, default: null },
    whatCanGoWrong:           [{ type: String }],

    // ── Engine 2 — Document ───────────────────────────────
    documentUploaded:   { type: Boolean, default: false },
    originalFileName:   { type: String,  default: null },
    loanFairnessScore:  { type: String, enum: ['Suitable', 'Needs Caution', 'High Risk', 'Not Analyzed'], default: 'Not Analyzed' },
    interestRateFound:  { type: String, default: null },
    processingFee:      { type: String, default: null },
    prepaymentPenalty:  { type: String, default: null },
    hardRedFlags:       [{ type: String }],
    mediumRisks:        [{ type: String }],
    softSignals:        [{ type: String }],

    // ── Combined output ───────────────────────────────────
    overallVerdict:   { type: String, enum: ['Suitable', 'Needs Caution', 'High Risk'], required: true },
    overallSummary:   { type: String, required: true },
    impactStatement:  { type: String, default: null },
    keyReasons:       [{ type: String }],
    suggestions:      [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.model('LoanAnalysis', loanAnalysisSchema);