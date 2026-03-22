/**
 * Scam NLP Service
 * Pre-processes text before AI analysis
 */

// ─── Scam pattern dictionaries ────────────────────────────────────────────────

const HARD_SCAM_PHRASES = [
    'you have won', 'you have been selected', 'claim your prize',
    'lottery winner', 'lucky winner', 'congratulations you won',
    'send money to receive', 'pay to get', 'advance fee',
    'registration fee required', 'processing fee to release',
    'your account will be blocked', 'immediate action required',
    'verify your account now', 'click here to avoid suspension',
    'otp share karo', 'share your otp', 'never share otp',
    'investment guaranteed', 'guaranteed returns', 'risk free investment',
    'double your money', 'triple your investment', '100% returns',
    'government approved scheme', 'rbi approved', 'sebi approved scheme',
    'part time job earn', 'work from home earn lakhs',
    'send ₹', 'pay ₹', 'transfer money first',
  ];
  
  const URGENCY_PHRASES = [
    'act now', 'limited time', 'offer expires', 'today only',
    'within 24 hours', 'within 48 hours', 'immediately',
    'urgent', 'last chance', 'hurry', 'do not delay',
    'abhi karo', 'turant', 'jaldi karo',
  ];
  
  const SUSPICIOUS_CONTACT = [
    'whatsapp us', 'telegram', 'contact on whatsapp',
    'call this number', 'message on instagram',
  ];
  
  const HIGH_RETURN_PATTERNS = [
    /(\d+)x\s*returns?/gi,
    /(\d+)%\s*(?:daily|weekly|monthly)\s*returns?/gi,
    /earn\s*₹?\s*[\d,]+\s*(?:daily|weekly|per day)/gi,
    /invest\s*₹?\s*[\d,]+\s*(?:get|earn|receive)\s*₹?\s*[\d,]+/gi,
  ];
  
  const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
  const PHONE_PATTERN = /(?:\+91|0)?[6-9]\d{9}/g;
  const AMOUNT_PATTERN = /₹\s*[\d,]+|rs\.?\s*[\d,]+|inr\s*[\d,]+/gi;
  
  // ─── Helpers ──────────────────────────────────────────────────────────────────
  const findMatches = (text, phrases) => {
    const lower = text.toLowerCase();
    return phrases.filter(p => lower.includes(p.toLowerCase()));
  };
  
  // ─── Main export ──────────────────────────────────────────────────────────────
  export const analyzeScamWithNLP = (rawText) => {
    if (!rawText || rawText.trim().length < 5) {
      return { error: 'No text to analyze' };
    }
  
    const lower = rawText.toLowerCase();
  
    // Extractions
    const urls          = [...new Set(rawText.match(URL_PATTERN)    || [])];
    const phones        = [...new Set(rawText.match(PHONE_PATTERN)  || [])];
    const amounts       = [...new Set(rawText.match(AMOUNT_PATTERN) || [])];
  
    // High return pattern check
    const highReturnMatches = [];
    HIGH_RETURN_PATTERNS.forEach(p => {
      p.lastIndex = 0;
      const matches = rawText.match(p) || [];
      highReturnMatches.push(...matches);
    });
  
    // Flag detection
    const hardScamFlags  = findMatches(rawText, HARD_SCAM_PHRASES);
    const urgencyFlags   = findMatches(rawText, URGENCY_PHRASES);
    const suspiciousContact = findMatches(rawText, SUSPICIOUS_CONTACT);
  
    // Suspicious URL check (free hosting, random domains)
    const suspiciousUrls = urls.filter(u =>
      /bit\.ly|tinyurl|shorturl|t\.me|telegram|\.xyz|\.tk|\.ml|\.ga|click|free|win|prize/i.test(u)
    );
  
    // Pre-score
    let scamScore = 0;
    scamScore += hardScamFlags.length * 3;
    scamScore += urgencyFlags.length * 1.5;
    scamScore += highReturnMatches.length * 2;
    scamScore += suspiciousUrls.length * 2;
    scamScore += suspiciousContact.length * 1;
  
    const nlpVerdict = scamScore >= 6 ? 'Likely Scam'
                     : scamScore >= 3 ? 'Suspicious'
                     : 'Appears Legitimate';
  
    const nlpSummary = `
  NLP PRE-ANALYSIS:
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Hard Scam Phrases (${hardScamFlags.length}):
  ${hardScamFlags.length > 0 ? hardScamFlags.map(f => `  • "${f}"`).join('\n') : '  None'}
  
  Urgency Language (${urgencyFlags.length}):
  ${urgencyFlags.length > 0 ? urgencyFlags.map(f => `  • "${f}"`).join('\n') : '  None'}
  
  High Return Claims:
  ${highReturnMatches.length > 0 ? highReturnMatches.map(f => `  • "${f}"`).join('\n') : '  None'}
  
  URLs Found: ${urls.length > 0 ? urls.join(', ') : 'None'}
  Suspicious URLs: ${suspiciousUrls.length > 0 ? suspiciousUrls.join(', ') : 'None'}
  Phone Numbers: ${phones.length > 0 ? phones.join(', ') : 'None'}
  Amounts Mentioned: ${amounts.length > 0 ? amounts.join(', ') : 'None'}
  Suspicious Contact Methods: ${suspiciousContact.length > 0 ? suspiciousContact.join(', ') : 'None'}
  
  NLP Pre-score: ${scamScore.toFixed(1)} → ${nlpVerdict}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NOTE: Use full context to make final judgment.`;
  
    return {
      extracted: { urls, phones, amounts, highReturnMatches },
      flags: { hardScamFlags, urgencyFlags, suspiciousUrls, suspiciousContact },
      scamScore,
      nlpVerdict,
      nlpSummary,
    };
  };
  
  export default { analyzeScamWithNLP };