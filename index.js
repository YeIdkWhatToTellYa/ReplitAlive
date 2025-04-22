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
    GatewayIntentBits.MessageContent
  ]
});

const pendingRequests = new Map();
const REQUEST_TIMEOUT = 30000;

app.use(express.json());
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  next();
});

app.post('/command', express.json(), (req, res) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== CONFIG.API_PASSCODE) {
    console.warn('Invalid API key:', apiKey);
    return res.status(403).json({ error: 'Invalid API key' });
  }

  console.log('✅ Valid command received:', req.body.command);
  res.json({ 
    status: 'received',
    command: req.body.command, 
    timestamp: Date.now()
  });
});

app.post('/data-response', express.json(), (req, res) => {
  const { playerId, data, serverId } = req.body;
  console.log(`📥 Data received for ${playerId} from server ${serverId}`);

  const channel = pendingRequests.get(playerId);
  if (channel) {
    channel.send(`📊 Data for ${playerId}:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
    pendingRequests.delete(playerId);
  } else {
    console.warn('No pending request for:', playerId);
  }
  
  res.json({ status: 'processed' });
});


discordClient.on('ready', () => {
  console.log(`\n🤖 Bot logged in as ${discordClient.user.tag}`);
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

    const playerKey = `Player_${playerId}`;
    pendingRequests.set(playerKey, message.channel);

    setTimeout(() => {
      if (pendingRequests.has(playerKey)) {
        pendingRequests.delete(playerKey);
        message.channel.send(`⌛ Timeout fetching data for ${playerKey}`);
      }
    }, REQUEST_TIMEOUT);

    console.log(`Sending command for ${playerKey}`);
    const response = await axios.post(`${CONFIG.SERVER_URL}/command`, {
      command: `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("${playerKey}")`
    }, {
      headers: { 
        'x-api-key': CONFIG.API_PASSCODE,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    console.log('Command response:', response.data);
    await message.reply(`🔍 Fetching data for ${playerKey}...`);

  } catch (err) {
    console.error('Command error:', err.response?.data || err.message);
    message.reply('⚠️ Failed to process request. Check server logs.').then(m => setTimeout(() => m.delete(), 5000));
  }
});

discordClient.login(CONFIG.DISCORD_TOKEN).catch(err => {
  console.error('Discord login failed:', err);
  process.exit(1);
});

app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`🔗 Test endpoints:`);
  console.log(`- POST ${CONFIG.SERVER_URL}/command`);
  console.log(`- POST ${CONFIG.SERVER_URL}/data-response`);
});
