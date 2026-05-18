// /api/lead — POST to submit a lead or flag (persisted to GitHub), GET to retrieve all leads
const https = require('https');

const OWNER = 'royceAIsolutions';
const REPO = 'royceAIsolutions.github.io';
const GH_PATH = '/contents/data/leads.json';
const FLAGS_PATH = '/contents/data/flags.json';

function gh(method, path, body) {
  return new Promise((resolve, reject) => {
    const token = process.env.GH_TOKEN;
    if (!token) return resolve({ noToken: true });
    const b = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}${path}`,
      method,
      headers: {
        'User-Agent': 'royceai-leads', 'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json',
      },
    };
    if (b) opts.headers['Content-Length'] = Buffer.byteLength(b);
    const r = https.request(opts, (resp) => {
      let c = []; resp.on('data', (d) => c.push(d));
      resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString())); } catch(e) { resolve({}); } });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { type, name, email, phone, content, user, ip, timestamp } = req.body;
    const now = new Date().toISOString();

    // Log flags to GitHub flags.json
    if (type === 'flag' || type === 'injection_attempt' || type === 'nsfw') {
      const data = await gh('GET', FLAGS_PATH);
      let flags = [];
      if (data && data.content) {
        try { flags = JSON.parse(Buffer.from(data.content, 'base64').toString()); } catch(e) {}
      }
      flags.push({
        type: type || 'flag',
        user: user || name || 'Anonymous',
        content: (content || '').substring(0, 500),
        ip: ip || '',
        timestamp: now,
      });
      await gh('PUT', FLAGS_PATH, {
        message: `Flag: ${type} from ${name || 'Anonymous'}`,
        content: Buffer.from(JSON.stringify(flags, null, 2)).toString('base64'),
        sha: data.sha || undefined,
        branch: 'main',
      });
      return res.json({ status: 'flagged', count: flags.length });
    }

    // Normal lead — save to GitHub leads.json
    const data = await gh('GET', GH_PATH);
    let leads = [];
    if (data && data.content) {
      try { leads = JSON.parse(Buffer.from(data.content, 'base64').toString()); } catch(e) {}
    }
    const safe = typeof name === 'string' ? name.substring(0, 100) : '';
    leads.push({
      name: safe,
      email: typeof email === 'string' ? email.substring(0, 200) : '',
      phone: typeof phone === 'string' ? phone.substring(0, 20) : '',
      timestamp: timestamp || now,
      ip: ip || '',
    });
    await gh('PUT', GH_PATH, {
      message: `Lead: ${safe}`,
      content: Buffer.from(JSON.stringify(leads, null, 2)).toString('base64'),
      sha: data.sha || undefined,
      branch: 'main',
    });
    return res.json({ status: 'ok', count: leads.length });
  }

  // GET — return all leads
  const data = await gh('GET', GH_PATH);
  if (data && data.content) {
    try {
      const leads = JSON.parse(Buffer.from(data.content, 'base64').toString());
      return res.json({ leads });
    } catch(e) {}
  }
  return res.json({ leads: [] });
};
