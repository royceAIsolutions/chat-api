const https = require('https');

// ── DATA INTEGRITY GUARD (Oct 1 2026) ────────────────────────────────────────
// Monitoring probes (SpeedCheck Probe / AutoFixer Test / HealthCheck Test /
// QuizVerify Test / Test User) wrote REAL entries into production scores.json
// ~48x/day. At the 500-entry cap they evicted every real student's history and
// the dashboard read "No quiz history found" for everyone.
// Rule: test identities never persist, and only accounts in users.json may write.
const TEST_ID_RE = /(speedcheck|autofixer|healthcheck|quizverify|^demo( student)?$|^anonymous$|^\s*test\s*$|^\s*test user\s*$|^\s*student\s*$)/i;
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { student, correct, total, subject, dryRun, src, run } = req.body;
  // ── PROBE SANDBOX (Oct 1 2026) ─────────────────────────────────────────────
  // Monitors must be able to measure real write latency without touching student
  // data. dryRun=true runs the identical GET+PUT round-trip against a throwaway
  // ledger (tutor/scores-probe.json) and skips users.json entirely.
  const SCORES_PATH = dryRun ? '/contents/tutor/scores-probe.json' : '/contents/tutor/scores.json';
  if (!student || correct === undefined || !total) return res.json({ error: 'Missing fields' });

  const pct = Math.round(correct / total * 100);
  const today = new Date().toISOString().slice(0, 10);

  // Abandoned-quiz guard + identity guard apply to REAL writes only.
  // These run before the token check so junk identities are rejected even when
  // credentials are misconfigured (and so the guard is testable without a token).
  if (!dryRun) {
    if (!total || total < 3) {
      return res.json({ saved: false, rejected: 'tiny/zero score - probe or abandoned quiz' });
    }
    if (isTestIdentity(student)) {
      return res.json({ saved: false, rejected: 'test identity - probes must never write production scores' });
    }
  }

  const token = process.env.GH_TOKEN;
  if (!token) return res.json({ error: 'No GitHub token' });

  // ── IDEMPOTENCY (Nov 4 2026) ───────────────────────────────────────────────
  // Off-channel drills (Discord, backfills) retry on flaky networks and a cron
  // reconciler re-pushes anything it thinks is missing. Without a stable key a
  // retry doubles the entry and skews MTD/YTD. `run` is that key: same
  // student+run never appends twice, and `src` records which client wrote it.
  const runId = run ? String(run).trim().slice(0, 64) : null;
  const srcTag = src ? String(src).trim().slice(0, 24) : 'web';
  const entry = { student, correct, total, percent: pct, subject: subject || 'quiz', date: today, ts: Date.now() };
  if (runId) entry.run = runId;
  entry.src = srcTag;
  const CAP = dryRun ? 50 : 500;

  function gh(method, path, body) {
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

  try {
    // Append to scores.json
    const existing = await gh('GET', SCORES_PATH);
    let scores = [];
    if (existing.content) {
      scores = JSON.parse(Buffer.from(existing.content, 'base64').toString());
    }
    // Idempotency: one entry per student+run, no matter how many retries land.
    const seen = () => scores.some(s => s && s.run && s.run === runId && String(s.student) === String(student));
    if (runId && seen()) {
      return res.json({ saved: false, deduped: true, run: runId, student, correct, total, percent: pct });
    }
    scores.push(entry);
    let trimmed = dryRun ? scores.slice(-CAP) : trimScores(scores);
    let newContent = Buffer.from(JSON.stringify(trimmed, null, 2)).toString('base64');
    // Retry up to 3 times on SHA conflict
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await gh('PUT', SCORES_PATH, {
          message: `Quiz: ${student} ${correct}/${total} (${pct}%)`,
          content: newContent,
          sha: existing.sha
        });
        break; // success
      } catch (e) {
        if (attempt === 2) throw e; // last attempt, let it fail
        // Re-fetch to get fresh SHA, re-append
        const refetch = await gh('GET', SCORES_PATH);
        existing.sha = refetch.sha;
        let fresh = JSON.parse(Buffer.from(refetch.content, 'base64').toString());
        // A concurrent retry of the same run may have already landed.
        if (runId && fresh.some(s => s && s.run === runId && String(s.student) === String(student))) {
          return res.json({ saved: false, deduped: true, run: runId, student, correct, total, percent: pct });
        }
        fresh.push(entry);
        trimmed = dryRun ? fresh.slice(-CAP) : trimScores(fresh);
        newContent = Buffer.from(JSON.stringify(trimmed, null, 2)).toString('base64');
      }
    }

    if (dryRun) return res.json({ probe: true, wrote: SCORES_PATH, student, correct, total });

    // Also update users.json with fresh stats so dashboard auto-updates
    const usersResp = await gh('GET', '/contents/tutor/users.json');
    if (usersResp.content) {
      let users = JSON.parse(Buffer.from(usersResp.content, 'base64').toString());
      const idx = users.findIndex(u => u.id === student.toLowerCase().replace(/\s+/g, ' '));
      if (idx >= 0) {
        users[idx].today = `${correct}/${total} (${pct}%)`;
        // Recalculate MTD/YTD from scores
        const studentScores = trimmed.filter(s => s.student === student);
        // Aggregate today's scores
        const todayScores = studentScores.filter(s => s.date && s.date === today);
        if (todayScores.length) {
          const tc = todayScores.reduce((a,s) => a + s.correct, 0);
          const tt = todayScores.reduce((a,s) => a + s.total, 0);
          users[idx].today = `${tc}/${tt} (${Math.round(tc/tt*100)}%)`;
        }
        const thisMonth = today.slice(0, 7);
        const mtdScores = studentScores.filter(s => s.date && s.date.startsWith(thisMonth));
        if (mtdScores.length) {
          const mc = mtdScores.reduce((a,s) => a + s.correct, 0);
          const mt = mtdScores.reduce((a,s) => a + s.total, 0);
          users[idx].mtd = `${mc}/${mt} (${Math.round(mc/mt*100)}%)`;
        }
        const yc = studentScores.reduce((a,s) => a + s.correct, 0);
        const yt = studentScores.reduce((a,s) => a + s.total, 0);
        if (yt > 0) users[idx].ytd = `${yc}/${yt} (${Math.round(yc/yt*100)}%)`;
        
        let newUsersContent = Buffer.from(JSON.stringify(users, null, 2)).toString('base64');
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await gh('PUT', '/contents/tutor/users.json', {
              message: `Update ${student} score: ${correct}/${total}`,
              content: newUsersContent,
              sha: usersResp.sha
            });
            break;
          } catch (e) {
            if (attempt === 2) throw e;
            const refetch = await gh('GET', '/contents/tutor/users.json');
            usersResp.sha = refetch.sha;
            // Recompute stats on fresh data
            users = JSON.parse(Buffer.from(refetch.content, 'base64').toString());
            const idx2 = users.findIndex(u => u.id === student.toLowerCase().replace(/\s+/g, ' '));
            if (idx2 >= 0) {
              const studentScores2 = trimmed.filter(s => s.student === student);
              const todayScores2 = studentScores2.filter(s => s.date && s.date === today);
              if (todayScores2.length) {
                const tc2 = todayScores2.reduce((a,s) => a + s.correct, 0);
                const tt2 = todayScores2.reduce((a,s) => a + s.total, 0);
                users[idx2].today = `${tc2}/${tt2} (${Math.round(tc2/tt2*100)}%)`;
              }
              const thisMonth2 = today.slice(0, 7);
              const mtdScores2 = studentScores2.filter(s => s.date && s.date.startsWith(thisMonth2));
              if (mtdScores2.length) {
                const mc2 = mtdScores2.reduce((a,s) => a + s.correct, 0);
                const mt2 = mtdScores2.reduce((a,s) => a + s.total, 0);
                users[idx2].mtd = `${mc2}/${mt2} (${Math.round(mc2/mt2*100)}%)`;
              }
              const yc2 = studentScores2.reduce((a,s) => a + s.correct, 0);
              const yt2 = studentScores2.reduce((a,s) => a + s.total, 0);
              if (yt2 > 0) users[idx2].ytd = `${yc2}/${yt2} (${Math.round(yc2/yt2*100)}%)`;
              newUsersContent = Buffer.from(JSON.stringify(users, null, 2)).toString('base64');
            }
          }
        }
      }
    }

    res.json({ saved: true, student, correct, total, percent: pct, date: today });
  } catch (e) {
    res.json({ saved: true, note: 'Score logged but sync pending', student, correct, total, percent: pct });
  }
};
