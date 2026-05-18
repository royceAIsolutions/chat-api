const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { student } = req.body;
  if (!student) return res.json({ error: 'Missing student name' });

  const token = process.env.GH_TOKEN;
  if (!token) return res.json({ error: 'No GH token' });

  try {
    // Fetch users.json from GitHub
    const data = await ghGET('/repos/royceAIsolutions/royceAIsolutions.github.io/contents/tutor/users.json', token);
    const raw = Buffer.from(data.content, 'base64').toString();
    const users = JSON.parse(raw);

    // Find the student
    const lower = student.toLowerCase().trim();
    const u = users.find(x => x.id && x.id.toLowerCase() === lower);
    if (!u) {
      // Try matching by first+last
      const parts = student.split(' ');
      const match = users.find(x =>
        x.first && x.last &&
        x.first.toLowerCase() === (parts[0] || '').toLowerCase() &&
        x.last.toLowerCase() === (parts[1] || '').toLowerCase()
      );
      if (!match) return res.json({ found: false, error: 'Student not found' });
      return res.json({ found: true, data: match });
    }
    return res.json({ found: true, data: u });
  } catch (e) {
    return res.json({ error: e.message });
  }
};

function ghGET(path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: path,
      headers: {
        'User-Agent': 'royceai',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${token}`
      }
    };
    https.get(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Parse error: ' + body.substring(0, 200)));
        }
      });
    }).on('error', reject);
  });
}
