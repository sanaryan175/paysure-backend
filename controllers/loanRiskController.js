import LoanAnalysis from '../models/LoanAnalysis.js';
import { structuredAnalysis } from '../services/openaiService.js';
import { extractTextFromFile, deleteFile } from '../services/pdfService.js';
import { analyzeDocumentWithNLP } from '../services/nlpService.js';

// ─── Engine 1: Rule-based calculations ───────────────────────────────────────
const calculateEMI = (principal, annualRate, tenureMonths) => {
  const r = annualRate / 12 / 100;
  if (r === 0) return principal / tenureMonths;
  return parseFloat(
    ((principal * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1)).toFixed(2)
  );
};

const computeMetrics = ({ monthlyIncome, monthlyExpenses, existingEMIs, savings, loanAmount, interestRate, tenureMonths }) => {
  const hasLoanData = loanAmount && interestRate && tenureMonths;
  const calculatedEMI          = hasLoanData ? calculateEMI(loanAmount, interestRate, tenureMonths) : 0;
  const totalDebtBurden        = parseFloat(((existingEMIs || 0) + calculatedEMI).toFixed(2));
  const emiToIncomeRatio       = calculatedEMI > 0 ? parseFloat(((totalDebtBurden / monthlyIncome) * 100).toFixed(2)) : 0;
  const disposableIncome       = parseFloat((monthlyIncome - monthlyExpenses - totalDebtBurden).toFixed(2));
  const totalRepayment         = hasLoanData ? parseFloat((calculatedEMI * tenureMonths).toFixed(2)) : 0;
  const totalInterest          = hasLoanData ? parseFloat((totalRepayment - loanAmount).toFixed(2)) : 0;
  const emergencyBufferMonths  = parseFloat((savings / (monthlyExpenses || 1)).toFixed(1));
  const monthlySavingsAfterLoan = disposableIncome > 0 ? disposableIncome : 0;
  return {
    calculatedEMI, totalDebtBurden, emiToIncomeRatio,
    disposableIncome, totalRepayment, totalInterest,
    emergencyBufferMonths, monthlySavingsAfterLoan,
  };
};

// ─── Decision matrix ──────────────────────────────────────────────────────────
const getVerdictFromMatrix = (capacityScore, loanFairnessScore) => {
  const matrix = {
    Strong:   { Suitable: 'Suitable', 'Needs Caution': 'Needs Caution', 'High Risk': 'Needs Caution', 'Not Analyzed': 'Suitable' },
    Moderate: { Suitable: 'Needs Caution', 'Needs Caution': 'Needs Caution', 'High Risk': 'High Risk', 'Not Analyzed': 'Needs Caution' },
    Low:      { Suitable: 'Needs Caution', 'Needs Caution': 'High Risk', 'High Risk': 'High Risk', 'Not Analyzed': 'High Risk' },
  };
  return matrix[capacityScore]?.[loanFairnessScore] ?? 'Needs Caution';
};

// ─── Groq schema: Engine 1 — capacity ────────────────────────────────────────
const capacitySchema = {
  type: 'object',
  properties: {
    capacityScore:         { type: 'string', enum: ['Strong', 'Moderate', 'Low'] },
    financialStressLevel:  { type: 'string', enum: ['Low', 'Medium', 'High'] },
    emergencyBufferStatus: { type: 'string', enum: ['Strong', 'Okay', 'Weak', 'Critical'] },
    // NEW: action-oriented final decision statement
    finalDecisionStatement: {
      type: 'string',
      description: 'Clear action-oriented statement combining affordability + risk. Example: "You can afford this loan, but proceed only after negotiating the penalty clauses." NOT just a label.'
    },
    // NEW: numbers with meaning
    impactStatement: {
      type: 'string',
      description: 'Example: "After paying EMI, you will have ₹X left monthly — indicating low/medium/high financial stress."'
    },
    keyReasons:   { type: 'array', items: { type: 'string' }, description: '4 specific reasons with actual ₹ amounts' },
    suggestions:  { type: 'array', items: { type: 'string' }, description: '4 actionable suggestions' },
    // NEW: what can go wrong section
    whatCanGoWrong: {
      type: 'array',
      items: { type: 'string' },
      description: '3-4 real consequence statements. Example: "You may have no savings buffer if income drops even slightly."'
    },
    overallSummary: { type: 'string', description: '2 sentences combining capacity + context' },
  },
  required: [
    'capacityScore', 'financialStressLevel', 'emergencyBufferStatus',
    'finalDecisionStatement', 'impactStatement',
    'keyReasons', 'suggestions', 'whatCanGoWrong', 'overallSummary'
  ],
  additionalProperties: false,
};

// ─── Groq schema: Engine 2 — document ────────────────────────────────────────
const documentSchema = {
  type: 'object',
  properties: {
    loanFairnessScore:  { type: 'string', enum: ['Suitable', 'Needs Caution', 'High Risk'] },
    interestRateFound:  { type: 'string' },
    processingFee:      { type: 'string' },
    prepaymentPenalty:  { type: 'string' },
    hardRedFlags:       { type: 'array', items: { type: 'string' }, description: 'Critical risks that can cause direct financial loss' },
    mediumRisks:        { type: 'array', items: { type: 'string' } },
    softSignals:        { type: 'array', items: { type: 'string' } },
    // NEW: specific consequence statements from document
    documentConsequences: {
      type: 'array',
      items: { type: 'string' },
      description: 'Real specific consequences from the document. Example: "You may lose ₹5,000 upfront if disbursement fails."'
    },
  },
  required: [
    'loanFairnessScore', 'interestRateFound', 'processingFee',
    'prepaymentPenalty', 'hardRedFlags', 'mediumRisks', 'softSignals',
    'documentConsequences'
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a senior financial risk advisor and decision assistant at an Indian fintech company.
You don't just analyze — you help users make clear, safe financial decisions.
Use plain conversational English. The user may not have financial expertise.
Always prioritize the user's financial safety. Use actual ₹ amounts and percentages in your output.
NEVER give vague generic advice. Every statement must be specific and actionable.
Think like: "Would I recommend my own family member take this loan?"`;

// ─── Main controller ──────────────────────────────────────────────────────────
export const analyzeLoanRisk = async (req, res, next) => {
  const filePath = req.file?.path;

  try {
    const {
      monthlyIncome, monthlyExpenses, existingEMIs,
      savings, jobType, loanAmount, interestRate, tenureMonths,
    } = req.body;

    // Step 1: Calculations
    const metrics = computeMetrics({
      monthlyIncome, monthlyExpenses,
      existingEMIs: existingEMIs || 0,
      savings, loanAmount, interestRate, tenureMonths,
    });

    const financialContext = `
USER FINANCIAL PROFILE:
- Monthly Income:         ₹${monthlyIncome}
- Monthly Expenses:       ₹${monthlyExpenses}
- Existing EMIs:          ₹${existingEMIs || 0}
- Savings:                ₹${savings}
- Job Type:               ${jobType}

LOAN DETAILS:
- Loan Amount:            ₹${loanAmount}
- Interest Rate:          ${interestRate}% per annum
- Tenure:                 ${tenureMonths} months

CALCULATED METRICS:
- New Monthly EMI:        ₹${metrics.calculatedEMI}
- Total Debt Burden:      ₹${metrics.totalDebtBurden}
- EMI-to-Income Ratio:    ${metrics.emiToIncomeRatio}%  (Safe<30%, Risky 30-50%, Dangerous>50%)
- Disposable Income:      ₹${metrics.disposableIncome} after all costs
- Emergency Buffer:       ${metrics.emergencyBufferMonths} months (Weak<3, Okay 3-6, Strong>6)
- Monthly Savings Left:   ₹${metrics.monthlySavingsAfterLoan}
- Total Repayment:        ₹${metrics.totalRepayment}
- Total Interest Cost:    ₹${metrics.totalInterest}`;

    // Step 2: Engine 1 — Capacity analysis
    const capacityResult = await structuredAnalysis({
      schemaName:   'capacity_analysis',
      schema:        capacitySchema,
      systemPrompt:  SYSTEM_PROMPT,
      userPrompt:   `${financialContext}

Analyze this user's financial capacity as a DECISION ASSISTANT, not just an analyzer.

For finalDecisionStatement:
- Combine affordability + context into ONE clear action-oriented sentence
- Example: "You can afford this loan, but your thin savings buffer makes it risky — only proceed if you have a stable income guarantee."
- NOT: "Needs Caution" (too vague)

For impactStatement:
- Explain what the number MEANS
- Example: "After paying EMI, you will have ₹${metrics.disposableIncome?.toLocaleString('en-IN')} left monthly — ${metrics.emiToIncomeRatio < 30 ? 'indicating low financial stress.' : metrics.emiToIncomeRatio < 50 ? 'which is tight but manageable.' : 'which puts you under severe financial pressure.'}"

For whatCanGoWrong:
- List 3 real scenarios specific to THIS user's numbers
- Example: "If your income drops by 20%, your EMI burden will exceed 60% — making repayment impossible."
- Make them feel real and specific, not generic`,
    });

    let documentResult = null;
    let nlpResult = null;
    let documentUploaded = false;
    let originalFileName = null;

    // Step 3: Engine 2 — NLP + Document analysis
    if (req.file) {
      try {
        const extractedText = await extractTextFromFile(filePath);
        documentUploaded = true;
        originalFileName = req.file.originalname;

        // NLP pre-analysis
        nlpResult = analyzeDocumentWithNLP(extractedText);
        console.log(`[NLP] Flags: ${nlpResult.totalFlagCount} | Pre-risk: ${nlpResult.nlpRiskLevel}`);

        // Groq document analysis with NLP context
        documentResult = await structuredAnalysis({
          schemaName:   'document_analysis',
          schema:        documentSchema,
          systemPrompt:  SYSTEM_PROMPT,
          userPrompt:   `Analyze this loan document as a DECISION ASSISTANT.

Document: ${originalFileName}

${nlpResult.nlpSummary}

DOCUMENT CONTENT:
${extractedText.slice(0, 6000)}

For hardRedFlags: Frame as "Critical Risks" — state what can cause direct financial loss
For documentConsequences: Write real consequences specific to this document.
Example: "You may lose ₹X upfront if loan is not disbursed"
Example: "Lender can change interest rate without prior notice"
Example: "Prepayment before 12 months will cost 3% of outstanding amount"
Be specific. Quote actual terms found in the document.`,
        });

        // Merge NLP flags
        if (nlpResult.flags.hardRedFlags.length > 0) {
          const existing = documentResult.hardRedFlags || [];
          nlpResult.flags.hardRedFlags.forEach(flag => {
            if (!existing.some(e => e.toLowerCase().includes(flag.toLowerCase()))) {
              existing.push(`Detected: "${flag}"`);
            }
          });
          documentResult.hardRedFlags = existing;
        }

        // Use NLP extracted values as fallback
        if (!documentResult.interestRateFound || documentResult.interestRateFound === 'Not specified') {
          if (nlpResult.extracted.interestRate) documentResult.interestRateFound = nlpResult.extracted.interestRate;
        }
        if (!documentResult.processingFee || documentResult.processingFee === 'Not specified') {
          if (nlpResult.extracted.processingFee) documentResult.processingFee = nlpResult.extracted.processingFee;
        }

        deleteFile(filePath);
      } catch (docErr) {
        console.error('[Doc Error]', docErr.message);
        if (filePath) deleteFile(filePath);
      }
    }

    // Step 4: Decision matrix
    const fairnessScore  = documentResult?.loanFairnessScore ?? 'Not Analyzed';
    const overallVerdict = getVerdictFromMatrix(capacityResult.capacityScore, fairnessScore);

    // Step 5: Combine whatCanGoWrong from capacity + document consequences
    const combinedWhatCanGoWrong = [
      ...(capacityResult.whatCanGoWrong || []),
      ...(documentResult?.documentConsequences || []),
    ];

    // Step 6: Save
    const record = await LoanAnalysis.create({
      monthlyIncome, monthlyExpenses,
      existingEMIs: existingEMIs || 0,
      savings, jobType, loanAmount, interestRate, tenureMonths,
      ...metrics,
      documentUploaded, originalFileName,
      capacityScore:         capacityResult.capacityScore,
      financialStressLevel:  capacityResult.financialStressLevel,
      emergencyBufferStatus: capacityResult.emergencyBufferStatus,
      loanFairnessScore:     fairnessScore,
      interestRateFound:     documentResult?.interestRateFound  ?? null,
      processingFee:         documentResult?.processingFee      ?? null,
      prepaymentPenalty:     documentResult?.prepaymentPenalty  ?? null,
      hardRedFlags:          documentResult?.hardRedFlags       ?? [],
      mediumRisks:           documentResult?.mediumRisks        ?? [],
      softSignals:           documentResult?.softSignals        ?? [],
      overallVerdict,
      overallSummary:        capacityResult.overallSummary,
      impactStatement:       capacityResult.impactStatement,
      keyReasons:            capacityResult.keyReasons,
      suggestions:           capacityResult.suggestions,
    });

    // Step 7: Respond
    res.status(200).json({
      success: true,
      data: {
        id: record._id,
        monthlyIncome, monthlyExpenses,
        existingEMIs: existingEMIs || 0,
        savings, jobType, loanAmount, interestRate, tenureMonths,
        ...metrics,
        documentUploaded, originalFileName,
        nlpFlagsFound: nlpResult?.totalFlagCount ?? 0,
        nlpPreRisk:    nlpResult?.nlpRiskLevel   ?? null,
        capacityScore:          capacityResult.capacityScore,
        financialStressLevel:   capacityResult.financialStressLevel,
        emergencyBufferStatus:  capacityResult.emergencyBufferStatus,
        finalDecisionStatement: capacityResult.finalDecisionStatement,
        impactStatement:        capacityResult.impactStatement,
        whatCanGoWrong:         combinedWhatCanGoWrong,
        loanFairnessScore:      fairnessScore,
        interestRateFound:      documentResult?.interestRateFound  ?? null,
        processingFee:          documentResult?.processingFee      ?? null,
        prepaymentPenalty:      documentResult?.prepaymentPenalty  ?? null,
        hardRedFlags:           documentResult?.hardRedFlags       ?? [],
        mediumRisks:            documentResult?.mediumRisks        ?? [],
        softSignals:            documentResult?.softSignals        ?? [],
        overallVerdict,
        overallSummary:         capacityResult.overallSummary,
        impactStatement:        capacityResult.impactStatement,
        keyReasons:             capacityResult.keyReasons,
        suggestions:            capacityResult.suggestions,
      },
    });

  } catch (err) {
    if (filePath) deleteFile(filePath);
    console.error('[LoanRisk Error]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Analysis failed.' });
  }
};

export const getLoanHistory = async (req, res, next) => {
  try {
    const history = await LoanAnalysis.find().sort({ createdAt: -1 }).limit(20);
    res.status(200).json({ success: true, data: history });
  } catch (err) { next(err); }
};