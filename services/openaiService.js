
import groq from '../config/openai.js';
 
/**
 * Call Groq with structured JSON output.
 * Groq doesn't support strict JSON schema like OpenAI,
 * so we prompt it to return JSON and parse the response.
 */
export const structuredAnalysis = async ({ systemPrompt, userPrompt, schema, schemaName }) => {
  // Build a schema description string for the prompt
  const schemaKeys = Object.keys(schema.properties || {});
  const schemaDesc = schemaKeys.map(key => {
    const prop = schema.properties[key];
    if (prop.enum) return `"${key}": one of [${prop.enum.map(e => `"${e}"`).join(', ')}]`;
    if (prop.type === 'array') return `"${key}": array of strings`;
    return `"${key}": ${prop.type} — ${prop.description || ''}`;
  }).join('\n');
 
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `${systemPrompt}
 
IMPORTANT: You must respond with ONLY a valid JSON object. No explanation, no markdown, no code blocks.
The JSON must contain exactly these fields:
${schemaDesc}
 
Required fields: ${schema.required?.join(', ')}`,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });
 
  const raw = response.choices[0].message.content.trim();
 
  // Strip markdown code blocks if model wraps response
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
 
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // If JSON parse fails, try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error(`Groq returned invalid JSON. Raw: ${cleaned.slice(0, 200)}`);
    }
  }
 
  return parsed;
};
 
export default { structuredAnalysis };