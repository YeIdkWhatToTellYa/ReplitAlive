const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const app = express();

const CONFIG = {
  PORT: process.env.PORT || 3000,
  PASSCODE: process.env.API_PASSCODE,
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL || "https://your-render-url.onrender.com",
  COMMAND_TTL: 10000
};

const commandCache = {
  lastCommand: null,
  lastUpdated: 0
};

const serverResponses = new Map();

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

discordClient.on('ready', () => {
  console.log(`🟢 Discord bot online as ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!getdata')) return;
  
  try {
    const member = await message.guild.members.fetch(message.author.id);
    if (!member.permissions.has('Administrator')) return;
  } catch {
    return;
  }

  const userId = message.content.split(' ')[1]?.match(/\d+/)?.[0];
  if (!userId) {
    return message.reply('❌ Invalid format. Use: `!getdata <userId>`')
      .then(m => setTimeout(() => m.delete(), 5000));
  }

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

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "x-api-key, Content-Type");
  next();
});

app.get('/', (req, res) => {
  res.send('🟢 Roblox + Discord Integration Online');
});

app.post('/command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.PASSCODE) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  commandCache.lastCommand = {
    value: req.body.command,
    timestamp: Date.now()
  };
  
  console.log(`📥 New command: ${commandCache.lastCommand.value}`);
  res.json({ status: "Command received" });
});

app.get('/get-command', (req, res) => {
    console.log("\n=== GET COMMAND REQUEST ===")
    console.log("Headers:", req.headers)
    
    if (req.headers['x-api-key'] !== CONFIG.PASSCODE) {
        console.log("Invalid API key")
        return res.status(403).json({ 
            status: "error",
            message: "Invalid API key" 
        })
    }
    
    const isFresh = commandCache.lastCommand && 
                   (Date.now() - commandCache.lastCommand.timestamp < CONFIG.COMMAND_TTL)
    
    const response = {
        status: "success",
        command: isFresh ? commandCache.lastCommand.value : null,
        timestamp: Date.now()
    }
    
    console.log("Sending response:", response)
    res.json(response)
})

app.post('/data-response', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.PASSCODE) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  const { playerId, data, serverId } = req.body;
  if (!playerId || !serverId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!serverResponses.has(playerId)) {
    serverResponses.set(playerId, new Map());
  }
  
  serverResponses.get(playerId).set(serverId, data);
  res.json({ status: "Data received" });
});


app.get('/debug-data', (req, res) => {
  const debugData = {};
  serverResponses.forEach((value, key) => {
    debugData[key] = Object.fromEntries(value);
  });
  res.json(debugData);
});

discordClient.login(CONFIG.DISCORD_TOKEN).catch(err => {
  console.error('Discord login error:', err);
});

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Express server running on port ${CONFIG.PORT}`);
});
