import fs from 'fs';
import path from 'path';

/**
 * Extract text from PDF using a simple buffer read approach.
 * Falls back to sending raw content to OpenAI if parsing fails.
 */
const extractFromPDFSimple = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const content = buffer.toString('latin1');

  // Extract text between BT and ET markers (PDF text objects)
  const textParts = [];
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;

  while ((match = btEtRegex.exec(content)) !== null) {
    const block = match[1];
    // Extract strings in parentheses
    const strRegex = /\(([^)]*)\)/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const text = strMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
        .trim();
      if (text.length > 1) textParts.push(text);
    }
  }

  return textParts.join(' ').replace(/\s{2,}/g, ' ').trim();
};

/**
 * Main export — handles PDF and DOCX
 */
export const extractTextFromFile = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();

  let rawText = '';

  if (ext === '.pdf') {
    try {
      // Try dynamic import of pdf-parse
      const pdfParseModule = await import('pdf-parse/lib/pdf-parse.js').catch(() => null);

      if (pdfParseModule) {
        const pdfParse = pdfParseModule.default || pdfParseModule;
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
        rawText = data.text;
      } else {
        // Fallback: simple PDF text extraction
        rawText = extractFromPDFSimple(filePath);
      }
    } catch {
      // Final fallback
      rawText = extractFromPDFSimple(filePath);
    }

    if (!rawText || rawText.trim().length < 30) {
      throw new Error(
        'Could not extract text from this PDF. It may be image-based (scanned). Please upload a text-based PDF or DOCX file.'
      );
    }

  } else if (ext === '.docx' || ext === '.doc') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.default.extractRawText({ path: filePath });
      rawText = result.value;
    } catch (err) {
      throw new Error(`Could not read DOCX file: ${err.message}`);
    }

    if (!rawText || rawText.trim().length < 30) {
      throw new Error('DOCX file appears to be empty.');
    }

  } else {
    throw new Error(`Unsupported file type: ${ext}. Please upload PDF or DOCX.`);
  }

  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

export const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    console.warn(`Could not delete: ${filePath}`);
  }
};

export default { extractTextFromFile, deleteFile };