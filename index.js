const express = require('express');
const app = express();
const PORT = 3000;

console.log('\n=== ENVIRONMENT VARIABLES ===');
console.log('API_PASSCODE:', process.env.API_PASSCODE ? '***SET***' : 'NOT SET');
console.log('DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? '***SET***' : 'NOT SET');
console.log('ROBLOX_SERVER_URL:', process.env.ROBLOX_SERVER_URL || 'NOT SET');

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-api-key, Content-Type');
  next();
});

app.get('/health', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== process.env.API_PASSCODE) {
    console.warn(`❌ Invalid API Key Received: "${apiKey}"`);
    return res.status(403).json({
      status: 'error',
      message: 'Invalid API key',
      receivedKey: apiKey,
      expectedLength: process.env.API_PASSCODE?.length
    });
  }

  res.json({
    status: 'success',
    message: 'Server is healthy',
    timestamp: Date.now()
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🔑 API Key Required: ${process.env.API_PASSCODE ? 'YES' : 'NOT CONFIGURED'}`);
  console.log(`🔍 Test endpoint: http://localhost:${PORT}/health`);
});
