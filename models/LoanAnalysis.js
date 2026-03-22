import mongoose from 'mongoose';

const loanAnalysisSchema = new mongoose.Schema(
  {
    // ── Financial inputs ──────────────────────────────────
    monthlyIncome:    { type: Number, required: true },
    monthlyExpenses:  { type: Number, required: true },
    existingEMIs:     { type: Number, default: 0 },
    savings:          { type: Number, required: true },
    jobType:          { type: String, enum: ['salaried', 'self-employed', 'freelance', 'student', 'other'], required: true },

    // ── Loan inputs ───────────────────────────────────────
    loanAmount:       { type: Number, default: null },
    interestRate:     { type: Number, default: null },
    tenureMonths:     { type: Number, default: null },

    // ── Calculated metrics ────────────────────────────────
    calculatedEMI:            { type: Number, required: true },
    emiToIncomeRatio:         { type: Number, required: true },
    disposableIncome:         { type: Number, required: true },
    totalDebtBurden:          { type: Number, required: true },
    totalRepayment:           { type: Number, required: true },
    totalInterest:            { type: Number, required: true },
    emergencyBufferMonths:    { type: Number, required: true },
    monthlySavingsAfterLoan:  { type: Number, required: true },

    // ── Engine 1 — AI output ──────────────────────────────
    capacityScore:            { type: String, enum: ['Strong', 'Moderate', 'Low'],          required: true },
    financialStressLevel:     { type: String, enum: ['Low', 'Medium', 'High'],              required: true },
    emergencyBufferStatus:    { type: String, enum: ['Strong', 'Okay', 'Weak', 'Critical'], required: true },
    finalDecisionStatement:   { type: String },   // ← NEW: action-oriented verdict
    whatCanGoWrong:           [{ type: String }], // ← NEW: real consequences

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
    impactStatement:  { type: String },
    keyReasons:       [{ type: String }],
    suggestions:      [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.model('LoanAnalysis', loanAnalysisSchema);