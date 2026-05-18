const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { student, correct, total, subject } = req.body;
  if (!student || correct === undefined || !total) return res.json({ error: 'Missing fields' });

  const pct = Math.round(correct / total * 100);
  const today = new Date().toISOString().slice(0, 10);
  const token = process.env.GH_TOKEN;
  if (!token) return res.json({ error: 'No GitHub token' });

  const entry = { student, correct, total, percent: pct, subject: subject || 'quiz', date: today, ts: Date.now() };

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
    const existing = await gh('GET', '/contents/tutor/scores.json');
    let scores = [];
    if (existing.content) {
      scores = JSON.parse(Buffer.from(existing.content, 'base64').toString());
    }
    scores.push(entry);
    let trimmed = scores.slice(-500);
    let newContent = Buffer.from(JSON.stringify(trimmed, null, 2)).toString('base64');
    // Retry up to 3 times on SHA conflict
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await gh('PUT', '/contents/tutor/scores.json', {
          message: `Quiz: ${student} ${correct}/${total} (${pct}%)`,
          content: newContent,
          sha: existing.sha
        });
        break; // success
      } catch (e) {
        if (attempt === 2) throw e; // last attempt, let it fail
        // Re-fetch to get fresh SHA, re-append
        const refetch = await gh('GET', '/contents/tutor/scores.json');
        existing.sha = refetch.sha;
        let fresh = JSON.parse(Buffer.from(refetch.content, 'base64').toString());
        fresh.push(entry);
        trimmed = fresh.slice(-500);
        newContent = Buffer.from(JSON.stringify(trimmed, null, 2)).toString('base64');
      }
    }

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
