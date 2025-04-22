const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const app = express();

const PASSCODE = process.env.API_PASSCODE;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ROBLOX_SERVER_URL = process.env.ROBLOX_SERVER_URL || "https://soadbrexserver.onrender.com";

let lastCommand = null;
const serverResponses = new Map();

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

discordClient.on('ready', () => {
  console.log(`🤖 Discord bot logged in as ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!getdata')) return;
  if (!message.member?.permissions.has('Administrator')) return;

  const args = message.content.split(' ');
  if (args.length < 2) {
    return message.reply('Usage: `!getdata <playerId>`').then(msg => {
      setTimeout(() => msg.delete(), 5000);
    });
  }

  const playerId = args[1];
  
  try {
    serverResponses.delete(playerId);

    await axios.post(`${ROBLOX_SERVER_URL}/command`, {
      command: `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync(${playerId})`
    }, {
      headers: {
        'x-api-key': PASSCODE,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot/1.0'
      }
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    const allData = serverResponses.get(playerId) || new Map();
    if (allData.size === 0) {
      return message.reply('No data found across all servers');
    }

    const formattedData = {};
    allData.forEach((data, serverId) => {
      formattedData[`Server_${serverId}`] = data;
    });

    await message.reply({
      content: `Player data for ${playerId}:`,
      embeds: [{
        title: "Player Data",
        description: '```json\n' + JSON.stringify(formattedData, null, 2) + '\n```',
        color: 0x3498db,
        timestamp: new Date()
      }]
    });

  } catch (error) {
    console.error('Data fetch error:', error);
  }
});

discordClient.login(DISCORD_BOT_TOKEN).catch(console.error);

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Roblox Command Server and Discord Bot are running!');
});

app.post('/command', async (req, res) => {
  try {
    if (req.headers['x-api-key'] !== PASSCODE) {
      return res.status(403).send("Invalid passcode!");
    }

    lastCommand = {
      value: req.body.command,
      timestamp: Date.now()
    };
    
    console.log(`📩 New command: ${lastCommand.value}`);
    await logToDiscord(req, lastCommand.value);
    res.send(`✅ Command received: ${lastCommand.value}`);
    
  } catch (err) {
    console.error("Error:", err);
    res.status(500).send("Server error");
  }
});

app.get('/get-command', (req, res) => {
  const isFresh = lastCommand && (Date.now() - lastCommand.timestamp < 10000);
  res.json({ 
    command: isFresh ? lastCommand.value : "",
    isFresh: isFresh
  });
});

app.post('/data-response', express.json(), (req, res) => {
  if (req.headers['x-api-key'] !== PASSCODE) {
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

app.get('/get-player-data/:playerId', (req, res) => {
  const playerId = req.params.playerId;
  const data = serverResponses.get(playerId);
  res.json(data ? Object.fromEntries(data) : { error: 'No data available' });
});

async function logToDiscord(req, command) {
  try {
    const embed = {
      title: "📝 New Command Received",
      color: 0x00ff00,
      fields: [
        { name: "Command", value: `\`\`\`lua\n${command}\`\`\`` },
        { name: "IP", value: req.ip || "Unknown" }
      ]
    };
    await axios.post(WEBHOOK_URL, { embeds: [embed] });
  } catch (err) {
    console.error("Failed to log to Discord:", err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server ready on port ${PORT}`);
});
