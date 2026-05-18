module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    // Save lead from web form
    const lead = req.body || {};
    const fs = require('fs');
    const path = require('path');
    const dataDir = path.join('/tmp', 'leads');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    
    const fname = `lead_${Date.now()}.json`;
    fs.writeFileSync(path.join(dataDir, fname), JSON.stringify(lead, null, 2));
    
    return res.status(200).json({ success: true, message: 'Lead captured' });
  }

  // GET — return all leads
  const leads = [];
  try {
    const fs = require('fs');
    const path = require('path');
    const dataDir = path.join('/tmp', 'leads');
    if (fs.existsSync(dataDir)) {
      fs.readdirSync(dataDir).forEach(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dataDir, f)));
          leads.push(data);
        } catch(e) {}
      });
    }
  } catch(e) {}
  
  return res.status(200).json(leads);
};
