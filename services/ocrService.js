/**
 * OCR Service — extracts text from images using Tesseract.js
 * Runs before AI analysis so Groq can read screenshot content
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export const extractTextFromImage = async (imagePath) => {
  try {
    const Tesseract = require('tesseract.js');

    const { data: { text } } = await Tesseract.recognize(imagePath, 'eng', {
      logger: () => {}, // suppress progress logs
    });

    const cleaned = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    return cleaned.length > 5 ? cleaned : null;

  } catch (err) {
    console.warn(`[OCR] Could not extract text from image: ${err.message}`);
    return null;
  }
};

export default { extractTextFromImage };