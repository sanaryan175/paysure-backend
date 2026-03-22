
import mongoose from 'mongoose';
 
const agreementAnalysisSchema = new mongoose.Schema(
  {
    originalFileName:   { type: String },
    hasFinancialProfile:{ type: Boolean, default: false },
 
    // Optional financial inputs
    monthlyIncome:    { type: Number, default: null },
    monthlyExpenses:  { type: Number, default: null },
    existingEMIs:     { type: Number, default: null },
    savings:          { type: Number, default: null },
    jobType:          { type: String, default: null },
 
    // AI output
    documentType:         { type: String },
    verdict:              { type: String, enum: ['Safe', 'Needs Caution', 'High Risk', 'Scam Alert'] },
    verdictScore:         { type: Number },
    confidence:           { type: Number },
    verdictStatement:     { type: String },
    recommendation:       { type: String },
    finalAction:          { type: String },
    recommendationReason: { type: String },
    personalizedVerdict:  { type: String },
    personalizedRisk:     { type: String },
 
    // Terms + impact
    interestRate:      { type: String },
    interestImpact:    { type: String },
    processingFee:     { type: String },
    processingImpact:  { type: String },
    prepaymentPenalty: { type: String },
    lateFee:           { type: String },
    lateFeeImpact:     { type: String },
    tenure:            { type: String },
    loanAmount:        { type: String },
 
    // Risk breakdown
    criticalRisks: [{ type: String }],
    mediumRisks:   [{ type: String }],
    softSignals:   [{ type: String }],
 
    // Decision output
    whatCanGoWrong: [{ type: String }],
    suggestions:    [{ type: String }],
    nextSteps:      [{ type: String }],
    benchmark:      { type: String },
    summary:        { type: String },
 
    nlpExtracted: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);
 
export default mongoose.model('AgreementAnalysis', agreementAnalysisSchema);