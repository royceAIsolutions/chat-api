module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  
  const { student } = req.body;
  const token = process.env.GH_TOKEN;
  if (!token) return res.json({ sessions: [], note: 'No GitHub token' });

  function gh(method, path) {
    return new Promise((resolve, reject) => {
      const opts = { hostname: 'api.github.com', path: `/repos/royceAIsolutions/royceAIsolutions.github.io${path}`,
        method, headers: { 'User-Agent': 'royceai', 'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json' } };
      const r = require('https').request(opts, (resp) => { let c=[]; resp.on('data',d=>c.push(d)); resp.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(c).toString()))}catch(e){resolve({})}}); });
      r.on('error', reject); r.end();
    });
  }

  try {
    const resp = await gh('GET', '/contents/tutor/scores.json');
    if (!resp.content) return res.json({ sessions: [], note: 'No scores file' });
    const scores = JSON.parse(Buffer.from(resp.content, 'base64').toString());
    
    if (!student) return res.json({ sessions: scores.slice(-50) });
    
    const studentScores = scores.filter(s => 
      s.student && s.student.toLowerCase().includes(student.toLowerCase())
    );
    
    // Format into session structure
    const sessions = studentScores.map(s => ({
      date: s.date || '—',
      time: s.ts || null,
      mode: s.subject || 'quiz',
      correct: s.correct,
      total: s.total,
      percent: s.percent || Math.round(s.correct / s.total * 100),
      topics: { [s.subject || 'general']: `${s.correct}/${s.total}` },
      passed: (s.percent || Math.round(s.correct / s.total * 100)) >= 80
    }));
    
    res.json({ sessions });
  } catch (e) {
    res.json({ sessions: [], note: 'Error loading history' });
  }
};
