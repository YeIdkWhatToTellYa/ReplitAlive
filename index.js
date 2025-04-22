const express = require('express');
const app = express();
const PORT = 3000;

const CONFIG = {
  API_PASSCODE: process.env.API_PASSCODE',
  SERVER_URL: process.env.ROBLOX_SERVER_URL'
};

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-api-key, Content-Type');
  next();
});

app.get('/get-command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    console.warn('Invalid API key attempt');
    return res.status(403).json({ error: 'Invalid API key' });
  }

  res.json({ 
    command: null,
    timestamp: Date.now() 
  });
});

app.post('/data-response', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const { playerId, data, serverId } = req.body;
  
  if (!playerId || !serverId) {
    return res.status(400).json({ error: 'Missing playerId or serverId' });
  }

  console.log(`📥 Received data for ${playerId} from server ${serverId}`);
  
  res.json({ status: 'success' });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'online',
    version: '1.0',
    timestamp: Date.now() 
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running at ${CONFIG.SERVER_URL}`);
  console.log(`🔑 API Key: ${CONFIG.API_PASSCODE ? 'SET' : 'NOT SET'}`);
  console.log(`📡 Endpoints:`);
  console.log(`- GET  /health`);
  console.log(`- GET  /get-command`);
  console.log(`- POST /data-response`);
});
