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
    GatewayIntentBits.MessageContent
  ]
});

const commandQueue = new Map();
const pendingRequests = new Map();
const REQUEST_TIMEOUT = 30000;

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-api-key, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    server: 'Discord-Roblox Bridge',
    endpoints: {
      getCommand: 'GET /get-command',
      dataResponse: 'POST /data-response',
      discordCommand: 'POST /discord-command'
    }
  });
});

app.get('/get-command', (req, res) => {
  console.log('\n[ROBLOX CLIENT REQUEST]');
  
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    console.warn('Invalid API key');
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const nextCommand = Array.from(commandQueue.values())[0];
  
  if (nextCommand) {
    commandQueue.delete(nextCommand.playerId);
    res.json({
      status: 'success',
      command: nextCommand.command,
      playerId: nextCommand.playerId,
      timestamp: Date.now()
    });
  } else {
    res.json({
      status: 'success',
      command: 'return "No pending commands"',
      timestamp: Date.now()
    });
  }
});

app.post('/discord-command', (req, res) => {
  console.log('\n[DISCORD BOT COMMAND]');
  
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    console.warn('Invalid API key');
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const { command, playerId } = req.body;
  if (!command || !playerId) {
    return res.status(400).json({ error: 'Missing command or playerId' });
  }

  console.log(`Queuing command for ${playerId}:`, command);
  commandQueue.set(playerId, { command, playerId });

  res.json({
    status: 'success',
    message: 'Command queued for Roblox client',
    playerId,
    timestamp: Date.now()
  });
});

app.post('/data-response', express.json(), (req, res) => {
  console.log('\n[DATA FROM ROBLOX]');
  console.log('Body:', req.body);

  const { playerId, data } = req.body;
  if (!playerId) {
    return res.status(400).json({ error: 'Missing playerId' });
  }

  const channel = pendingRequests.get(playerId);
  if (channel) {
    channel.send(`📊 ${playerId} Data:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
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
    if (!message.member?.permissions?.has('ADMINISTRATOR')) {
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

    const response = await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
      command: `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("${playerKey}")`,
      playerId: playerKey
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

    await message.reply(`✅ Request queued for ${playerKey}. Waiting for Roblox client...`);

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

discordClient.login(CONFIG.DISCORD_TOKEN)
  .then(() => console.log('🤖 Bot login successful'))
  .catch(err => {
    console.error('🔴 Discord login failed:', err.message);
    console.log('\nℹ️ Required intents in Discord Developer Portal:');
    console.log('- Message Content Intent (ENABLED)');
    console.log('- Server Members Intent (DISABLED)');
    process.exit(1);
  });

app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`🔗 Available endpoints:`);
  console.log(`- GET  ${CONFIG.SERVER_URL}/get-command (Roblox client)`);
  console.log(`- POST ${CONFIG.SERVER_URL}/discord-command (Discord bot)`);
  console.log(`- POST ${CONFIG.SERVER_URL}/data-response (Roblox client)`);
});
