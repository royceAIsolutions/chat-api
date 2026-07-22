const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { message, history, student: studentName } = req.body;
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) return res.json({ reply: 'API key not configured.' });
  if (!message) return res.json({ reply: 'No message provided.' });

  const lower = message.toLowerCase();
  const lowerNoSpace = lower.replace(/\s+/g, '');
  let system = 'You are RoyceAI, an AI tutor. Be helpful and concise.';

  // Unified quiz format — 33 questions across the board
  const totalQ = 33;
  const qLabel = `Q1/${totalQ}`;
  
  // Difficulty scaling based on history
  let difficulty = "9th grade level";
  if (history && Array.isArray(history)) {
    const scoreLines = history.filter(m => m.role === 'assistant' && m.content && m.content.includes('Score:'));
    const lastScores = scoreLines.slice(-3).map(s => {
      const m = s.content.match(/Score:\s*(\d+)\s*\/\s*(\d+)/i);
      return m ? parseInt(m[1]) / parseInt(m[2]) : 0;
    });
    const avg = lastScores.length ? lastScores.reduce((a,b) => a+b, 0) / lastScores.length : 0;
    if (avg >= 0.95) difficulty = "advanced / college level — very challenging questions";
    else if (avg >= 0.80) difficulty = "honors / AP level — harder than standard";
    else if (avg >= 0.60) difficulty = "above grade level";
  }
  const difficultyNote = `The student has been performing at ${difficulty}. Adjust question difficulty accordingly.`;

  const quizFormat = `CRITICAL - QUIZ MODE. YOU MUST ALWAYS INCLUDE THE NEXT QUESTION WITH 4 OPTIONS.
${difficultyNote}

YOU START THE QUIZ. When the user says "start" or begins a subject, immediately ask Q1.

WHEN ASKING Q1 - Output EXACTLY this format (no extra text before or after):
Q1/${totalQ}: [question text]
A) [option]
B) [option]
C) [option]
D) [option]

WHEN STUDENT ANSWERS with a letter a/b/c/d - Output EXACTLY this format:
[Correct/Incorrect]. [1 sentence max]. Q2/${totalQ} | Score: 1/1 (100%)
Q2/${totalQ}: [question]
A) [option]
B) [option]
C) [option]
D) [option]

CRITICAL: You MUST ALWAYS include the NEXT question with A/B/C/D options right after the score line. NEVER respond without the next question + options. NEVER give extra explanation instead of the next question.

NEVER REPEAT A QUESTION. Every question must be unique and different from all previous questions. Check the conversation history carefully before generating a new question — if you have already asked a similar question, change the topic or concept.

ABSOLUTE RULE: Your response must ALWAYS contain A) B) C) D) options for the next question immediately after the score line. NEVER respond with just a correction. The next question + 4 options are MANDATORY in every single response.

CRITICAL FORMAT: The question number must be PLAIN TEXT, NOT bold/markdown. Use "Q2/${totalQ}:" NOT "**Q2/${totalQ}:**". No asterisks around the Q number.

After Q${totalQ}, say "Quiz complete! Final score: X/${totalQ} (Y%)" and do NOT include a next question. NEVER end the quiz before Q${totalQ}. Keep going until Q${totalQ} no matter what.
ABSOLUTE RULE: Your response must ALWAYS contain A) B) C) D) options for the next question immediately after the score line. NEVER respond with just a correction. The next question + 4 options are MANDATORY in every single response until Q${totalQ}.
ABSOLUTE RULE: Your response must ALWAYS contain A) B) C) D) options for the next question immediately after the score line. NEVER respond with just a correction. The next question + 4 options are MANDATORY in every single response until Q${totalQ}.`;

  if (lowerNoSpace.includes('series66') || lower.includes('series 66')) {
    system = `You are a Series 66 exam prep tutor. The Series 66 (Uniform Combined State Law Exam) covers state securities regulations, investment adviser registration, ethical practices, financial statements, and client communication.

${quizFormat}`;
  } else if (lowerNoSpace.includes('series7') || lower.includes('series 7')) {
    system = `You are a Series 7 exam prep tutor covering equity/debt securities, options, mutual funds, municipal securities, retirement plans, and margin accounts.

${quizFormat}`;
  } else if (lower.includes('sat')) {
    system = `You are an SAT prep tutor covering math, reading, and writing.

${quizFormat}`;
  } else if (lower.includes('math')) {
    system = `You are a math tutor for Irvine High School covering algebra, geometry, precalculus, and calculus.

${quizFormat}`;
  } else if (lower.includes('rn') || lower.includes('nursing') || lower.includes('nclex')) {
    system = `You are an NCLEX-RN exam prep tutor covering pharmacology, anatomy, physiology, and nursing practices.

${quizFormat}`;
  } else if (lower.includes('grade9') || lower.includes('freshman')) {
    system = `You are a 9th grade Irvine High School tutor covering ALL subjects: Math 1 (algebra, geometry fundamentals), Biology, English 9 (literature, composition), World History, and Health. Rotate between subjects randomly across questions. This is comprehensive 9th grade prep.

${quizFormat}`;
  } else if (lower.includes('grade11') || lower.includes('junior')) {
    system = `You are an 11th grade Irvine High School tutor covering ALL subjects: Math 3/Precalculus, Chemistry, English 11 (American literature, rhetorical analysis), US History, and SAT prep. Rotate between subjects randomly across questions. This is comprehensive junior year prep.

${quizFormat}`;
  }

  try {
    const msgs = [{ role: 'system', content: system }];
    if (history && Array.isArray(history)) {
      for (const h of history.slice(-20)) msgs.push(h);
    }
    msgs.push({ role: 'user', content: message });

    const body = JSON.stringify({ model: 'deepseek-chat', messages: msgs, temperature: 0.7, max_tokens: 1500 });
    const opts = { hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) } };

    const result = await new Promise((resolve, reject) => {
      const r = https.request(opts, (resp) => {
        let chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => { try { 
          const parsed = JSON.parse(Buffer.concat(chunks).toString());
          resolve(parsed);
        } catch(e) { resolve({}); } });
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    if (result.choices && result.choices[0] && result.choices[0].message) {
      res.json({ reply: result.choices[0].message.content });
    } else {
      res.json({ reply: 'AI service error.', debug: JSON.stringify(result).slice(0,200) });
    }
  } catch (e) {
    res.json({ reply: 'Error: ' + e.message });
  }
};
