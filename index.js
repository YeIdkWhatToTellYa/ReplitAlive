const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const app = express();

const CONFIG = {
  PORT: 3000,
  API_PASSCODE: process.env.API_PASSCODE,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL
};

const discordClient = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const pendingRequests = new Map();

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
  }
});

app.use(express.json());

app.post('/data-response', (req, res) => {
  const { playerId, data } = req.body;
  const channel = pendingRequests.get(playerId);

  if (channel) {
    channel.send(`📊 Data for ${playerId}:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
    pendingRequests.delete(playerId);
  }

  res.sendStatus(200);
});

discordClient.login(CONFIG.DISCORD_TOKEN).catch(console.error);
app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`🔑 API Key: ${CONFIG.API_PASSCODE ? 'SET' : 'NOT SET'}`);
});
