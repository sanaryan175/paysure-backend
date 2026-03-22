import AgreementAnalysis from '../models/AgreementAnalysis.js';
import { structuredAnalysis } from '../services/openaiService.js';
import { extractTextFromFile, deleteFile } from '../services/pdfService.js';
import { analyzeAgreementWithNLP } from '../services/agreementNLP.js';

// ─── Schema ───────────────────────────────────────────────────────────────────
const agreementSchema = {
  type: 'object',
  properties: {
    documentType:  { type: 'string', description: 'Loan Agreement / Investment Offer / Insurance / Credit Card / Other' },
    verdict:       { type: 'string', enum: ['Safe', 'Needs Caution', 'High Risk', 'Scam Alert'] },
    verdictScore:  { type: 'number', description: 'Risk score 1-10. 1=safest, 10=worst' },
    confidence:    { type: 'number', description: 'Confidence 0-100' },

    // Strong opinionated verdict statement
    verdictStatement: {
      type: 'string',
      description: 'Aggressive opening line. Examples: "DO NOT SIGN THIS AGREEMENT", "AVOID THIS LOAN — IT IS A FINANCIAL TRAP", "SAFE TO PROCEED WITH MINOR CAUTION", "NEGOTIATE THESE 3 TERMS BEFORE SIGNING". Must be decisive, not diplomatic.'
    },

    // Decision recommendation
    recommendation: {
      type: 'string',
      enum: ['Proceed', 'Proceed with Caution', 'Negotiate First', 'Avoid', 'Scam — Do Not Proceed'],
      description: 'Clear action recommendation'
    },
    recommendationReason: {
      type: 'string',
      description: 'ONE sentence explaining exactly why. Must include ₹ amounts. Specific, not generic.'
    },

    // Final action button label
    finalAction: {
      type: 'string',
      enum: ['Review Carefully Before Signing', 'Clarify Terms Before Signing', 'Consider Alternatives First', 'Appears Safe to Proceed'],
      description: 'Suggested next action for the user'
    },

    // Personalized verdict (only if financial profile provided)
    personalizedVerdict: {
      type: 'string',
      description: 'If financial profile provided: "This loan will consume X% of your income leaving only ₹Y/month." Else empty string.'
    },
    personalizedRisk: {
      type: 'string',
      enum: ['Low', 'Medium', 'High', 'Very High', 'Not Assessed'],
      description: 'Risk level for THIS specific user based on their financial profile'
    },

    // Key terms in impact language — not raw terms
    interestRate:      { type: 'string' },
    interestImpact:    { type: 'string', description: 'e.g. "You will pay ₹15,000/month in interest alone"' },
    processingFee:     { type: 'string' },
    processingImpact:  { type: 'string', description: 'e.g. "You lose ₹25,000 upfront even if loan is rejected"' },
    prepaymentPenalty: { type: 'string' },
    lateFee:           { type: 'string' },
    lateFeeImpact:     { type: 'string', description: 'e.g. "Miss 10 days → extra ₹20,000"' },
    tenure:            { type: 'string' },
    loanAmount:        { type: 'string' },

    // Risk breakdown
    criticalRisks:  { type: 'array', items: { type: 'string' }, description: 'Direct financial loss risks with ₹ amounts' },
    mediumRisks:    { type: 'array', items: { type: 'string' } },
    softSignals:    { type: 'array', items: { type: 'string' } },

    // What can go wrong — scenario based
    whatCanGoWrong: {
      type: 'array',
      items: { type: 'string' },
      description: 'Scenario-based: "If you miss 10 days payment → you pay ₹20,000 extra". Must be specific with ₹ amounts.'
    },

    // Suggestions (kept for compatibility)
    suggestions: {
      type: 'array', items: { type: 'string' },
      description: 'Specific negotiation points or alternatives. e.g. "Ask lender to cap processing fee at 1%"'
    },

    // Next steps — concrete actions
    nextSteps: {
      type: 'array', items: { type: 'string' },
      description: '4-5 concrete actions user can take. Examples: "Ask lender to remove non-refundable clause", "Compare with SBI/HDFC personal loan rates", "Consult CA before signing". Never say do not sign.'
    },

    // Benchmark comparison
    benchmark: {
      type: 'string',
      description: 'How this compares to market: e.g. "Market average for personal loans is 10-18%. This charges 36%."'
    },

    summary: { type: 'string', description: '2 sentence plain English summary' },
  },
  required: [
    'documentType', 'verdict', 'verdictScore', 'confidence',
    'verdictStatement', 'recommendation', 'recommendationReason', 'finalAction',
    'personalizedVerdict', 'personalizedRisk',
    'interestRate', 'interestImpact', 'processingFee', 'processingImpact',
    'prepaymentPenalty', 'lateFee', 'lateFeeImpact', 'tenure', 'loanAmount',
    'criticalRisks', 'mediumRisks', 'softSignals',
    'whatCanGoWrong', 'suggestions', 'nextSteps', 'benchmark', 'summary',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a senior financial document analyst at an Indian fintech platform.
Your job is to help users understand what a document says and what actions they should consider — not to make decisions for them.

Critical rules:
- Be factual and specific — use ₹ amounts always
- verdictStatement: summarize the document's biggest concern in ONE line. Example: "This agreement charges 60% annual interest — 3-4x above market rate."
- Never say "Do not sign" or "Avoid" — instead say "Consider carefully before signing" or "Key concerns to address before proceeding"
- whatCanGoWrong: scenario-based with exact ₹ amounts. "If X happens → you pay ₹Y extra"
- nextSteps: 4-5 concrete actions the user can take. Examples: "Ask lender to reduce processing fee", "Compare with 2-3 other lenders", "Consult a financial advisor before signing"
- finalAction must be one of: "Review Carefully Before Signing" / "Clarify Terms Before Signing" / "Consider Alternatives First" / "Appears Safe to Proceed"
- Personalize when financial data given — "Your income suggests this EMI will be manageable/challenging"
- Indian market benchmarks: personal loans 10-18%, home loans 8-12%, business loans 12-20%
- Goal: Inform the user so THEY can make a confident decision`;

// ─── Main controller ──────────────────────────────────────────────────────────
export const analyzeAgreement = async (req, res, next) => {
  const filePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a PDF or DOCX file.' });
    }

    // Financial profile from form (optional)
    const {
      monthlyIncome,
      monthlyExpenses,
      existingEMIs,
      savings,
      jobType,
    } = req.body;

    const hasFinancialProfile = !!(monthlyIncome && monthlyExpenses);

    // Step 1 — Extract text
    const extractedText = await extractTextFromFile(filePath);

    // Step 2 — NLP pre-analysis
    const nlp = analyzeAgreementWithNLP(extractedText);

    // Step 3 — Hard scam check
    if (nlp.scamCheck.isScam) {
      deleteFile(filePath);
      return res.status(200).json({
        success: true,
        data: {
          fileName: req.file.originalname,
          documentType: 'Suspected Fraud Document',
          verdict: 'Scam Alert',
          verdictScore: 10,
          confidence: 99,
          recommendation: 'Scam — Do Not Proceed',
          recommendationReason: 'This document demands payment before loan disbursement — a definitive fraud signal.',
          personalizedVerdict: '',
          personalizedRisk: 'Very High',
          interestRate: 'N/A', interestImpact: '',
          processingFee: 'Upfront payment demanded', processingImpact: 'You will lose all money paid — it will not be returned.',
          prepaymentPenalty: 'N/A', lateFee: 'N/A', lateFeeImpact: '', tenure: 'N/A', loanAmount: 'N/A',
          criticalRisks: [`Advance payment demanded: "${nlp.scamCheck.signals[0]}"`],
          mediumRisks: [], softSignals: [],
          whatCanGoWrong: [
            'You will lose all money paid upfront — guaranteed',
            'No loan will ever be disbursed',
            'This is a known fraud pattern targeting loan seekers in India',
          ],
          suggestions: [
            'Do NOT pay any amount under any circumstance',
            'Report immediately at cybercrime.gov.in',
            'Block all communication from this entity',
          ],
          benchmark: 'No legitimate lender in India asks for payment before loan disbursement.',
          summary: 'This document is fraudulent. Do not proceed under any circumstances.',
        },
      });
    }

    // Step 4 — Build financial context
    let financialContext = '';
    let personalizedPrompt = '';

    if (hasFinancialProfile) {
      const income   = parseFloat(monthlyIncome);
      const expenses = parseFloat(monthlyExpenses);
      const emis     = parseFloat(existingEMIs) || 0;
      const sav      = parseFloat(savings) || 0;

      // Calculate key metrics
      const nlpRate  = nlp.extracted?.primaryRate?.annual || null;
      const nlpAmt   = null; // will come from doc
      const disposable = income - expenses - emis;
      const bufferMonths = sav / (expenses || 1);

      financialContext = `
USER FINANCIAL PROFILE:
━━━━━━━━━━━━━━━━━━━━━━
Monthly Income:    ₹${income.toLocaleString('en-IN')}
Monthly Expenses:  ₹${expenses.toLocaleString('en-IN')}
Existing EMIs:     ₹${emis.toLocaleString('en-IN')}
Savings:           ₹${sav.toLocaleString('en-IN')}
Job Type:          ${jobType || 'Not specified'}
Disposable Income: ₹${disposable.toLocaleString('en-IN')} (after expenses + existing EMIs)
Emergency Buffer:  ${bufferMonths.toFixed(1)} months
━━━━━━━━━━━━━━━━━━━━━━`;

      personalizedPrompt = `
PERSONALIZATION INSTRUCTIONS:
- Calculate what % of their ₹${income.toLocaleString('en-IN')} income this loan's EMI will consume
- Tell them exactly how much they'll have left: "After EMI you will have ₹X/month"
- If EMI > 40% of income → mark personalizedRisk as High/Very High
- If savings < 3 months expenses → flag emergency buffer concern
- Make personalizedVerdict specific: "Based on your ₹${income.toLocaleString('en-IN')} income, this loan's EMI will consume X%..."`;
    } else {
      financialContext = 'USER FINANCIAL PROFILE: Not provided — document-only analysis.';
      personalizedPrompt = 'Set personalizedVerdict to empty string. Set personalizedRisk to "Not Assessed".';
    }

    // Step 5 — AI analysis
    const aiResult = await structuredAnalysis({
      schemaName:   'agreement_analysis',
      schema:        agreementSchema,
      systemPrompt:  SYSTEM_PROMPT,
      userPrompt:   `Analyze this financial document and give a DECISION, not just a report.

FILE: ${req.file.originalname}

${financialContext}

${nlp.nlpSummary}

${personalizedPrompt}

FULL DOCUMENT:
${extractedText.slice(0, 9000)}

CRITICAL OUTPUT REQUIREMENTS:
1. verdictStatement: ONE line summarizing the biggest concern. Factual, not prescriptive. E.g. "This agreement charges 60% annual interest — 3-4x above market rate."
2. recommendation: Proceed / Proceed with Caution / Negotiate First / Avoid / Scam — Do Not Proceed
3. finalAction: "Review Carefully Before Signing" / "Clarify Terms Before Signing" / "Consider Alternatives First" / "Appears Safe to Proceed"
4. interestImpact: "You will pay ₹X/month in interest alone" — calculate exact amount
5. processingImpact: "₹X processing fee is non-refundable — you pay this even if loan is rejected"
6. lateFeeImpact: "Missing 10 days of payment would cost ₹X extra"
7. whatCanGoWrong: scenario-based with EXACT ₹ amounts. "If X happens → you pay ₹Y extra"
8. nextSteps: 4-5 concrete actionable steps. "Ask lender to...", "Compare with...", "Request written clarification on..."
9. benchmark: "Market average for personal loans is 10-18%. This charges X% — Y times higher."
10. verdictScore: 1=safest, 10=worst
11. criticalRisks: "The X clause means you could lose ₹Y if Z happens"`,
    });

    deleteFile(filePath);

    // Step 6 — Save
    await AgreementAnalysis.create({
      originalFileName: req.file.originalname,
      hasFinancialProfile,
      monthlyIncome:   monthlyIncome || null,
      monthlyExpenses: monthlyExpenses || null,
      existingEMIs:    existingEMIs || null,
      savings:         savings || null,
      jobType:         jobType || null,
      ...aiResult,
      nlpExtracted: {
        interestRates:     nlp.extracted.allRates,
        fees:              nlp.extracted.allFees,
        suspiciousPhrases: nlp.suspiciousPhrases,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        fileName: req.file.originalname,
        hasFinancialProfile,
        ...aiResult,
      },
    });

  } catch (err) {
    if (filePath) deleteFile(filePath);
    console.error('[Agreement Error]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Analysis failed.' });
  }
};

export const getAgreementHistory = async (req, res, next) => {
  try {
    const history = await AgreementAnalysis
      .find()
      .select('-nlpExtracted')
      .sort({ createdAt: -1 })
      .limit(20);
    res.status(200).json({ success: true, data: history });
  } catch (err) { next(err); }
};