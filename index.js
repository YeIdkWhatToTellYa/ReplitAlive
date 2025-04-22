require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const app = express();

const CONFIG = {
  PORT: 3000,
  API_PASSCODE: process.env.API_PASSCODE,
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL
};

console.log('\n=== CONFIGURATION ===');
console.log('PORT:', CONFIG.PORT);
console.log('SERVER_URL:', CONFIG.SERVER_URL);
console.log('API_PASSCODE:', CONFIG.API_PASSCODE ? '***SET***' : 'NOT SET');
console.log('DISCORD_TOKEN:', CONFIG.DISCORD_TOKEN ? '***SET***' : 'NOT SET');

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const pendingRequests = new Map();
const REQUEST_TIMEOUT = 30000;

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-api-key, Content-Type');
  next();
});

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    endpoints: {
      command: 'POST /command',
      data: 'POST /data-response'
    }
  });
});

// Command endpoint (Roblox calls this)
app.get('/command', (req, res) => {
  console.log('\n[COMMAND REQUEST]');
  console.log('Headers:', req.headers);
  
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    console.warn('Invalid API key');
    return res.status(403).json({ error: 'Invalid API key' });
  }

  res.json({
    status: 'success',
    command: 'return "Hello from server"',
    timestamp: Date.now()
  });
});

app.post('/data-response', express.json(), (req, res) => {
  console.log('\n[DATA RECEIVED]');
  console.log('Body:', req.body);

  const { playerId, data, serverId } = req.body;
  if (!playerId) {
    return res.status(400).json({ error: 'Missing playerId' });
  }

  const channel = pendingRequests.get(playerId);
  if (channel) {
    channel.send(`📊 Player_${playerId} Data:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
    pendingRequests.delete(playerId);
  }

  res.json({ status: 'success' });
});

discordClient.on('ready', () => {
  console.log(`\n🤖 Bot logged in as ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!getdata')) return;

  try {
    const member = await message.guild.members.fetch(message.author.id);
    if (!member.permissions.has('ADMINISTRATOR')) {
      return message.reply('❌ Admin only').then(m => setTimeout(() => m.delete(), 5000));
    }

    const playerId = message.content.split(' ')[1]?.match(/\d+/)?.[0];
    if (!playerId) {
      return message.reply('Usage: `!getdata <playerId>`').then(m => setTimeout(() => m.delete(), 5000));
    }

    const playerKey = `Player_${playerId}`;
    pendingRequests.set(playerKey, message.channel);

    const timeout = setTimeout(() => {
      if (pendingRequests.has(playerKey)) {
        pendingRequests.delete(playerKey);
        message.channel.send(`⌛ Timeout fetching data for ${playerKey}`);
      }
    }, REQUEST_TIMEOUT);

    const response = await axios.post(`${CONFIG.SERVER_URL}/command`, {
      command: `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("${playerKey}")`
    }, {
      headers: { 
        'x-api-key': CONFIG.API_PASSCODE,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 10000,
      responseType: 'json'
    });

    clearTimeout(timeout);
    
    if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
      throw new Error('Server returned HTML error page');
    }

    await message.reply(`✅ Request sent for ${playerKey}`);

  } catch (err) {
    console.error('Command error:', err);
    
    let errorMsg = '⚠️ Error: ';
    if (err.response) {
      errorMsg += `Status ${err.response.status}`;
      if (err.response.data) {
        errorMsg += ` - ${JSON.stringify(err.response.data).substring(0, 100)}`;
      }
    } else {
      errorMsg += err.message;
    }

    message.reply(errorMsg).then(m => setTimeout(() => m.delete(), 10000));
  }
});

discordClient.login(CONFIG.DISCORD_TOKEN).catch(err => {
  console.error('🔴 Discord login failed:', err);
  process.exit(1);
});

app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`🔗 Test Endpoints:`);
  console.log(`- GET  ${CONFIG.SERVER_URL}/command`);
  console.log(`- POST ${CONFIG.SERVER_URL}/data-response`);
});
