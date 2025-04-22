const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const app = express();

const CONFIG = {
  PORT: process.env.PORT || 3000,
  API_PASSCODE: process.env.API_PASSCODE || 'ForTests',
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL || 'http://localhost:3000'
};

console.log('=== CONFIGURATION ===');
console.log('PORT:', CONFIG.PORT);
console.log('SERVER_URL:', CONFIG.SERVER_URL);
console.log('API_PASSCODE:', CONFIG.API_PASSCODE ? '***SET***' : 'NOT SET');
console.log('DISCORD_TOKEN:', CONFIG.DISCORD_TOKEN ? '***SET***' : 'NOT SET');

if (!CONFIG.DISCORD_TOKEN || CONFIG.DISCORD_TOKEN.length < 50) {
  console.error('❌ INVALID DISCORD TOKEN CONFIGURATION');
  process.exit(1);
}

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
  next();
});

app.get('/command', (req, res) => {
  try {
    if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
      console.warn('Invalid API key attempt');
      return res.status(403).json({ 
        status: 'error',
        message: 'Invalid API key' 
      });
    }

    res.json({
      status: 'success',
      command: 'return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("Player_TEST")',
      timestamp: Date.now()
    });

  } catch (err) {
    console.error('Endpoint error:', err);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

app.post('/data-response', express.json(), (req, res) => {
  try {
    const { playerId, data } = req.body;
    if (!playerId) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Missing playerId' 
      });
    }

    console.log(`📥 Received data for ${playerId}`);
    const channel = pendingRequests.get(playerId);
    
    if (channel) {
      channel.send(`📊 Data for ${playerId}:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
      pendingRequests.delete(playerId);
    }

    res.json({ 
      status: 'success',
      message: 'Data processed'
    });

  } catch (err) {
    console.error('Data response error:', err);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

discordClient.on('ready', () => {
  console.log(`\n🤖 Bot logged in as ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!getdata')) return;

  let playerId;
  try {
    const member = await message.guild.members.fetch(message.author.id);
    if (!member.permissions.has('ADMINISTRATOR')) {
      return message.reply('❌ You need admin permissions.').then(m => setTimeout(() => m.delete(), 5000));
    }

    playerId = message.content.split(' ')[1]?.match(/\d+/)?.[0];
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
      responseType: 'json' // Ensure JSON response
    });

    clearTimeout(timeout);

    if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
      throw new Error('Server returned HTML error page');
    }

    await message.reply(`✅ Successfully requested data for ${playerKey}`);

  } catch (err) {
    console.error('Command processing error:', err);
    
    let errorMessage = '⚠️ Failed to process request';
    if (err.response) {
      errorMessage += `\nStatus: ${err.response.status}`;
      if (err.response.data) {
        errorMessage += `\nResponse: ${JSON.stringify(err.response.data).substring(0, 100)}`;
      }
    } else {
      errorMessage += `\nError: ${err.message}`;
    }

    message.reply(errorMessage).then(m => setTimeout(() => m.delete(), 10000));
    if (playerId) pendingRequests.delete(`Player_${playerId}`);
  }
});

discordClient.login(CONFIG.DISCORD_TOKEN).catch(err => {
  console.error('🔴 FATAL: Discord login failed');
  console.error(err);
  process.exit(1);
});

app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`🔗 Available endpoints:`);
  console.log(`- GET  ${CONFIG.SERVER_URL}/command`);
  console.log(`- POST ${CONFIG.SERVER_URL}/data-response`);
});
