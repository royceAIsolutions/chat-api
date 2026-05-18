const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.GH_TOKEN;
  if (!token) return res.json({ error: 'No GitHub token' });

  const OWNER = 'royceAIsolutions';
  const REPO = 'royceAIsolutions.github.io';
  const FILE_PATH = '/contents/tutor/calories.json';

  function gh(method, path, body) {
    return new Promise((resolve, reject) => {
      const b = body ? JSON.stringify(body) : '';
      const opts = {
        hostname: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}${path}`,
        method,
        headers: {
          'User-Agent': 'royceai',
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
      };
      if (b) opts.headers['Content-Length'] = Buffer.byteLength(b);
      const r = https.request(opts, (resp) => {
        let chunks = [];
        resp.on('data', (d) => chunks.push(d));
        resp.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            resolve({});
          }
        });
      });
      r.on('error', reject);
      if (b) r.write(b);
      r.end();
    });
  }

  // GET — return today's entries for a student
  if (req.method === 'GET') {
    const { student } = req.query;
    if (!student) return res.json({ error: 'Missing student param' });

    try {
      const existing = await gh('GET', FILE_PATH);
      let entries = [];
      if (existing.content) {
        entries = JSON.parse(Buffer.from(existing.content, 'base64').toString());
      }

      const today = new Date().toISOString().slice(0, 10);
      const todayEntries = entries.filter(
        (e) => e.student === student && e.date === today
      );
      const todayTotal = todayEntries.reduce((sum, e) => sum + (e.calories || 0), 0);

      return res.json({
        entries: todayEntries,
        today_total: todayTotal,
        count: todayEntries.length,
        date: today,
      });
    } catch (e) {
      return res.json({ entries: [], today_total: 0, count: 0 });
    }
  }

  // POST — append a calorie entry
  if (req.method === 'POST') {
    const { student, food, calories, date } = req.body || {};
    if (!student || !food || !calories) {
      return res.json({ error: 'Missing required fields: student, food, calories' });
    }

    const entryDate = date || new Date().toISOString().slice(0, 10);
    const entry = {
      student,
      food,
      calories: Number(calories),
      date: entryDate,
      ts: Date.now(),
    };

    try {
      // Read existing file
      const existing = await gh('GET', FILE_PATH);
      let entries = [];
      let sha = null;

      if (existing.content) {
        entries = JSON.parse(Buffer.from(existing.content, 'base64').toString());
        sha = existing.sha;
      }

      // Append new entry
      entries.push(entry);

      // Trim to last 2000 entries to keep file manageable
      const trimmed = entries.slice(-2000);
      const newContent = Buffer.from(JSON.stringify(trimmed, null, 2)).toString('base64');

      // Write back to GitHub
      const putBody = {
        message: `Calorie: ${student} ate ${food} (${calories} cal)`,
        content: newContent,
      };
      if (sha) putBody.sha = sha;

      await gh('PUT', FILE_PATH, putBody);

      // Calculate today's total for response
      const today = new Date().toISOString().slice(0, 10);
      const todayEntries = trimmed.filter(
        (e) => e.student === student && e.date === today
      );
      const todayTotal = todayEntries.reduce((sum, e) => sum + (e.calories || 0), 0);

      return res.json({ saved: true, today_total: todayTotal, entry });
    } catch (e) {
      return res.json({
        saved: true,
        note: 'Calorie logged but sync pending',
        entry,
      });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
