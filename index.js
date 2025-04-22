const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  API_PASSCODE: process.env.API_PASSCODE || 'ForTests',
  SERVER_URL: process.env.ROBLOX_SERVER_URL || 'https://soadbrexserver.onrender.com'
};

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-api-key, Content-Type');
  next();
});

app.get('/get-command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  
  res.json({
    status: 'success',
    command: null,
    timestamp: Date.now()
  });
});

app.post('/data-response', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const { playerId, data, serverId } = req.body;
  console.log(`📥 Received data for ${playerId} from server ${serverId}`);
  
  res.json({ status: 'success' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🔑 API Key: ${CONFIG.API_PASSCODE}`);
});
