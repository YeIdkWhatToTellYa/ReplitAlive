const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const app = express();

// Configuration
const CONFIG = {
  PORT: 3000,
  API_PASSCODE: process.env.API_PASSCODE,
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL
};

// Initialize Discord bot
const discordClient = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Data storage
const pendingRequests = new Map();

// ======================
// EXPRESS ENDPOINTS
// ======================

// Add this endpoint to handle Roblox commands
app.post('/command', express.json(), (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  console.log('Received command:', req.body.command);
  res.json({ 
    status: 'received',
    timestamp: Date.now()
  });
});

// Data receiver endpoint
app.post('/data-response', express.json(), (req, res) => {
  const { playerId, data } = req.body;
  const channel = pendingRequests.get(playerId);
  
  if (channel) {
    channel.send(`📊 Data for ${playerId}:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
    pendingRequests.delete(playerId);
  }
  
  res.sendStatus(200);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'online' });
});

// ======================
// DISCORD BOT
// ======================

discordClient.on('ready', () => {
  console.log(`🤖 Bot logged in as ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!getdata')) return;

  try {
    const member = await message.guild.members.fetch(message.author.id);
    if (!member.permissions.has('ADMINISTRATOR')) {
      return message.reply('❌ You need admin permissions.').then(m => setTimeout(() => m.delete(), 5000));
    }

    const playerId = message.content.split(' ')[1]?.match(/\d+/)?.[0];
    if (!playerId) {
      return message.reply('Usage: `!getdata <playerId>`').then(m => setTimeout(() => m.delete(), 5000));
    }

    pendingRequests.set(`Player_${playerId}`, message.channel);

    await axios.post(`${CONFIG.SERVER_URL}/command`, {
      command: `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("Player_${playerId}")`
    }, {
      headers: { 'x-api-key': CONFIG.API_PASSCODE }
    });

    await message.reply(`🔍 Fetching data for Player_${playerId}...`);
  } catch (err) {
    console.error('Command error:', err);
    message.reply('⚠️ Failed to process request').then(m => setTimeout(() => m.delete(), 5000));
  }
});

// Start services
discordClient.login(CONFIG.DISCORD_TOKEN).catch(console.error);
app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`🔑 API Key: ${CONFIG.API_PASSCODE ? 'SET' : 'NOT SET'}`);
  console.log(`📡 Available endpoints:`);
  console.log(`- POST /command`);
  console.log(`- POST /data-response`);
  console.log(`- GET  /health`);
});
