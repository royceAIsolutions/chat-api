const https = require('https');
const crypto = require('crypto');

const ADMIN_KEY = process.env.LICENSE_ADMIN_KEY || 'royceai-admin-2026';
const GH_TOKEN = process.env.GH_TOKEN || '';
const LICS_API = 'https://api.github.com/repos/royceAIsolutions/royceAIsolutions.github.io/contents/tutor/licenses.json';

function ghFetch(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'royceai', 'Authorization': 'token ' + GH_TOKEN } };
    https.get(url, opts, (resp) => {
      let d = [];
      resp.on('data', c => d.push(c));
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(d).toString());
          if (parsed.content) {
            resolve(JSON.parse(Buffer.from(parsed.content, 'base64').toString()));
          } else {
            resolve(parsed);
          }
        } catch(e) { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { action, license_key, admin_key } = req.body;
  let licenses = await ghFetch(LICS_API);

  if (action === 'validate') {
    if (!license_key) return res.json({ valid: false, reason: 'No key provided' });
    const lic = licenses.find(l => l.key === license_key);
    if (!lic) return res.json({ valid: false, reason: 'Invalid license key' });
    if (lic.status !== 'active') return res.json({ valid: false, reason: 'License ' + lic.status });
    if (lic.expires && new Date(lic.expires) < new Date()) {
      return res.json({ valid: false, reason: 'License expired on ' + new Date(lic.expires).toLocaleDateString() });
    }
    return res.json({ valid: true, expires: lic.expires, customer: lic.customer || '' });
  }

  if (action === 'generate') {
    if (admin_key !== ADMIN_KEY) return res.json({ error: 'Unauthorized' });
    const key = 'RAI-' + crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, 12);
    const newLic = {
      key, customer: req.body.customer || 'Anonymous', status: 'active',
      created: new Date().toISOString(),
      expires: req.body.duration === 'annual'
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      plan: req.body.plan || 'monthly',
    };
    licenses.push(newLic);

    // Get current file SHA
    const sha = await new Promise((resolve) => {
      https.get(LICS_API, { headers: { 'User-Agent': 'royceai', 'Authorization': 'token ' + GH_TOKEN } }, (resp) => {
        let d = []; resp.on('data', c => d.push(c));
        resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(d).toString()).sha); } catch(e) { resolve(null); } });
      }).on('error', () => resolve(null));
    });

    const body = JSON.stringify({
      message: 'Add license: ' + key,
      content: Buffer.from(JSON.stringify(licenses, null, 2)).toString('base64'),
      sha, branch: 'main'
    });
    
    const r2 = https.request(LICS_API, {
      method: 'PUT',
      headers: { 'Authorization': 'token ' + GH_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'royceai', 'Content-Length': Buffer.byteLength(body) }
    });
    r2.write(body);
    r2.end();

    return res.json({ key, expires: newLic.expires });
  }

  res.json({ error: 'Unknown action' });
};
