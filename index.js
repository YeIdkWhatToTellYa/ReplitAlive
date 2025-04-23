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

  const { playerId, data, serverId } = req.body;
  if (!playerId) {
    return res.status(400).json({ error: 'Missing playerId' });
  }

  const channel = pendingRequests.get(playerId);
  if (channel) {
    try {
      const embed = {
        color: 0x5865F2,
        title: `📊 Player Data: ${playerId}`,
        description: 'Retrieved from Roblox DataStore',
        fields: [],
        timestamp: new Date().toISOString(),
        footer: {
          text: serverId ? `Server ID: ${serverId}` : 'DataStore Service'
        }
      };

      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [key, value] of Object.entries(data)) {
          embed.fields.push({
            name: key,
            value: formatValueForDiscord(value),
            inline: shouldInline(key, value)
          });
        }
        
        if (embed.fields.length === 0) {
          embed.fields.push({
            name: 'Notice',
            value: 'DataStore exists but is empty',
            inline: false
          });
        }
      } else {
        embed.fields.push({
          name: 'Data',
          value: formatValueForDiscord(data),
          inline: false
        });
      }

      channel.send({ embeds: [embed] })
        .then(() => console.log(`Sent embed for ${playerId}`))
        .catch(err => {
          console.error('Failed to send embed:', err);
          channel.send(`📊 ${playerId} Data:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``)
            .catch(console.error);
        });

    } catch (err) {
      console.error('Error creating embed:', err);
      channel.send(`📊 ${playerId} Data:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``)
        .catch(console.error);
    }

    pendingRequests.delete(playerId);
  }

  res.json({ status: 'success' });
});

function formatValueForDiscord(value) {
  if (value === null || value === undefined) {
    return '`nil`';
  }
  
  if (typeof value === 'object') {
    return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
  }
  
  if (typeof value === 'string') {
    return value.length > 1000 
      ? '```' + value.substring(0, 1000) + '...```' 
      : '`' + value + '`';
  }
  
  return '`' + String(value) + '`';
}

function shouldInline(key, value) {
  if (typeof value === 'object' || String(value).length > 25) {
    return false;
  }
  
  const noInlineFields = ['id', 'userId', 'playerId', 'data'];
  return !noInlineFields.includes(key.toLowerCase());
}
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
