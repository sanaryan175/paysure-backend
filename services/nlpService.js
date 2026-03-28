/**
 * NLP Service — compromise.js based text analysis
 * Runs BEFORE Groq to extract structured data from loan documents
 * This makes Groq's job easier and results more accurate
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ─── Red flag keyword dictionaries ───────────────────────────────────────────

const HARD_RED_FLAG_PHRASES = [
  'advance payment', 'advance fee', 'registration fee before',
  'pay before disbursement', 'non-refundable', 'non refundable',
  'charges will be informed', 'charges as applicable',
  'no legal recourse', 'waive right', 'waiver of rights',
  'pay via whatsapp', 'send money first', 'token amount',
  'processing fee before', 'security deposit before loan',
];

const MEDIUM_RISK_PHRASES = [
  'prepayment penalty', 'prepayment charge', 'foreclosure charge',
  'foreclosure fee', 'lock-in period', 'lock in period',
  'no prepayment allowed', 'penal interest',
  'late payment penalty', 'bounce charge', 'dishonour charge',
  'legal action', 'recovery agent', 'property seizure',
];

const SOFT_SIGNAL_PHRASES = [
  'as decided by lender', 'at lender discretion', 'may change',
  'subject to change', 'whatsapp', 'telegram', 'call us to confirm',
  'terms and conditions apply', 'without prior notice',
  'sole discretion', 'company reserves the right',
];

const URGENCY_PHRASES = [
  'immediately', 'urgent', 'today only', 'limited time',
  'offer expires', 'act now', 'last chance', 'hurry',
  'within 24 hours', 'within 48 hours', 'do not delay',
];

// ─── Helper: check if text contains any phrase from list ─────────────────────
const findMatches = (text, phrases) => {
  const lower = text.toLowerCase();
  return phrases.filter(phrase => lower.includes(phrase.toLowerCase()));
};

// ─── Helper: extract Indian rupee amounts ────────────────────────────────────
const extractAmounts = (text) => {
  const amounts = [];

  // Match ₹1,00,000 or Rs. 50000 or INR 25000
  const patterns = [
    /₹\s*[\d,]+(?:\.\d{1,2})?/g,
    /Rs\.?\s*[\d,]+(?:\.\d{1,2})?/gi,
    /INR\s*[\d,]+(?:\.\d{1,2})?/gi,
  ];

  patterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    matches.forEach(match => {
      const cleaned = match.replace(/[₹Rs.INR\s,]/gi, '');
      const value = parseFloat(cleaned);
      if (!isNaN(value) && value > 0) {
        amounts.push({ raw: match.trim(), value });
      }
    });
  });

  return amounts;
};

// ─── Helper: extract percentages ─────────────────────────────────────────────
const extractPercentages = (text) => {
  const results = [];
  const pattern = /(\d+(?:\.\d{1,2})?)\s*%\s*(?:per\s+(?:annum|year|month|p\.a\.))?/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const value = parseFloat(match[1]);
    const context = text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40).trim();
    results.push({ raw: match[0].trim(), value, context });
  }

  return results;
};

// ─── Helper: extract tenure mentions ─────────────────────────────────────────
const extractTenure = (text) => {
  const results = [];
  const patterns = [
    /(\d+)\s*months?/gi,
    /(\d+)\s*years?/gi,
    /tenure\s*(?:of|:)?\s*(\d+)/gi,
    /repayment\s*period\s*(?:of|:)?\s*(\d+)/gi,
  ];

  patterns.forEach(pattern => {
    const match = pattern.exec(text);
    if (match) {
      const isYears = pattern.toString().includes('year');
      const value = parseInt(match[1]);
      results.push({
        raw: match[0].trim(),
        months: isYears ? value * 12 : value,
      });
    }
  });

  return results;
};

// ─── Helper: detect interest rate context ─────────────────────────────────────
const detectInterestRate = (percentages, rawText) => {
  const interestKeywords = ['interest', 'rate', 'per annum', 'p.a.', 'annual', 'roi'];
  const lower = rawText.toLowerCase();

  for (const pct of percentages) {
    const contextLower = pct.context.toLowerCase();
    if (interestKeywords.some(kw => contextLower.includes(kw))) {
      if (pct.value > 0 && pct.value < 100) {
        return pct;
      }
    }
  }

  // Fallback: return highest percentage that looks like interest
  const candidates = percentages.filter(p => p.value > 1 && p.value < 100);
  return candidates.length > 0 ? candidates[0] : null;
};

// ─── Helper: detect processing fee ───────────────────────────────────────────
const detectProcessingFee = (amounts, rawText) => {
  const lower = rawText.toLowerCase();
  const feeKeywords = ['processing fee', 'processing charge', 'origination fee', 'admin fee', 'administration fee'];

  for (const keyword of feeKeywords) {
    const idx = lower.indexOf(keyword);
    if (idx !== -1) {
      // Look for amount near this keyword (within 100 chars)
      const nearby = rawText.slice(idx, idx + 150);
      const nearbyAmounts = extractAmounts(nearby);
      if (nearbyAmounts.length > 0) {
        return { found: true, raw: nearbyAmounts[0].raw, value: nearbyAmounts[0].value };
      }
      return { found: true, raw: 'Mentioned but amount unclear', value: null };
    }
  }
  return { found: false };
};

// ─── Main export: full NLP analysis ──────────────────────────────────────────
export const analyzeDocumentWithNLP = (rawText) => {
  if (!rawText || rawText.length < 50) {
    return { error: 'Text too short for NLP analysis' };
  }

  // Run all extractions
  const amounts          = extractAmounts(rawText);
  const percentages      = extractPercentages(rawText);
  const tenureMentions   = extractTenure(rawText);
  const interestRate     = detectInterestRate(percentages, rawText);
  const processingFee    = detectProcessingFee(amounts, rawText);

  // Flag detection
  const hardRedFlags  = findMatches(rawText, HARD_RED_FLAG_PHRASES);
  const mediumRisks   = findMatches(rawText, MEDIUM_RISK_PHRASES);
  const softSignals   = findMatches(rawText, SOFT_SIGNAL_PHRASES);
  const urgencyFlags  = findMatches(rawText, URGENCY_PHRASES);

  // Risk signal counts
  const totalRedFlags = hardRedFlags.length;
  const totalMedium   = mediumRisks.length;

  // Pre-classify document risk level based on NLP alone
  let nlpRiskLevel = 'Low';
  if (totalRedFlags >= 2 || (totalRedFlags >= 1 && totalMedium >= 2)) {
    nlpRiskLevel = 'High';
  } else if (totalRedFlags >= 1 || totalMedium >= 2) {
    nlpRiskLevel = 'Medium';
  } else if (totalMedium >= 1 || softSignals.length >= 2) {
    nlpRiskLevel = 'Medium';
  }

  // Interest rate risk flag
  if (interestRate && interestRate.value > 30) {
    if (!mediumRisks.includes('High interest rate detected')) {
      mediumRisks.push(`High interest rate detected: ${interestRate.raw}`);
    }
  }

  // Best-effort loan figures when the user skipped manual entry (used before capacity analysis)
  const principalGuess = (() => {
    if (amounts.length === 0) return null;
    const sizable = amounts.filter((a) => a.value >= 10000);
    const pool = sizable.length ? sizable : amounts;
    const maxVal = Math.max(...pool.map((a) => a.value));
    return maxVal >= 5000 ? maxVal : null;
  })();
  const tenureMonthsGuess = tenureMentions.length ? tenureMentions[0].months : null;

  const loanInference = {
    principalAmount: principalGuess,
    interestRatePercent: interestRate ? interestRate.value : null,
    tenureMonths: tenureMonthsGuess,
  };

  return {
    loanInference,

    // Extracted values
    extracted: {
      interestRate:   interestRate  ? `${interestRate.raw} (${interestRate.value}%)` : null,
      processingFee:  processingFee.found ? processingFee.raw : null,
      allAmounts:     amounts.slice(0, 10).map(a => a.raw),
      allPercentages: percentages.slice(0, 8).map(p => `${p.raw} — ${p.context.slice(0, 60)}`),
      tenureMentions: tenureMentions.map(t => `${t.raw} (${t.months} months)`),
    },

    // Flag arrays
    flags: {
      hardRedFlags:  hardRedFlags,
      mediumRisks:   mediumRisks,
      softSignals:   softSignals,
      urgencyFlags:  urgencyFlags,
    },

    // Pre-assessment
    nlpRiskLevel,
    totalFlagCount: totalRedFlags + totalMedium + softSignals.length,

    // Summary for Groq prompt
    nlpSummary: `
NLP PRE-ANALYSIS RESULTS:
━━━━━━━━━━━━━━━━━━━━━━━━
Extracted Interest Rate:  ${interestRate ? interestRate.raw : 'Not found'}
Extracted Processing Fee: ${processingFee.found ? processingFee.raw : 'Not found'}
Tenure Mentions:          ${tenureMentions.map(t => t.raw).join(', ') || 'Not found'}
All Amounts Found:        ${amounts.slice(0, 5).map(a => a.raw).join(', ') || 'None'}

Hard Red Flags Detected (${hardRedFlags.length}):
${hardRedFlags.length > 0 ? hardRedFlags.map(f => `  • ${f}`).join('\n') : '  None detected'}

Medium Risk Phrases (${mediumRisks.length}):
${mediumRisks.length > 0 ? mediumRisks.map(f => `  • ${f}`).join('\n') : '  None detected'}

Soft Signals (${softSignals.length}):
${softSignals.length > 0 ? softSignals.map(f => `  • ${f}`).join('\n') : '  None detected'}

Urgency Language (${urgencyFlags.length}):
${urgencyFlags.length > 0 ? urgencyFlags.map(f => `  • ${f}`).join('\n') : '  None detected'}

NLP Pre-Risk Assessment: ${nlpRiskLevel}
━━━━━━━━━━━━━━━━━━━━━━━━`,
  };
};

export default { analyzeDocumentWithNLP };