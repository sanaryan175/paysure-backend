/**
 * Agreement NLP Service
 * Purpose: Extract structured data from document text
 * Role: Pre-processor for AI — finds WHAT, AI understands WHY
 */

// ─── Extraction helpers ───────────────────────────────────────────────────────

const normalizeAmount = (str) => {
  const words = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'fifteen': 15, 'twenty': 20,
    'twenty five': 25, 'thirty': 30, 'fifty': 50,
    'hundred': 100, 'thousand': 1000, 'lakh': 100000, 'lakhs': 100000,
  };
  let s = str.toLowerCase().replace(/,/g, '');
  Object.entries(words).forEach(([w, v]) => {
    s = s.replace(new RegExp(w, 'gi'), v);
  });
  const match = s.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
};

// ─── 1. Interest Rate Extraction ─────────────────────────────────────────────
export const extractInterestRates = (text) => {
  const results = [];
  const patterns = [
    /(\d+(?:\.\d+)?)\s*%\s*per\s*(annum|year|p\.a\.|pa)/gi,
    /(\d+(?:\.\d+)?)\s*%\s*per\s*month/gi,
    /interest\s*(?:rate|@|at|of)\s*:?\s*(\d+(?:\.\d+)?)\s*%/gi,
    /rate\s*of\s*interest\s*:?\s*(\d+(?:\.\d+)?)\s*%/gi,
    /(\d+(?:\.\d+)?)\s*%\s*(?:p\.a\.|per\s*annum)/gi,
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0].trim();
      const valueStr = match[1] || match[0].match(/\d+(?:\.\d+)?/)?.[0];
      const value = parseFloat(valueStr);
      const isMonthly = raw.toLowerCase().includes('month');
      const annualValue = isMonthly ? parseFloat((value * 12).toFixed(2)) : value;

      if (value > 0 && value < 200) {
        results.push({
          raw,
          monthly: isMonthly ? value : null,
          annual: annualValue,
          context: text.slice(Math.max(0, match.index - 60), match.index + raw.length + 60).trim(),
        });
      }
    }
  });

  // Deduplicate by annual value
  const seen = new Set();
  return results.filter(r => {
    const key = r.annual;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ─── 2. Fee Extraction ────────────────────────────────────────────────────────
export const extractFees = (text) => {
  const feeTypes = [
    { keywords: ['processing fee', 'processing charge', 'origination fee', 'admin fee'], type: 'processing_fee' },
    { keywords: ['late payment', 'late fee', 'penal interest', 'penalty interest', 'overdue'], type: 'late_fee' },
    { keywords: ['prepayment', 'foreclosure', 'pre-closure', 'preclosure'], type: 'prepayment_penalty' },
    { keywords: ['bounce charge', 'dishonour', 'dishonor', 'ecs bounce'], type: 'bounce_charge' },
    { keywords: ['documentation fee', 'stamp duty', 'legal fee'], type: 'documentation_fee' },
  ];

  const amountPatterns = [
    /₹\s*[\d,]+(?:\.\d{1,2})?/g,
    /rs\.?\s*[\d,]+(?:\.\d{1,2})?/gi,
    /inr\s*[\d,]+(?:\.\d{1,2})?/gi,
    /(\d+(?:\.\d+)?)\s*%/g,
    /rupees?\s+[a-z\s]+(?:thousand|lakh|hundred)/gi,
  ];

  const results = [];
  const lower = text.toLowerCase();

  feeTypes.forEach(({ keywords, type }) => {
    keywords.forEach(keyword => {
      const idx = lower.indexOf(keyword);
      if (idx === -1) return;

      const nearby = text.slice(idx, Math.min(text.length, idx + 200));
      let amount = null;
      let amountRaw = null;

      for (const pattern of amountPatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(nearby);
        if (match) {
          amountRaw = match[0].trim();
          const cleaned = amountRaw.replace(/[₹Rs.INR\s,]/gi, '');
          amount = parseFloat(cleaned) || null;
          break;
        }
      }

      const isNonRefundable = nearby.toLowerCase().includes('non-refundable') ||
                               nearby.toLowerCase().includes('non refundable');

      results.push({
        type,
        raw: nearby.slice(0, 120).trim(),
        amount,
        amountRaw,
        isNonRefundable,
        context: nearby.slice(0, 150).trim(),
      });
    });
  });

  // Deduplicate by type
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.type)) return false;
    seen.add(r.type);
    return true;
  });
};

// ─── 3. Tenure Extraction ─────────────────────────────────────────────────────
export const extractTenure = (text) => {
  const patterns = [
    /(?:tenure|period|term|duration)\s*(?:of|:)?\s*(\d+)\s*(months?|years?)/gi,
    /repayable\s*in\s*(\d+)\s*(months?|years?|installments?)/gi,
    /(\d+)\s*(?:monthly\s*)?(?:EMI|installments?|equated)/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const value = parseInt(match[1]);
      const unit  = (match[2] || '').toLowerCase();
      return {
        raw: match[0].trim(),
        months: unit.includes('year') ? value * 12 : value,
      };
    }
  }
  return null;
};

// ─── 4. Suspicious Phrase Detection ──────────────────────────────────────────
export const detectSuspiciousPhrases = (text) => {
  const phraseMap = [
    { phrase: 'at lender\'s discretion',      category: 'one_sided' },
    { phrase: 'at our sole discretion',        category: 'one_sided' },
    { phrase: 'without prior notice',          category: 'dangerous' },
    { phrase: 'without any notice',            category: 'dangerous' },
    { phrase: 'subject to change',             category: 'vague'     },
    { phrase: 'charges as applicable',         category: 'hidden'    },
    { phrase: 'charges as decided',            category: 'hidden'    },
    { phrase: 'as informed later',             category: 'hidden'    },
    { phrase: 'waiver of rights',              category: 'legal_trap'},
    { phrase: 'waive the right',               category: 'legal_trap'},
    { phrase: 'company reserves the right',    category: 'one_sided' },
    { phrase: 'lender reserves the right',     category: 'one_sided' },
    { phrase: 'share with third parties',      category: 'privacy'   },
    { phrase: 'share borrower data',           category: 'privacy'   },
    { phrase: 'recovery agent',                category: 'aggressive'},
    { phrase: 'legal action',                  category: 'aggressive'},
    { phrase: 'terminate the agreement',       category: 'dangerous' },
  ];

  const lower = text.toLowerCase();
  const found = [];

  phraseMap.forEach(({ phrase, category }) => {
    if (lower.includes(phrase)) {
      const idx   = lower.indexOf(phrase);
      const context = text.slice(Math.max(0, idx - 40), idx + phrase.length + 80).trim();
      found.push({ phrase, category, context });
    }
  });

  return found;
};

// ─── 5. ONLY hard scam rule — non-negotiable ─────────────────────────────────
export const checkScamSignals = (text) => {
  const SCAM_PHRASES = [
    'pay before disbursement',
    'advance payment to release loan',
    'registration fee before loan',
    'token amount before loan',
    'send money to receive loan',
    'pay to get loan approved',
    'fee before loan is released',
  ];

  const lower = text.toLowerCase();
  const found = SCAM_PHRASES.filter(p => lower.includes(p));
  return { isScam: found.length > 0, signals: found };
};

// ─── Main export ──────────────────────────────────────────────────────────────
export const analyzeAgreementWithNLP = (rawText) => {
  if (!rawText || rawText.trim().length < 50) {
    return { error: 'Insufficient text extracted from document' };
  }

  const interestRates      = extractInterestRates(rawText);
  const fees               = extractFees(rawText);
  const tenure             = extractTenure(rawText);
  const suspiciousPhrases  = detectSuspiciousPhrases(rawText);
  const scamCheck          = checkScamSignals(rawText);

  // Primary interest rate (highest one found — most relevant)
  const primaryRate = interestRates.length > 0
    ? interestRates.reduce((a, b) => a.annual > b.annual ? a : b)
    : null;

  const processingFee   = fees.find(f => f.type === 'processing_fee')   || null;
  const lateFee         = fees.find(f => f.type === 'late_fee')         || null;
  const prepaymentFee   = fees.find(f => f.type === 'prepayment_penalty') || null;

  // Build structured summary for AI prompt
  const nlpSummary = `
NLP PRE-EXTRACTION RESULTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINANCIAL TERMS FOUND:
Interest Rate:      ${primaryRate ? `${primaryRate.raw} (${primaryRate.annual}% per annum)` : 'Not explicitly found'}
Processing Fee:     ${processingFee ? `${processingFee.amountRaw || 'mentioned'} ${processingFee.isNonRefundable ? '(NON-REFUNDABLE ⚠️)' : ''}` : 'Not found'}
Late Payment Fee:   ${lateFee ? lateFee.raw.slice(0, 80) : 'Not found'}
Prepayment Penalty: ${prepaymentFee ? prepaymentFee.raw.slice(0, 80) : 'Not found'}
Tenure:             ${tenure ? `${tenure.raw} (${tenure.months} months)` : 'Not found'}

SUSPICIOUS PHRASES DETECTED (${suspiciousPhrases.length}):
${suspiciousPhrases.length > 0
  ? suspiciousPhrases.map(p => `  • "${p.phrase}" [${p.category}]`).join('\n')
  : '  None detected'}

ALL INTEREST RATES FOUND:
${interestRates.length > 0
  ? interestRates.map(r => `  • ${r.raw} = ${r.annual}% annually`).join('\n')
  : '  None found'}

ALL FEES FOUND:
${fees.length > 0
  ? fees.map(f => `  • ${f.type}: ${f.amountRaw || 'amount unclear'} ${f.isNonRefundable ? '(NON-REFUNDABLE)' : ''}`).join('\n')
  : '  None found'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTE: NLP extracted raw data. Use FULL CONTEXT below to interpret correctly.
Some values may appear in hypothetical/maximum clauses — verify with context.`;

  return {
    extracted: { primaryRate, processingFee, lateFee, prepaymentFee, tenure, allRates: interestRates, allFees: fees },
    suspiciousPhrases,
    scamCheck,
    nlpSummary,
    textLength: rawText.length,
  };
};

export default { analyzeAgreementWithNLP };