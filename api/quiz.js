const https = require('https');

// ── DATA INTEGRITY GUARD (Oct 1 2026) ────────────────────────────────────────
// Monitoring probes (SpeedCheck Probe / AutoFixer Test / HealthCheck Test /
// QuizVerify Test / Test User) wrote REAL entries into production scores.json
// ~48x/day. At the 500-entry cap they evicted every real student's history and
// the dashboard read "No quiz history found" for everyone.
// Rule: test identities never persist, and only accounts in users.json may write.
const TEST_ID_RE = /(speedcheck|autofixer|healthcheck|quizverify|^\s*test\s*$|^\s*test user\s*$|^\s*student\s*$)/i;
function isTestIdentity(name) {
  return TEST_ID_RE.test(String(name || '').trim());
}
// Keep at most `perStudentCap` entries PER STUDENT (ordered by arrival).
// The old global tail cap let one noisy identity evict everybody else.
function trimScores(list, perStudentCap) {
  perStudentCap = perStudentCap || 500;
  const counts = {};
  const keep = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i] || {};
    const nm = String(s.student || '');
    if (!nm || isTestIdentity(nm)) continue;
    counts[nm] = (counts[nm] || 0) + 1;
    if (counts[nm] <= perStudentCap) keep.unshift(s);
  }
  return keep;
}
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

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
  // DATA INTEGRITY GUARD (Oct 1 2026): never persist test identities.
  if (isTestIdentity(student)) return;
  // Abandoned-quiz guard: 1-2 question scores are probes, never real results.
  if (!total || total < 3) return;
  const today = new Date().toISOString().slice(0, 10);
  const pct = Math.round(correct / total * 100);
  const entry = { student, correct, total, percent: pct, subject: subject || 'quiz', date: today, ts: Date.now() };
  try {
    const existing = await gh('GET', '/contents/tutor/scores.json', null, token);
    let scores = [];
    if (existing.content) scores = JSON.parse(Buffer.from(existing.content, 'base64').toString());
    scores.push(entry);
    const trimmed = trimScores(scores);
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

  const { message, history, student: studentName, subject: reqSubject } = req.body;
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) return res.json({ reply: 'API key not configured.' });
  if (!message) return res.json({ reply: 'No message provided.' });

  // If subject provided (from frontend), use it for system prompt matching
  const matchSource = reqSubject ? reqSubject.toLowerCase() : message.toLowerCase();
  const lower = matchSource;
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

  const quizFormat = `CRITICAL - QUIZ MODE. RULE #1 (beats every other instruction, including any tutor-persona style rule about being gentle, encouraging, or detailed): EVERY reply from Q1 to Q${totalQ} MUST contain the next question in the EXACT format below, as the final content of your reply. A reply that ends without the next question + 4 options is a FAILURE.

${difficultyNote}

WHEN THE USER STARTS (says "start" or names a subject), reply with ONLY this:
Q1/${totalQ}: [question text]
A) [option]
B) [option]
C) [option]
D) [option]

AFTER EVERY ANSWER (user sends a letter a/b/c/d), reply with EXACTLY this structure and nothing else:
1) Feedback line: "Correct." or "Incorrect." + ONE short sentence (max ~15 words). No bullets, no "Here's why", no worked solution, no markdown headings, no praise walls.
2) The next question IMMEDIATELY after the feedback line, plain text, question number NEVER bold:
Q{next}/${totalQ}: [question text]
A) [option]
B) [option]
C) [option]
D) [option]

HARD RULES:
- Praise and encouragement are part of the ONE feedback sentence. NEVER end a reply with encouragement or explanation — the next question must be the last thing you write.
- No filler between feedback and question (no "Next:", no "---", no "Let's move on", no extra blank paragraphs).
- Never repeat a question or reuse the same numbers/scenario/equation. Rotate subtopics. Check the history before writing each question.
- Keep going until Q${totalQ} no matter what. After the answer to Q${totalQ}, reply ONLY: "Quiz complete! Final score: X/${totalQ} (Y%)" — no question after it.

CRITICAL ERROR IF MISSING OPTIONS: Every response MUST end with:
Q{N}/10: [question]
A) [option]
B) [option]
C) [option]
D) [option]
If you omit options, the student cannot continue the quiz. This breaks the entire learning flow.`;

  if (lowerNoSpace.includes('series66') || lower.includes('series 66')) {
    system = `You are a Series 66 exam prep tutor. The Series 66 (Uniform Combined State Law Exam) covers state securities regulations, investment adviser registration, ethical practices, financial statements, and client communication.

ROTATION RULE: You MUST rotate through ALL these subtopics evenly: securities regulations, investment adviser registration, ethical practices, financial statements, client communication, bonds, stocks, mutual funds, retirement plans, and exemptions. NEVER ask two questions from the same subtopic in a row.

${quizFormat}`;
  } else if (lowerNoSpace.includes('series7') || lower.includes('series 7')) {
    system = `You are a Series 7 exam prep tutor covering equity/debt securities, options, mutual funds, municipal securities, retirement plans, and margin accounts.

ROTATION RULE: You MUST rotate through ALL these subtopics evenly: equity securities, debt securities, options strategies, mutual funds, municipal securities, retirement plans, margin accounts, underwriting, and regulations. NEVER ask two questions from the same subtopic in a row.

${quizFormat}`;
  } else if (lower.includes('sat')) {
    system = `You are an SAT prep tutor covering math, reading, and writing.

ROTATION RULE: Rotate between math, reading, and writing every question. Math subtopics: algebra, geometry, data analysis, advanced math. Reading: literature, history, science passages. Writing: grammar, punctuation, style. NEVER repeat the same concept twice.

${quizFormat}`;
  } else if (lower.includes('math')) {
    system = `You are a math tutor for Irvine High School covering algebra, geometry, precalculus, and calculus.

ROTATION RULE: Rotate between algebra, geometry, precalculus, and calculus. Each question must be a different subtopic. Use different numbers, equations, and problem types every time. NEVER reuse the same equation or problem structure.

${quizFormat}`;
  } else if (lower.includes('rn') || lower.includes('nursing') || lower.includes('nclex')) {
    system = `You are an NCLEX-RN exam prep tutor covering pharmacology, anatomy, physiology, and nursing practices.

ROTATION RULE: Rotate through pharmacology, anatomy, physiology, nursing practices, and patient safety. NEVER ask two pharmacology questions in a row. Change the drug names, conditions, and scenarios every question.

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
    system = `You are an 11th grade Irvine High School tutor for a UCI college-prep student (UC is test-blind — SAT is NOT part of prep). Cover his ACTUAL junior-year courses: AP Biology (cells, genetics, evolution, ecology, molecular bio), Algebra 2 retake (A-G repair priority — linear/quadratic/polynomial functions, exponents, logarithms, sequences, systems), AP English Language (rhetorical analysis, argument, synthesis), US History (colonial through modern, AP-level), and VPA/foundations. Rotate between subjects randomly across questions. This is comprehensive UCI academics prep — GPA and A-G readiness are the score, not tests.

${quizFormat}`;
  } else if (lower.includes('grade4') || lower.includes('4th grade') || lower.includes('fourth grade')) {
    system = `You are a gentle, encouraging 4th grade elementary school tutor covering Math, Reading, Science, and Social Studies. This student is at a 3rd grade comfort level, so keep everything simple, friendly, and confidence-building.

ROTATION RULE: Rotate between Math (multiplication tables up to 10, simple division, addition/subtraction, money, time, simple word problems — start EASY and only gently introduce simple fractions like 1/2 or 1/4 if the student succeeds first), Reading (short comprehension passages, vocabulary, main idea), Science (plants, animals, weather, simple earth science), and Social Studies (community, maps, basic US history). NEVER ask two questions from the same subject in a row. NO decimals, NO algebra, NO multi-step word problems. Keep sentences short and wording simple — this is a 9 year old building confidence. Praise progress with the format provided.

${quizFormat}`;
  } else if (lower.includes('grade3') || lower.includes('3rd grade') || lower.includes('third grade')) {
    system = `You are a 3rd grade elementary school tutor covering Math, Reading, Science, and Social Studies at age-appropriate level.

ROTATION RULE: Rotate between Math (addition, subtraction, multiplication tables up to 10, simple division, money, time, simple word problems), Reading (comprehension, vocabulary, phonics, main idea), Science (plants, animals, weather, simple earth science), and Social Studies (community, maps, basic US history). NEVER ask two questions from the same subject in a row. Keep language simple and friendly — this is an 8-9 year old student. No fractions, no decimals, no algebra.

${quizFormat}`;
  } else if (lower.includes('realestate') || lower.includes('real estate') || lower.includes('wa real')) {
    system = `You are a Washington State real estate exam prep tutor covering the Washington salesperson/broker licensing exam (WA DOL).

ROTATION RULE: You MUST rotate through ALL these subtopics evenly: real estate law (RCW/WAC), agency relationships, contracts, property ownership & estates, financing/mortgages, appraisal & valuation, land use & zoning, fair housing (FHA), property management, and Washington-specific rules (earnest money, closing, trust accounts). NEVER ask two questions from the same subtopic in a row.

STYLE: Multiple-choice exam questions like the actual WA state exam. Include Washington-specific legal concepts (e.g., RCW 18.85 real estate broker act, escrow rules, agency disclosure requirements). Keep questions concise and directly test exam knowledge.

${quizFormat}`;
  } else if (lowerNoSpace.includes('apeng') || lower.includes('ap english') || lower.includes('ap lang')) {
    system = `You are an AP English Language and Composition tutor for an 11th grader preparing for the AP exam and a class grade repair.

COVERAGE: rhetorical analysis (SOAPStone, appeals, claims vs. evidence, line of reasoning, tone, syntax, diction), argument essay (defend / challenge / qualify a position), synthesis (using and citing provided sources), passage-based multiple choice, and style devices (metaphor, juxtaposition, anaphora, parallelism, hyperbole, understatement).

STYLE: Write real AP-style stem questions — either a short passage with an analysis question ("In the sentence ..., the metaphor primarily emphasizes ...") or a composition decision question. Each question must test reasoning the exam actually rewards, not trivia definitions.

ROTATION RULE: Cycle rhetorical analysis → argument → synthesis → multiple choice skills. NEVER ask two questions from the same skill in a row.

${quizFormat}`;
  } else if (lowerNoSpace.includes('apbio') || lower.includes('ap biology') || lower.includes('ap bio')) {
    system = `You are an AP Biology tutor for an 11th grader preparing for the AP exam and a class grade repair (D currently, lever = unit tests).

COVERAGE: chemistry of life, cell structure and transport, cellular energetics (glycolysis, Krebs, oxidative phosphorylation, photosynthesis), cell communication and signal transduction, cell cycle and mitosis/meiosis, heredity and gene expression, natural selection and evolution, ecology, and experimental design with data analysis.

STYLE: AP-style questions — model-based and data-based stems, "which of the following best explains", cause-and-effect about specific molecules and organelles. Include the biology vocabulary the teacher tests (receptor, ligand, feedback, transcription, allele) rather than generic science filler.

ROTATION RULE: Cycle through the units above. NEVER ask two questions from the same unit in a row.

${quizFormat}`;
  } else if (lowerNoSpace.includes('ushist') || lower.includes('us history') || lower.includes('u.s. history')) {
    system = `You are an AP United States History tutor for an 11th grader.

COVERAGE: Period 1–9 — colonial era and Revolution, Constitution and early republic, market revolution and reform, sectional crisis, Civil War and Reconstruction, Gilded Age and industrialization, Progressivism, imperialism, WWI, the 1920s, Depression and New Deal, WWII, Cold War and civil rights, and post-1980 politics.

STYLE: AP-style questions: identify causation, continuity and change, comparison, and interpretation of historical evidence. Stems should name specific events, acts, amendments, or figures where the teacher would test them.

ROTATION RULE: Move chronologically forward through the periods, then restart. NEVER ask two questions from the same era in a row.

${quizFormat}`;
  } else if (lower.includes('physics')) {
    system = `You are a physics tutor for an 11th grader in a first-year (algebra-based) physics course.

COVERAGE: kinematics (distance, displacement, speed, velocity, acceleration), Newton's laws and free-body reasoning, work, energy and power, momentum and collisions, circular motion and gravitation, waves and sound, light and optics, electric charge and circuits, magnetism, and thermodynamics.

STYLE: Mix conceptual questions with short quantitative ones — always give numbers with units and make exactly one option correct under standard formulas (v = d/t, F = ma, KE = ½mv², W = Fd, p = mv). Keep arithmetic clean enough to do without a calculator.

ROTATION RULE: Cycle the topics above. NEVER ask two kinematics or two calculation questions in a row.

${quizFormat}`;
  }

  try {
    const msgs = [{ role: 'system', content: system }];
    if (history && Array.isArray(history)) {
      for (const h of history.slice(-20)) msgs.push(h);
    }
    msgs.push({ role: 'user', content: message });

    // Server-side rotation enforcement for grade9 — force different subject every time
    if ((system.includes('9th grade') || lower.includes('grade9')) && history && Array.isArray(history)) {
      const lastAssistant = history.filter(m => m.role === 'assistant').pop();
      if (lastAssistant) {
        const subjMatch = lastAssistant.content.match(/\[(Math 1|Biology|English 9|World History|Health)\]/);
        const lastSubj = subjMatch ? subjMatch[1] : null;
        // Track cycle of all asked subjects
        const allSubjects = history.filter(m => m.role === 'assistant').map(m => {
          const s = m.content.match(/\[(Math 1|Biology|English 9|World History|Health)\]/);
          return s ? s[1] : null;
        }).filter(Boolean);
        // Determine next subject
        const ORDER = ["Math 1", "Biology", "English 9", "World History", "Health"];
        let nextSubj;
        if (lastSubj) {
          const lastIdx = ORDER.indexOf(lastSubj);
          nextSubj = ORDER[(lastIdx + 1) % ORDER.length];
        } else if (allSubjects.length) {
          // Label missing — pick the least recent subject
          const askedCounts = ORDER.map(s => ({s, c: allSubjects.filter(x => x === s).length}));
          askedCounts.sort((a,b) => a.c - b.c);
          nextSubj = askedCounts[0].s;
        } else {
          nextSubj = "Biology"; // default first rotation
        }
        const subjNote = lastSubj ? `Last question was ${lastSubj}.` : `Rotate subjects.`;
        msgs.push({ role: 'user', content: `[SYSTEM: ${subjNote} Next question MUST be ${nextSubj}. DO NOT repeat the last subject.]` });
      }
    }

    const body = JSON.stringify({ model: MODEL, messages: msgs, temperature: 0.7, max_tokens: 1500 });
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
      let reply = result.choices[0].message.content;

      // FORMAT GUARD (Sep 4 2026): stall detector. A mid-quiz reply is broken if
      // it lacks the next-question marker (Q{n}/33:) OR real option LINES.
      // The old anywhere-regex was fooled by prose mentions like "the answer is
      // **B) 48**" inside explanations, letting question-less replies through and
      // stalling the student (grade4/math/series7 Q2 fails, Sep 4). Anchored lines only.
      const qReply = reply || '';
      const qComplete = /Quiz\s*complete/i.test(qReply);
      const qHasNext = /\bQ\s*\d+\s*\/\s*\d+\s*:/.test(qReply);
      const qHasOpts = /(?:^|\n)\s*[A-D][)\]]\s+\S/.test(qReply);
      if (qReply && !qComplete && (!qHasNext || !qHasOpts)) {
        try {
          const fixMsgs = msgs.concat([
            { role: 'assistant', content: reply },
            { role: 'user', content: '[SYSTEM: You forgot the next question. Output ONLY the next question in EXACTLY this format:\nQ' + (history && history.length ? Math.min(Math.ceil(history.length / 2) + 1, 33) : 2) + '/33: [question]\nA) [option]\nB) [option]\nC) [option]\nD) [option]\nNo explanation. No extra text.]' }
          ]);
          const fixBody = JSON.stringify({ model: MODEL, messages: fixMsgs, temperature: 0.7, max_tokens: 400 });
          const fixOpts = { hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(fixBody) } };
          const fixResult = await new Promise((resolve, reject) => {
            const r2 = https.request(fixOpts, (resp) => {
              let chunks = [];
              resp.on('data', (c) => chunks.push(c));
              resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { resolve({}); } });
            });
            r2.on('error', reject);
            r2.write(fixBody);
            r2.end();
          });
          if (fixResult.choices && fixResult.choices[0] && fixResult.choices[0].message) {
            const fixed = fixResult.choices[0].message.content;
            if (fixed && /\bQ\s*\d+\s*\/\s*\d+\s*:/.test(fixed) && /(?:^|\n)\s*[A-D][)\]]\s+\S/.test(fixed)) reply = fixed;
          }
        } catch (e) {}
      }
      
      // EMPTY-REPLY RETRY (Sep 15 2026): the format guard above only fires when the
      // reply is NON-empty. A transient empty completion (observed on series66 turn 3)
      // fell straight through and the student got a BLANK question — an unrecoverable
      // stall from their side. Retry the model up to 2x, then return a graceful
      // continue-card so the quiz can never dead-end on an empty screen.
      if (!reply || !reply.trim()) {
        for (let attempt = 0; attempt < 2 && (!reply || !reply.trim()); attempt++) {
          try {
            const rBody = JSON.stringify({ model: MODEL, messages: msgs, temperature: 0.8, max_tokens: 1500 });
            const rOpts = { hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(rBody) } };
            const rRes = await new Promise((resolve, reject) => {
              const r3 = https.request(rOpts, (resp) => {
                let cks = []; resp.on('data', (c) => cks.push(c));
                resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(cks).toString())); } catch(e) { resolve({}); } });
              });
              r3.on('error', reject); r3.write(rBody); r3.end();
            });
            if (rRes.choices && rRes.choices[0] && rRes.choices[0].message && rRes.choices[0].message.content) {
              reply = rRes.choices[0].message.content;
            }
          } catch (e) {}
        }
      }
      // Last resort — never hand a student an empty question.
      if (!reply || !reply.trim()) {
        const qn = (history && history.length) ? Math.min(Math.ceil(history.length / 2) + 1, 33) : 1;
        reply = 'Q' + qn + '/33: Connection hiccup — your progress is safe.\nA) Continue the quiz\nB) Retry this question\nC) Ask a different subject\nD) End for today\nPing your tutor if this repeats.';
      }

      // Auto-save score if quiz complete
      if (studentName && reply.match(/Quiz\s*complete/i)) {
        const scoreMatch = reply.match(/Score:\s*(\d+)\s*\/\s*(\d+)/i);
        if (scoreMatch) {
          const correct = parseInt(scoreMatch[1]);
          const total = parseInt(scoreMatch[2]);
          const pct = Math.round(correct / total * 100);
          // Determine subject from the request (frontend already knows the deck) or history
          let subject = (typeof reqSubject === 'string' && reqSubject.trim()) ? reqSubject.trim() : 'quiz';
          if (subject === 'quiz' && history && Array.isArray(history)) {
            const firstMsg = history.find(m => m.role === 'user');
            if (firstMsg) {
              const t = firstMsg.content.toLowerCase();
              if (t.includes('series66') || t.includes('series 66')) subject = 'series66';
              else if (t.includes('series7') || t.includes('series 7')) subject = 'series7';
              else if (t.includes('apeng') || t.includes('ap english') || t.includes('ap lang')) subject = 'apeng';
              else if (t.includes('apbio') || t.includes('ap biology')) subject = 'apbio';
              else if (t.includes('ushist') || t.includes('us history')) subject = 'ushist';
              else if (t.includes('physics')) subject = 'physics';
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
