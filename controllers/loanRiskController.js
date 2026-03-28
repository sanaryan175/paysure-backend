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
  const emiToIncomeRatio       = monthlyIncome > 0
    ? parseFloat(((totalDebtBurden / monthlyIncome) * 100).toFixed(2))
    : 0;
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

/** Merge form loan fields with NLP guesses from the document when the user skipped entry. */
const resolveEffectiveLoan = (body, nlpResult) => {
  const inf = nlpResult && !nlpResult.error ? nlpResult.loanInference : null;
  const effLoanAmount = body.loanAmount ?? inf?.principalAmount;
  const effInterestRate = body.interestRate ?? inf?.interestRatePercent;
  const effTenure = body.tenureMonths ?? inf?.tenureMonths;
  const hasLoanData = !!(effLoanAmount && effInterestRate && effTenure);
  return { effLoanAmount, effInterestRate, effTenure, hasLoanData, inf };
};

// ─── Main controller ──────────────────────────────────────────────────────────
export const analyzeLoanRisk = async (req, res, next) => {
  const filePath = req.file?.path;

  try {
    const {
      monthlyIncome, monthlyExpenses, existingEMIs,
      savings, jobType, loanAmount, interestRate, tenureMonths,
    } = req.body;

    let extractedText = '';
    let nlpResult = null;
    let documentUploaded = false;
    let originalFileName = null;
    let documentResult = null;

    // Step 1 — Extract document + NLP first so we can infer loan figures before capacity analysis
    if (req.file) {
      try {
        extractedText = await extractTextFromFile(filePath);
        documentUploaded = true;
        originalFileName = req.file.originalname;
        nlpResult = analyzeDocumentWithNLP(extractedText);
        if (nlpResult.error) {
          console.warn('[NLP]', nlpResult.error);
        } else {
          console.log(`[NLP] Flags: ${nlpResult.totalFlagCount} | Pre-risk: ${nlpResult.nlpRiskLevel}`);
        }
      } catch (docErr) {
        console.error('[Doc Error]', docErr.message);
        if (filePath) deleteFile(filePath);
        documentUploaded = false;
        extractedText = '';
        nlpResult = null;
      }
    }

    const { effLoanAmount, effInterestRate, effTenure, hasLoanData, inf } = resolveEffectiveLoan(
      { loanAmount, interestRate, tenureMonths },
      nlpResult
    );
    const loanMetricsAvailable = hasLoanData;

    const inferenceBits = [];
    if (inf && !loanAmount && inf.principalAmount) inferenceBits.push('loan amount from document');
    if (inf && !interestRate && inf.interestRatePercent != null) inferenceBits.push('interest rate from document');
    if (inf && !tenureMonths && inf.tenureMonths) inferenceBits.push('tenure from document');

    // Step 2 — Calculations (uses inferred loan figures when the user skipped manual entry)
    const metrics = computeMetrics({
      monthlyIncome, monthlyExpenses,
      existingEMIs: existingEMIs || 0,
      savings,
      loanAmount: effLoanAmount,
      interestRate: effInterestRate,
      tenureMonths: effTenure,
    });

    const loanDetailsLines = loanMetricsAvailable
      ? `- Loan Amount:            ₹${effLoanAmount}
- Interest Rate:          ${effInterestRate}% per annum
- Tenure:                 ${effTenure} months
- Source:                 ${inferenceBits.length ? `mixed (you entered some fields; we filled: ${inferenceBits.join(', ')})` : 'your entered values'}`
      : `- Loan Amount:            ${effLoanAmount != null ? `₹${effLoanAmount}` : 'not specified'}
- Interest Rate:          ${effInterestRate != null ? `${effInterestRate}% per annum` : 'not specified'}
- Tenure:                 ${effTenure != null ? `${effTenure} months` : 'not specified'}
- Note:                   Incomplete — new-loan EMI cannot be calculated until amount, rate, and tenure are all known (enter manually or use a clearer document).`;

    const capacityConstraint = !loanMetricsAvailable
      ? `

CRITICAL — LOAN SIMULATION INCOMPLETE:
The user skipped loan fields and we could not infer a full principal + rate + tenure from the document. "New Monthly EMI" below is NOT a real loan payment — it is ₹0 because the loan is undefined.
Do NOT say they have "no EMI" or "zero burden" for the loan they are considering. Explain general income/expense resilience only, and say that affordability of the actual loan is unknown until they provide or confirm amount, rate, and tenure.
If contract terms were analyzed separately and look risky, you may still warn about document risk without contradicting this.`
      : '';

    const financialContext = `
USER FINANCIAL PROFILE:
- Monthly Income:         ₹${monthlyIncome}
- Monthly Expenses:       ₹${monthlyExpenses}
- Existing EMIs:          ₹${existingEMIs || 0}
- Savings:                ₹${savings}
- Job Type:               ${jobType}

LOAN DETAILS (effective for this analysis):
${loanDetailsLines}

CALCULATED METRICS:
- New Monthly EMI:        ₹${metrics.calculatedEMI} ${!loanMetricsAvailable ? '(no new loan defined — not a real EMI)' : ''}
- Total Debt Burden:      ₹${metrics.totalDebtBurden} (existing EMIs + new loan EMI if defined)
- Debt-to-Income Ratio:   ${metrics.emiToIncomeRatio}%  (Safe<30%, Risky 30-50%, Dangerous>50%)
- Disposable Income:      ₹${metrics.disposableIncome} after all costs
- Emergency Buffer:       ${metrics.emergencyBufferMonths} months (Weak<3, Okay 3-6, Strong>6)
- Monthly Savings Left:   ₹${metrics.monthlySavingsAfterLoan}
- Total Repayment:        ₹${metrics.totalRepayment}
- Total Interest Cost:    ₹${metrics.totalInterest}${capacityConstraint}`;

    // Step 3 — Engine 1 — Capacity analysis
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
${!loanMetricsAvailable ? '- If loan is undefined: say affordability of *that* loan cannot be judged yet; do not praise "zero EMI".' : ''}

For impactStatement:
- Explain what the number MEANS
- Example: "After paying EMI, you will have ₹${metrics.disposableIncome?.toLocaleString('en-IN')} left monthly — ${metrics.emiToIncomeRatio < 30 ? 'indicating low financial stress.' : metrics.emiToIncomeRatio < 50 ? 'which is tight but manageable.' : 'which puts you under severe financial pressure.'}"
${!loanMetricsAvailable ? '- Focus on disposable income after existing obligations; clarify that the new loan EMI is unknown.' : ''}

For whatCanGoWrong:
- List 3 real scenarios specific to THIS user's numbers
- Example: "If your income drops by 20%, your EMI burden will exceed 60% — making repayment impossible."
- Make them feel real and specific, not generic`,
    });

    // Step 4 — Engine 2 — Groq document analysis (text already extracted)
    if (documentUploaded && extractedText.length >= 50) {
      try {
        documentResult = await structuredAnalysis({
          schemaName:   'document_analysis',
          schema:        documentSchema,
          systemPrompt:  SYSTEM_PROMPT,
          userPrompt:   `Analyze this loan document as a DECISION ASSISTANT.

Document: ${originalFileName}

${nlpResult?.nlpSummary || ''}

DOCUMENT CONTENT:
${extractedText.slice(0, 6000)}

For hardRedFlags: Frame as "Critical Risks" — state what can cause direct financial loss
For documentConsequences: Write real consequences specific to this document.
Example: "You may lose ₹X upfront if loan is not disbursed"
Example: "Lender can change interest rate without prior notice"
Example: "Prepayment before 12 months will cost 3% of outstanding amount"
Be specific. Quote actual terms found in the document.`,
        });

        if (nlpResult?.flags?.hardRedFlags?.length > 0) {
          const existing = documentResult.hardRedFlags || [];
          nlpResult.flags.hardRedFlags.forEach(flag => {
            if (!existing.some(e => e.toLowerCase().includes(flag.toLowerCase()))) {
              existing.push(`Detected: "${flag}"`);
            }
          });
          documentResult.hardRedFlags = existing;
        }

        if (!documentResult.interestRateFound || documentResult.interestRateFound === 'Not specified') {
          if (nlpResult?.extracted?.interestRate) documentResult.interestRateFound = nlpResult.extracted.interestRate;
        }
        if (!documentResult.processingFee || documentResult.processingFee === 'Not specified') {
          if (nlpResult?.extracted?.processingFee) documentResult.processingFee = nlpResult.extracted.processingFee;
        }
      } catch (groqDocErr) {
        console.error('[Doc Groq Error]', groqDocErr.message);
      }
      if (filePath) deleteFile(filePath);
    } else if (filePath) {
      deleteFile(filePath);
    }

    // Step 5: Decision matrix
    const fairnessScore  = documentResult?.loanFairnessScore ?? 'Not Analyzed';
    const overallVerdict = getVerdictFromMatrix(capacityResult.capacityScore, fairnessScore);

    const loanInferenceNote = loanMetricsAvailable
      ? (inferenceBits.length ? `Some values were filled from your document: ${inferenceBits.join(', ')}.` : null)
      : (documentUploaded
        ? 'We could not derive a full loan (principal, rate, and tenure) from your upload. EMI and repayment totals for the new loan are not calculated until those are known — add them manually or use a clearer document.'
        : null);

    // Step 6: Combine whatCanGoWrong from capacity + document consequences
    const combinedWhatCanGoWrong = [
      ...(capacityResult.whatCanGoWrong || []),
      ...(documentResult?.documentConsequences || []),
    ];

    // Step 7: Save
    const record = await LoanAnalysis.create({
      monthlyIncome, monthlyExpenses,
      existingEMIs: existingEMIs || 0,
      savings, jobType,
      loanAmount: effLoanAmount ?? null,
      interestRate: effInterestRate ?? null,
      tenureMonths: effTenure ?? null,
      ...metrics,
      documentUploaded, originalFileName,
      capacityScore:         capacityResult.capacityScore,
      financialStressLevel:  capacityResult.financialStressLevel,
      emergencyBufferStatus: capacityResult.emergencyBufferStatus,
      finalDecisionStatement: capacityResult.finalDecisionStatement,
      whatCanGoWrong:         combinedWhatCanGoWrong,
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

    // Step 8: Respond
    res.status(200).json({
      success: true,
      data: {
        id: record._id,
        monthlyIncome, monthlyExpenses,
        existingEMIs: existingEMIs || 0,
        savings, jobType,
        loanAmount: effLoanAmount ?? null,
        interestRate: effInterestRate ?? null,
        tenureMonths: effTenure ?? null,
        loanMetricsAvailable,
        loanInferenceNote,
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