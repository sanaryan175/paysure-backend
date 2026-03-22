/**
 * URL Service — fetches webpage content for scam analysis
 */
import https from 'https';
import http from 'http';

// Strip HTML tags and clean text
const stripHtml = (html) => {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n')
    .trim();
};

// Fetch URL with timeout
const fetchWithTimeout = (url, timeoutMs = 8000) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const timeout  = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);

    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, (res) => {
      clearTimeout(timeout);

      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        resolve({ redirected: true, finalUrl: redirectUrl });
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; if (data.length > 200000) req.destroy(); });
      res.on('end', () => resolve({ redirected: false, finalUrl: url, html: data, statusCode: res.statusCode }));
    });

    req.on('error', err => { clearTimeout(timeout); reject(err); });
  });
};

export const analyzeUrl = async (inputUrl) => {
  try {
    // Normalize URL
    let url = inputUrl.trim();
    if (!url.startsWith('http')) url = 'https://' + url;

    const domain = new URL(url).hostname;

    // Check for known suspicious domains/patterns
    const suspiciousPatterns = [
      /bit\.ly|tinyurl|shorturl|t\.co|goo\.gl/i,
      /\.xyz|\.tk|\.ml|\.ga|\.cf|\.gq/i,
      /free.*prize|win.*claim|lottery|lucky-winner/i,
      /verify.*account|kyc.*update|account.*suspended/i,
    ];

    const isSuspiciousDomain = suspiciousPatterns.some(p => p.test(url));

    // Try to fetch the page
    let pageText   = '';
    let finalUrl   = url;
    let fetchError = null;

    try {
      let result = await fetchWithTimeout(url);

      // Follow one redirect
      if (result.redirected && result.finalUrl !== url) {
        finalUrl = result.finalUrl;
        result   = await fetchWithTimeout(result.finalUrl);
      }

      if (result.html) {
        pageText = stripHtml(result.html).slice(0, 4000);
      }
    } catch (err) {
      fetchError = err.message;
    }

    // Build analysis context
    let urlContext = `URL ANALYSIS:\n`;
    urlContext += `Original URL: ${inputUrl}\n`;
    urlContext += `Domain: ${domain}\n`;
    urlContext += `Suspicious domain pattern: ${isSuspiciousDomain ? 'YES ⚠️' : 'No'}\n`;

    if (finalUrl !== url) {
      urlContext += `Redirects to: ${finalUrl}\n`;
    }

    if (pageText) {
      urlContext += `\nWEBPAGE CONTENT (extracted):\n${pageText}\n`;
    } else if (fetchError) {
      urlContext += `\nCould not fetch page content: ${fetchError}\n`;
      urlContext += `(Analyze based on URL structure and domain alone)\n`;
    }

    return {
      domain,
      finalUrl,
      isSuspiciousDomain,
      pageText,
      fetchError,
      urlContext,
    };

  } catch (err) {
    return {
      domain:            inputUrl,
      finalUrl:          inputUrl,
      isSuspiciousDomain: false,
      pageText:          '',
      fetchError:        err.message,
      urlContext:        `URL: ${inputUrl}\nCould not analyze: ${err.message}\n`,
    };
  }
};

export default { analyzeUrl };