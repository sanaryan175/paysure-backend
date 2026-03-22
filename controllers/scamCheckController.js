import ScamCheck from '../models/ScamCheck.js';
import { structuredAnalysis } from '../services/openaiService.js';
import { extractTextFromFile, deleteFile } from '../services/pdfService.js';
import { analyzeScamWithNLP } from '../services/scamNLP.js';
import { extractTextFromImage } from '../services/ocrService.js';
import { analyzeUrl } from '../services/urlservice.js';
import path from 'path';

// ─── Groq schema ──────────────────────────────────────────────────────────────
const scamSchema = {
  type: 'object',
  properties: {
    verdict:          { type: 'string', enum: ['Legitimate', 'Suspicious', 'Likely Scam', 'Confirmed Scam'] },
    confidence:       { type: 'number', description: 'Confidence 0-100' },
    scamType:         { type: 'string', description: 'Investment Fraud / Lottery Scam / Phishing / Job Scam / KYC Fraud / Fake Loan / Identity Theft / Fake Reviews / Legitimate / Other' },
    verdictStatement: { type: 'string', description: 'ONE clear sentence naming what this is. E.g. "This is a fake job offer asking for Google review manipulation."' },
    redFlags:         { type: 'array', items: { type: 'string' }, description: 'Specific red flags with exact quotes from the content.' },
    whatTheyWant:     { type: 'string', description: 'Exactly what scammer wants — money / OTP / personal data / fake reviews / bank details' },
    howItWorks:       { type: 'string', description: '2-3 sentences explaining the scam mechanism plainly.' },
    whatCanGoWrong:   { type: 'array', items: { type: 'string' }, description: 'Specific consequences if user engages. Include ₹ amounts where possible.' },
    nextSteps:        { type: 'array', items: { type: 'string' }, description: 'Concrete actions: "Block this number", "Report at cybercrime.gov.in", "Do not click links"' },
    summary:          { type: 'string', description: '2 sentence plain English summary.' },
  },
  required: ['verdict', 'confidence', 'scamType', 'verdictStatement', 'redFlags', 'whatTheyWant', 'howItWorks', 'whatCanGoWrong', 'nextSteps', 'summary'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a cybercrime and financial fraud detection expert at an Indian fintech platform.
Analyze ALL provided inputs together (text + OCR from screenshots + URLs) as ONE combined case.

Rules:
- Be specific — quote exact phrases from the content
- Use Indian context — UPI scams, KYC fraud, investment scams, lottery scams, job scams, fake review scams
- verdictStatement: ONE clear sentence naming the scam type
- whatTheyWant: exactly what they want — money/OTP/personal data/fake reviews/bank details
- howItWorks: explain the mechanism in 2-3 plain sentences
- whatCanGoWrong: specific consequences with ₹ amounts where possible
- nextSteps: numbered concrete actions — "Block this number", "Report at cybercrime.gov.in/complaint"
- If legitimate: explain clearly WHY it appears genuine
- RBI rule: legitimate banks NEVER ask for OTP or advance fees
- SEBI rule: guaranteed returns above 12% annually are illegal in India
- Fake job/review scams: companies never ask strangers to write fake reviews for pay`;

// ─── Main controller ──────────────────────────────────────────────────────────
export const analyzeScam = async (req, res, next) => {
  const files    = req.files || [];
  const filePaths = files.map(f => f.path);

  try {
    const { text, url } = req.body;

    let combinedText = '';

    // 1. Manual text
    if (text && text.trim()) {
      combinedText += `USER PROVIDED TEXT:\n${text.trim()}\n\n`;
    }

    // 2. URL — fetch and analyze page content
    if (url && url.trim()) {
      console.log(`[URL] Fetching: ${url.trim()}`);
      const urlAnalysis = await analyzeUrl(url.trim());
      combinedText += urlAnalysis.urlContext + '\n';
      if (urlAnalysis.pageText) {
        console.log(`[URL] Fetched ${urlAnalysis.pageText.length} chars from ${urlAnalysis.domain}`);
      } else {
        console.log(`[URL] Could not fetch content — analyzing URL structure only`);
      }
    }

    // 3. Process uploaded files
    for (const file of files) {
      const filePath     = file.path;
      const originalName = file.originalname;
      const ext          = path.extname(filePath).toLowerCase();

      if (['.pdf', '.docx', '.doc'].includes(ext)) {
        try {
          const docText = await extractTextFromFile(filePath);
          combinedText += `DOCUMENT (${originalName}):\n${docText.slice(0, 3000)}\n\n`;
        } catch {
          combinedText += `DOCUMENT (${originalName}): Could not extract text.\n\n`;
        }
      } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        console.log(`[OCR] Extracting text from: ${originalName}`);
        const ocrText = await extractTextFromImage(filePath);
        if (ocrText && ocrText.length > 10) {
          combinedText += `SCREENSHOT (${originalName}) — OCR text:\n${ocrText}\n\n`;
          console.log(`[OCR] Extracted ${ocrText.length} chars from ${originalName}`);
        } else {
          combinedText += `SCREENSHOT (${originalName}) — No readable text detected.\n\n`;
        }
      }
    }

    // Validate
    if (!combinedText.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide text, a URL, or upload files to analyze.',
      });
    }

    // 4. NLP pre-analysis
    const nlp = analyzeScamWithNLP(combinedText);

    // 5. Build prompt
    const userPrompt = `Analyze ALL of this content as ONE combined case.

${combinedText}

${nlp.nlpSummary}

NLP pre-verdict: ${nlp.nlpVerdict}

Instructions:
1. Treat everything above as one combined submission
2. Quote exact phrases in redFlags
3. For whatCanGoWrong — include specific ₹ amounts if mentioned
4. For nextSteps — give concrete actionable steps
5. verdictStatement must clearly name the scam type if detected`;

    // 6. Groq analysis
    const aiResult = await structuredAnalysis({
      schemaName:   'scam_analysis',
      schema:        scamSchema,
      systemPrompt:  SYSTEM_PROMPT,
      userPrompt,
    });

    // 7. Cleanup
    filePaths.forEach(fp => deleteFile(fp));

    // 8. Save
    await ScamCheck.create({
      inputText:     text     || null,
      inputUrl:      url      || null,
      filesUploaded: files.map(f => f.originalname),
      fileCount:     files.length,
      nlpScore:      nlp.scamScore,
      nlpVerdict:    nlp.nlpVerdict,
      ...aiResult,
    });

    res.status(200).json({
      success: true,
      data: {
        filesAnalyzed: files.map(f => f.originalname),
        nlpPreVerdict: nlp.nlpVerdict,
        ...aiResult,
      },
    });

  } catch (err) {
    filePaths.forEach(fp => deleteFile(fp));
    console.error('[ScamCheck Error]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Analysis failed.' });
  }
};

export const getScamHistory = async (req, res, next) => {
  try {
    const history = await ScamCheck.find().sort({ createdAt: -1 }).limit(20);
    res.status(200).json({ success: true, data: history });
  } catch (err) { next(err); }
};