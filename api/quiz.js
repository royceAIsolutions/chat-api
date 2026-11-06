const https = require('https');

// ── AUTHORED DRILL BANKS ─────────────────────────────────────────────────────
// Fixed, keyed question sets graded deterministically — no model call, so no
// invented stems, no subject drift and no 30s timeout on a 33-question drill.
// Files live under api/_banks/ so Vercel does not expose them as routes; the
// BUNDLED copy is only a fallback. The live set is refreshed daily by a cron
// job that rewrites tutor/drill/<id>.json in the static-site repo, so a fresh
// bank ships without a Vercel deploy.
const DRILL_BANKS = { rescue: require('./_banks/rescue') };
const DRILL_REMOTE = 'https://royceai.com/tutor/drill/';
const BANK_TTL_MS = 10 * 60 * 1000;
const bankCache = {}; // id -> { at, bank }

function fetchJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'royceai-quiz' } }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return resolve(null); }
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { body += c; if (body.length > 500000) req.destroy(); });
      r.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs || 2500, () => { req.destroy(); resolve(null); });
  });
}

function isBank(b) {
  return b && Array.isArray(b.questions) && b.questions.length >= 5 &&
    b.questions.every(q => q && q.stem && q.answer && Array.isArray(q.options) && q.options.length === 4);
}

async function getBank(id) {
  const hit = bankCache[id];
  if (hit && Date.now() - hit.at < BANK_TTL_MS) return hit.bank;
  const remote = await fetchJson(DRILL_REMOTE + id + '.json');
  const bank = isBank(remote) ? remote : DRILL_BANKS[id];
  if (!bank) return null;
  bankCache[id] = { at: Date.now(), bank };
  return bank;
}


function drillReply(bank, history, message) {
  const qs = bank.questions;
  const total = qs.length;
  const hist = Array.isArray(history) ? history : [];
  const scored = hist.filter(m => m.role === 'assistant' && /^Correct/i.test(String(m.content || '')));
  let answered = 0;
  for (const m of hist) {
    if (m.role !== 'assistant') continue;
    const hit = String(m.content || '').match(/Q(\d+)\s*\/\s*(\d+)/);
    if (hit && Number(hit[1]) > answered) answered = Number(hit[1]);
  }
  const fmtQ = (i) => {
    const q = qs[i];
    return `Q${q.n}/${total}: ${q.stem}\n` +
      q.options.map((o, j) => `${'ABCD'[j]}) ${o}`).join('\n');
  };
  if (!answered) return { reply: fmtQ(0) };

  const q = qs[answered - 1];
  const letter = (String(message || '').toUpperCase().match(/(?:^|[^A-Z])([ABCD])(?:[^A-Z]|$)/) || [])[1];
  if (!letter) return { reply: `Please answer with a single letter — A, B, C or D.\n\n${fmtQ(answered - 1)}` };

  const right = letter === q.answer;
  const corr = scored.length + (right ? 1 : 0);
  const head = right
    ? `Correct. ${q.why}`
    : `Incorrect. The answer is ${q.answer} — ${q.why}`;
  const tail = `Score: ${corr}/${answered}`;
  const next = answered < total
    ? `\n\n${fmtQ(answered)}`
    : `\n\nQuiz complete — ${bank.title}, ${corr}/${total} (${Math.round((corr / total) * 100)}%).`;
  return { reply: `${head}\n${tail}${next}` };
}


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
  
  // ── DIFFICULTY CALIBRATION (Nov 4 2026) ────────────────────────────────────
  // This used to default to "9th grade level" for every student, and that note is embedded in
  // quizFormat, so an AP junior's physics and biology decks were being told to aim at 9th grade
  // — the source of definition-level ("which of these is a vector?") questions. Calibrate to the
  // deck's own course instead, and only stretch when the history shows evidence: either explicit
  // "Score: x/y" lines or the dashboard's own Correct/Incorrect turns.
  let accuracy = null;
  if (history && Array.isArray(history)) {
    const graded = history.filter(m => m.role === 'assistant' && typeof m.content === 'string');
    const scoreRatios = [];
    let correctTurns = 0, gradedTurns = 0;
    for (const m of graded) {
      const sm = m.content.match(/Score:\s*(\d+)\s*\/\s*(\d+)/i);
      if (sm) {
        const t = parseInt(sm[2], 10);
        if (t > 0) scoreRatios.push(parseInt(sm[1], 10) / t);
        continue;
      }
      if (/^correct\b/i.test(m.content.trim())) { correctTurns++; gradedTurns++; }
      else if (/^incorrect\b/i.test(m.content.trim())) { gradedTurns++; }
    }
    if (scoreRatios.length) accuracy = scoreRatios.reduce((a, b) => a + b, 0) / scoreRatios.length;
    else if (gradedTurns >= 3) accuracy = correctTurns / gradedTurns;
  }
  let difficulty;
  if (accuracy === null) difficulty = 'the course level this deck covers — never simplified below it';
  else if (accuracy >= 0.95) difficulty = 'the top of this course (AP exam / honors depth)';
  else if (accuracy >= 0.80) difficulty = 'honors depth within this course';
  else if (accuracy >= 0.50) difficulty = 'the standard course level';
  else difficulty = 'course level, sequenced from the fundamentals up while they recover accuracy';
  const difficultyNote = `Target difficulty: ${difficulty}. Every question must be answerable only by someone actually taking this course.`;

  // ── MATH LEVEL (Nov 4 2026) ─────────────────────────────────────────────────
  // One shared `math` deck was serving a single high-school curriculum to every
  // student, so a 2nd grader got algebra and an Algebra 2 student got middle-school
  // arithmetic. The dashboard now sends the roster's difficulty line as `level`
  // (e.g. "📚 Grade 2 — Foundations", "🔥 Math 3 — 94%", "📚 11th Grade — AP course load");
  // we bucket it here. No level ⇒ the generic HS deck, so old callers behave as before.
  function mathLevelFrom(raw) {
    const l = String(raw || '').toLowerCase();
    if (!l) return '';
    if (/pre-?\s*algebra/.test(l)) return 'prealg';
    if (/calculus/.test(l)) return 'calc';
    if (/pre-?\s*calc/.test(l)) return 'precalc';
    if (/algebra\s*(2|ii)\b|integrated\s*(math\s*)?(2|ii)\b|math\s*(2|ii)\b/.test(l)) return 'alg2';
    if (/math\s*3\b|integrated\s*(math\s*)?3\b/.test(l)) return 'math3';
    if (/algebra\s*(1|i)\b|integrated\s*(math\s*)?1\b|math\s*1\b/.test(l)) return 'alg1';
    const g = l.match(/grade\s*(\d{1,2})/) || l.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*grade/);
    if (g) {
      const n = parseInt(g[1], 10);
      if (n <= 3) return 'elementary';
      if (n <= 5) return 'grade45';
      if (n <= 8) return 'prealg';
      if (n === 9) return 'alg1';
      if (n <= 11) return 'alg2';
      return 'precalc';
    }
    return '';
  }
  const mathLevel = mathLevelFrom(req.body && req.body.level);
  // Bodies only — quizFormat is interpolated in the `math` branch, which runs after it is defined.
  const mathDeck = (body) => body;
  const MATH_DECKS = {
    elementary: mathDeck(`You are a math tutor for a 2nd–3rd grade student. Keep every question small, concrete and encouraging.
COVERAGE: addition and subtraction within 100, place value (ones/tens/hundreds), skip counting, multiplication tables up to 10, simple division, halves and quarters, money, telling time, shapes and simple perimeter, one-step word problems.
STYLE: Short sentences, friendly wording, small whole numbers. Keep every sum and difference within 100. NO algebra, NO decimals, NO multi-step problems, NO negatives.
ROTATION RULE: Rotate addition/subtraction → place value → multiplication → division → fractions/money/time → word problems. NEVER two questions of the same kind in a row.`),
    grade45: mathDeck(`You are a math tutor for a 4th–5th grade student.
COVERAGE: multi-digit multiplication and long division, fractions (equivalent, add/subtract, compare), decimals to hundredths, place value, order of operations, area and perimeter, unit conversion, percentages of a whole, simple data/graph reading, two-step word problems.
STYLE: Grade-level numbers a 9–11 year old can handle without a calculator. NO algebra, NO negative numbers, NO trigonometry.
ROTATION RULE: Rotate arithmetic → fractions/decimals → geometry/measurement → data → word problems. NEVER repeat a subtopic twice in a row.`),
    prealg: mathDeck(`You are a pre-algebra tutor for a middle-school student (grades 6–8).
COVERAGE: integers and absolute value, order of operations, factors/multiples, ratios, rates and proportions, percentages (discount, tax, tip), one- and two-step equations, inequalities, exponent rules, square roots, the coordinate plane, slope as rate of change, simple probability.
STYLE: Middle-school stems with clean integer answers. Show one quantity per sentence — no compound trick questions. NO quadratics, NO logarithms, NO trigonometry.
ROTATION RULE: Rotate integers/order of ops → ratios/percent → equations/inequalities → exponents/roots → coordinate plane/slope → probability. NEVER two equation-solving questions in a row.`),
    alg1: mathDeck(`You are an Algebra 1 / Integrated Math I tutor for a 9th grade student.
COVERAGE: linear equations and inequalities, slope and forms of a line, systems of equations (graphing, substitution, elimination), exponent rules, polynomial addition/multiplication, factoring (GCF, difference of squares, trinomials), quadratic equations by factoring, functions and domain/range, scatterplots and lines of best fit.
STYLE: Standard Algebra 1 stems with exactly one correct answer under the usual procedure. Keep arithmetic clean. Avoid logarithms, complex numbers, and calculus.
ROTATION RULE: Rotate linear → systems → exponents/polynomials → factoring/quadratics → functions. NEVER two linear-equation solves in a row.`),
    alg2: mathDeck(`You are an Algebra 2 / Integrated Math II tutor for an 11th grader whose current course is Math II (quadratics, polynomials, functions, and right-triangle trigonometry).
COVERAGE: quadratic functions (vertex, axis of symmetry, discriminant, roots by factoring/quadratic formula), polynomial functions and end behavior, factoring including sum/difference of cubes, rational expressions and equations, exponent and logarithm rules, exponential growth/decay, sequences and series (arithmetic, geometric), systems of equations in two and three variables, function transformations, inverse functions, right-triangle trigonometry (sine/cosine/tangent, special angles), circles (arcs, chords, inscribed angles), and basic probability/statistics.
STYLE: Math II / Algebra 2 stems — manipulate expressions and reason about graphs, exactly one correct option, clean numbers. This is a student earning an A, so the questions should be genuinely course-level, not arithmetic review. NO precalculus topics (limits, vectors, polar, conic sections) and NO calculus.
ROTATION RULE: Rotate quadratics → polynomials/factoring → rational/exponential/log → sequences/systems → functions/transformations → trigonometry → circles/probability. NEVER two questions from the same strand in a row.`),
    math3: mathDeck(`You are an Integrated Math III / Precalculus tutor for a high-school student.
COVERAGE: polynomial, rational, exponential, logarithmic and trigonometric functions; log properties; trig identities and the unit circle; sequences and series; conics; matrices and systems; vectors; an introduction to limits.
STYLE: Honors-level stems, exactly one correct option. Keep arithmetic tractable. NO formal derivatives or integrals beyond a conceptual limit question.
DEPTH FLOOR: do not ask one-step function evaluation (f(4) on a line), basic slope, or single-step linear equations — that is Algebra 1 work. Every question must require polynomial, rational, exponential, log, trig, conic, sequence, matrix or vector reasoning.
ROTATION RULE: Rotate functions → trigonometry → sequences/conics → matrices/vectors → limits. NEVER two questions from the same strand in a row.`),
    precalc: mathDeck(`You are a precalculus tutor for a high-school senior.
COVERAGE: function analysis and transformations, polynomial and rational functions, exponential and logarithmic functions, trigonometric functions and identities, the unit circle, conic sections, vectors, sequences and series, matrices, and limits as preparation for calculus.
STYLE: Precalculus stems with exactly one correct answer. Keep arithmetic clean. NO derivatives or integrals.
ROTATION RULE: Rotate functions → exponentials/logs → trigonometry → conics/vectors → limits. NEVER two questions from the same strand in a row.`),
    calc: mathDeck(`You are an introductory calculus tutor for a high-school or first-year college student.
COVERAGE: limits and continuity, the definition of the derivative, derivative rules (power, product, quotient, chain), applications (tangent lines, rates of change, optimization, curve sketching), antiderivatives, definite integrals and area.
STYLE: Calculus stems with exactly one correct answer under standard rules. Keep algebra light so the calculus is what is being tested.
ROTATION RULE: Rotate limits → derivative rules → derivative applications → integration → area between curves. NEVER two derivative computations in a row.`),
  };


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
    const genericMath = `You are a math tutor for Irvine High School covering algebra, geometry, precalculus, and calculus.

ROTATION RULE: Rotate between algebra, geometry, precalculus, and calculus. Each question must be a different subtopic. Use different numbers, equations, and problem types every time. NEVER reuse the same equation or problem structure.`;
    system = `${MATH_DECKS[mathLevel] || genericMath}\n\nSCOPE: every question in this quiz is a math question. Never ask science, English, or history questions, even as a "change of pace".\n\n${quizFormat}`;
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
DEPTH FLOOR: never a definition question ("what is a metaphor?", "what is a thesis?"). Every question must give a passage, a sentence, or a student draft and ask what a specific choice accomplishes, what the line of reasoning requires, or which revision best serves the argument — AP Language multiple-choice and essay-revision level.

ROTATION RULE: Cycle rhetorical analysis → argument → synthesis → multiple choice skills. NEVER ask two questions from the same skill in a row.

${quizFormat}`;
  } else if (lowerNoSpace.includes('apbio') || lower.includes('ap biology') || lower.includes('ap bio')) {
    system = `You are an AP Biology tutor for an 11th grader preparing for the AP exam and a class grade repair (D currently, lever = unit tests).

COVERAGE: chemistry of life, cell structure and transport, cellular energetics (glycolysis, Krebs, oxidative phosphorylation, photosynthesis), cell communication and signal transduction, cell cycle and mitosis/meiosis, heredity and gene expression, natural selection and evolution, ecology, and experimental design with data analysis.

STYLE: AP-style questions — model-based and data-based stems, "which of the following best explains", cause-and-effect about specific molecules and organelles. Include the biology vocabulary the teacher tests (receptor, ligand, feedback, transcription, allele) rather than generic science filler.
DEPTH FLOOR: this is an AP course, so no middle-school recall ("what is the powerhouse of the cell", "which organelle makes proteins"). Every question must require reasoning over a mechanism, a data set, or an experimental result — predict the outcome of a knockout or inhibitor, interpret a graph or gel, explain a signal that fails, or identify the error in a proposed experiment.

ROTATION RULE: Cycle through the units above. NEVER ask two questions from the same unit in a row.

${quizFormat}`;
  } else if (lowerNoSpace.includes('ushist') || lower.includes('us history') || lower.includes('u.s. history')) {
    system = `You are an AP United States History tutor for an 11th grader.

COVERAGE: Period 1–9 — colonial era and Revolution, Constitution and early republic, market revolution and reform, sectional crisis, Civil War and Reconstruction, Gilded Age and industrialization, Progressivism, imperialism, WWI, the 1920s, Depression and New Deal, WWII, Cold War and civil rights, and post-1980 politics.

STYLE: AP-style questions: identify causation, continuity and change, comparison, and interpretation of historical evidence. Stems should name specific events, acts, amendments, or figures where the teacher would test them.
DEPTH FLOOR: no name-and-date trivia ("who was the first president"). Every question must ask for a cause, a consequence, a comparison across periods, or the best interpretation of a document or set of evidence — AP US History level, not a citizenship quiz.

ROTATION RULE: Move chronologically forward through the periods, then restart. NEVER ask two questions from the same era in a row.

${quizFormat}`;
  } else if (lower.includes('physics')) {
    system = `You are a physics tutor for an 11th grader in a first-year (algebra-based) physics course.

COVERAGE: kinematics (distance, displacement, speed, velocity, acceleration), Newton's laws and free-body reasoning, work, energy and power, momentum and collisions, circular motion and gravitation, waves and sound, light and optics, electric charge and circuits, magnetism, and thermodynamics.

STYLE: Mix conceptual questions with short quantitative ones — always give numbers with units and make exactly one option correct under standard formulas (v = d/t, F = ma, KE = ½mv², W = Fd, p = mv). Keep arithmetic clean enough to do without a calculator.
DEPTH FLOOR: no definition-recall stems ("which of these is a vector?", "what is the unit of force?"). Every question must require applying a relationship — a two-step calculation (find acceleration, then force), a projectile with both components, energy conservation across two states, Newton's second law with friction, Ohm's law through two resistors, or a wave's frequency/wavelength — the level of an 11th grade college-prep physics course and its unit tests.

ROTATION RULE: Cycle the topics above. NEVER ask two kinematics or two calculation questions in a row.

${quizFormat}`;
  } else if (lowerNoSpace.includes('rescue') || lower.includes('grade rescue')) {
    system = `You are a grade-repair tutor for an 11th grader whose two weakest marks are AP Biology (D; unit tests are 50% of the grade) and AP English Language (D; quizzes/projects are 30% of the grade). This deck exists to move those two levers and nothing else.

COVERAGE: AP Biology unit tests — cellular energetics (glycolysis, Krebs, oxidative phosphorylation, photosynthesis), cell communication and signal transduction, cell cycle and heredity, gene expression, evolution, ecology, and data/model-based experimental analysis. AP English Language quizzes and close reading — rhetorical analysis (SOAPStone, appeals, claims vs. evidence, line of reasoning, tone, diction, syntax) and passage-based multiple choice.

STYLE: Real test-and-quiz stems for the two courses. Biology questions are AP-style data or model prompts ("which of the following best explains ...", cause and effect about specific molecules and organelles). English questions give a one- or two-sentence passage and ask what a rhetorical choice accomplishes. Test what a unit test and a graded quiz actually reward — no trivia definitions and no generic filler.

ROTATION RULE: Strict alternation — AP Biology, then AP English Language, then AP Biology. NEVER ask two questions from the same course in a row.

${quizFormat}`;
  }

  // Authored decks bypass the model: fixed questions, keyed answers, exact score.
  // The live set comes from royceai.com/tutor/drill/<id>.json (refreshed daily);
  // the bundled copy is the offline fallback.
  const bankKey = lowerNoSpace.includes('rescue') ? 'rescue' : null;
  if (bankKey) {
    const bank = await getBank(bankKey);
    if (bank) return res.json(drillReply(bank, history, message));
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
              else if (t.includes('rescue')) subject = 'rescue';
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
