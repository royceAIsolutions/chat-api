const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { problem, context, language } = req.body;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.json({ reply: 'API key not configured.' });
  if (!problem) return res.json({ reply: 'No problem provided.' });

  const system = `You are RoyceAI Coding Interview Assistant. You help solve coding problems in real-time during technical interviews.

RULES:
- Output the solution code with 1-2 lines of explanation maximum.
- Use ${language || 'Python'} unless specified otherwise.
- Focus on optimal time/space complexity.
- Be concise — the user is in a live interview.
- If the problem is ambiguous, state your assumption briefly then solve.
- Format: code block with language, then complexity on next line.

CRITICAL: Keep responses short. The user is in a live interview and needs the answer fast.`;

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: context ? `Context: ${context}\n\nProblem: ${problem}` : problem }
  ];

  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: messages,
    temperature: 0.3,
    max_tokens: 1500
  });

  try {
    const result = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'api.deepseek.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (resp) => {
        let chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch(e) { resolve({}); }
        });
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    if (result.choices && result.choices[0] && result.choices[0].message) {
      res.json({ reply: result.choices[0].message.content });
    } else {
      res.json({ reply: 'Error generating solution.', debug: JSON.stringify(result).slice(0,200) });
    }
  } catch (e) {
    res.json({ reply: 'Error: ' + e.message });
  }
};
