const https = require('https');

// GitHub API helper for saving scores (same pattern as save-score.js)
function gh(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : '';
    const opts = { hostname: 'api.github.com', path: `/repos/royceAIsolutions/royceAIsolutions.github.io${path}`,
      method, headers: { 'User-Agent': 'royceai', 'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' } };
    if (b) { opts.headers['Content-Length'] = Buffer.byteLength(b); }
    const r = https.request(opts, (resp) => { let c=[]; resp.on('data',d=>c.push(d)); resp.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(c).toString()))}catch(e){resolve({})}}); });
    r.on('error', reject); if (b) r.write(b); r.end();
  });
}

async function saveQuizScore(student, correct, total, subject) {
  const token = process.env.GH_TOKEN;
  if (!token) return;
  const today = new Date().toISOString().slice(0, 10);
  const pct = Math.round(correct / total * 100);
  const entry = { student, correct, total, percent: pct, subject: subject || 'quiz', date: today, ts: Date.now() };
  try {
    const existing = await gh('GET', '/contents/tutor/scores.json', null, token);
    let scores = [];
    if (existing.content) scores = JSON.parse(Buffer.from(existing.content, 'base64').toString());
    scores.push(entry);
    const trimmed = scores.slice(-500);
    const newContent = Buffer.from(JSON.stringify(trimmed, null, 2)).toString('base64');
    await gh('PUT', '/contents/tutor/scores.json', { message: `Quiz: ${student} ${correct}/${total} (${pct}%)`, content: newContent, sha: existing.sha }, token);
    
    // Update users.json
    const usersResp = await gh('GET', '/contents/tutor/users.json', null, token);
    if (usersResp.content) {
      let users = JSON.parse(Buffer.from(usersResp.content, 'base64').toString());
      const idx = users.findIndex(u => u.id === student.toLowerCase().replace(/\s+/g, ' '));
      if (idx >= 0) {
        users[idx].today = `${correct}/${total} (${pct}%)`;
        const thisMonth = today.slice(0, 7);
        const studentScores = trimmed.filter(s => s.student === student);
        const mtdScores = studentScores.filter(s => s.date && s.date.startsWith(thisMonth));
        if (mtdScores.length) {
          const mc = mtdScores.reduce((a,s) => a + s.correct, 0);
          const mt = mtdScores.reduce((a,s) => a + s.total, 0);
          users[idx].mtd = `${mc}/${mt} (${Math.round(mc/mt*100)}%)`;
        }
        const yc = studentScores.reduce((a,s) => a + s.correct, 0);
        const yt = studentScores.reduce((a,s) => a + s.total, 0);
        if (yt > 0) users[idx].ytd = `${yc}/${yt} (${Math.round(yc/yt*100)}%)`;
        const newUsersContent = Buffer.from(JSON.stringify(users, null, 2)).toString('base64');
        await gh('PUT', '/contents/tutor/users.json', { message: `Update ${student} score: ${correct}/${total}`, content: newUsersContent, sha: usersResp.sha }, token);
      }
    }
  } catch (e) {}
}

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
    if (avg >= 0.95) difficulty = "SAT / AP exam level — maximum difficulty";
    else if (avg >= 0.80) difficulty = "honors level — harder questions";
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
    system = `You are a 9th grade Irvine High School tutor covering Math 1, Biology, English 9, World History, and Health.

${quizFormat}

CRITICAL SUBJECT ROTATION: Label each question with its subject in brackets before the question number. Example:
[Math 1] Q1/33: What is the slope of y = 2x + 3?
[Biology] Q2/33: What organelle produces ATP?
[English 9] Q3/33: What is a metaphor?
[World History] Q4/33: What was the Code of Hammurabi?
[Health] Q5/33: What macronutrient provides the most energy per gram?

ABSOLUTELY FORBIDDEN: Two questions from the same subject in a row. Rotate through all 5 subjects in order. Do NOT ask Math twice in a row.`;
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

    // Server-side rotation enforcement for grade9 — check last subject in history
    if ((lower.includes('grade9') || lower.includes('freshman')) && history && Array.isArray(history)) {
      const lastAssistant = history.filter(m => m.role === 'assistant').pop();
      if (lastAssistant) {
        const subjMatch = lastAssistant.content.match(/\[(Math 1|Biology|English 9|World History|Health)\]/);
        if (subjMatch) {
          const lastSubj = subjMatch[1];
          // Check if last 2+ questions are same subject — inject reminder
          const allSubjects = history.filter(m => m.role === 'assistant').map(m => {
            const s = m.content.match(/\[(Math 1|Biology|English 9|World History|Health)\]/);
            return s ? s[1] : null;
          }).filter(Boolean);
          const recentSubjects = allSubjects.slice(-3);
          const sameCount = recentSubjects.filter(s => s === lastSubj).length;
          if (sameCount >= 2) {
            // Force rotation
            const nextSubjects = ["Biology", "English 9", "World History", "Health", "Math 1"];
            const nextSubj = nextSubjects.find(s => s !== lastSubj) || "Biology";
            msgs.push({ role: 'user', content: `[SYSTEM: Last question was ${lastSubj}. The next question MUST be ${nextSubj}. DO NOT repeat ${lastSubj}.]` });
          }
        }
      }
    }

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
      const reply = result.choices[0].message.content;
      
      // Auto-save score if quiz complete
      if (studentName && reply.match(/Quiz\s*complete/i)) {
        const scoreMatch = reply.match(/Score:\s*(\d+)\s*\/\s*(\d+)/i);
        if (scoreMatch) {
          const correct = parseInt(scoreMatch[1]);
          const total = parseInt(scoreMatch[2]);
          const pct = Math.round(correct / total * 100);
          // Determine subject from history
          let subject = 'quiz';
          if (history && Array.isArray(history)) {
            const firstMsg = history.find(m => m.role === 'user');
            if (firstMsg) {
              const t = firstMsg.content.toLowerCase();
              if (t.includes('series66') || t.includes('series 66')) subject = 'series66';
              else if (t.includes('series7') || t.includes('series 7')) subject = 'series7';
              else if (t.includes('sat')) subject = 'sat';
              else if (t.includes('math')) subject = 'math';
              else if (t.includes('rn') || t.includes('nursing') || t.includes('nclex')) subject = 'rn';
              else if (t.includes('grade9') || t.includes('freshman')) subject = 'grade9';
              else if (t.includes('grade11') || t.includes('junior')) subject = 'grade11';
            }
          }
          // Fire-and-forget save
          saveQuizScore(studentName, correct, total, subject).catch(() => {});
        }
      }
      
      res.json({ reply });
    } else {
      res.json({ reply: 'AI service error.', debug: JSON.stringify(result).slice(0,200) });
    }
  } catch (e) {
    res.json({ reply: 'Error: ' + e.message });
  }
};
