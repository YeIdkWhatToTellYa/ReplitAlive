const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const app = express();

const CONFIG = {
  PORT: process.env.PORT || 3000,
  PASSCODE: process.env.API_PASSCODE,
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL || "https://your-render-url.onrender.com"
};

const commandCache = {
  lastCommand: null,
  lastUpdated: 0,
  ttl: 10000
};

const serverResponses = new Map();

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: []
});

discordClient.on('ready', () => console.log(`🟢 Bot online: ${discordClient.user.tag}`));

discordClient.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!getdata')) return;
  
  try {
    const member = await message.guild.members.fetch(message.author.id);
    if (!member.permissions.has('Administrator')) return;
  } catch {
    return;
  }

  const userId = message.content.split(' ')[1]?.match(/\d+/)?.[0];
  if (!userId) return message.reply('❌ Invalid format. Use: `!getdata <userId>`').then(m => setTimeout(() => m.delete(), 5000));

  try {
    serverResponses.delete(`Player_${userId}`);
    
    await axios.post(`${CONFIG.SERVER_URL}/command`, {
      command: `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("Player_${userId}")`
    }, {
      headers: {
        'x-api-key': CONFIG.PASSCODE,
        'Content-Type': 'application/json'
      }
    });

    const progressMsg = await message.reply(`⏳ Fetching data for Player_${userId}...`);
    let attempts = 0;
    let responseData;

    while (attempts < 6) {
      await new Promise(r => setTimeout(r, 1500));
      attempts++;
      const currentData = serverResponses.get(`Player_${userId}`);
      if (currentData?.size > 0) {
        responseData = Object.fromEntries(currentData);
        break;
      }
    }

    await progressMsg.delete();

    if (!responseData) {
      return message.reply(`🔴 No data found for Player_${userId} across all servers`);
    }

    const embed = {
      title: `Player_${userId} Data`,
      description: '```json\n' + JSON.stringify(responseData, null, 2) + '\n```',
      color: 0x00ff00,
      footer: { text: `Fetched from ${Object.keys(responseData).length} server(s)` }
    };

    await message.reply({ embeds: [embed] });

  } catch (error) {
    console.error('Command error:', error);
  }
});

app.use(express.json());

app.get('/', (req, res) => res.send('🟢 Roblox + Discord Integration Online'));

app.post('/command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.PASSCODE) {
    return res.status(403).send('Invalid API key');
  }

  commandCache.lastCommand = {
    value: req.body.command,
    timestamp: Date.now()
  };
  
  console.log(`📥 New command: ${commandCache.lastCommand.value}`);
  res.send('✅ Command received');
});

app.get('/get-command', (req, res) => {
  const isFresh = commandCache.lastCommand && 
                 (Date.now() - commandCache.lastCommand.timestamp < commandCache.ttl);
  res.json({
    command: isFresh ? commandCache.lastCommand.value : null,
    isFresh
  });
});

app.post('/data-response', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.PASSCODE) {
    return res.status(403).send('Invalid API key');
  }

  const { playerId, data, serverId } = req.body;
  if (!playerId || !serverId) return res.status(400).send('Missing required fields');

  if (!serverResponses.has(playerId)) {
    serverResponses.set(playerId, new Map());
  }
  
  serverResponses.get(playerId).set(serverId, data);
  res.sendStatus(200);
});

discordClient.login(CONFIG.DISCORD_TOKEN).catch(console.error);

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Express server running on port ${CONFIG.PORT}`);
});
