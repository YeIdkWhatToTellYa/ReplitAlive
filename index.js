require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const app = express();

const CONFIG = {
  PORT: process.env.PORT || 3000,
  API_PASSCODE: process.env.API_PASSCODE,
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL
};

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const commandQueue = new Map();
const pendingRequests = new Map();
const serverData = new Map();
const COLLECTION_TIME = 8000;

app.use(express.json());

app.get('/get-command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) return res.status(403).end();
  const nextCommand = Array.from(commandQueue.values())[0];
  if (!nextCommand) return res.json({ command: 'return "No pending commands"' });
  commandQueue.delete(nextCommand.playerId);
  res.json({ command: nextCommand.command, playerId: nextCommand.playerId });
});

app.post('/discord-command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) return res.status(403).end();
  const { command, playerId } = req.body;
  if (!command || !playerId) return res.status(400).end();
  commandQueue.set(playerId, { command, playerId });
  res.json({ status: 'success' });
});

app.post('/data-response', (req, res) => {
  const { playerId, data, metadata } = req.body;
  if (playerId.startsWith('ServerData_')) {
    serverData.set(metadata.serverId, data.result);
  }
  res.json({ status: 'success' });
});

discordClient.on('ready', () => console.log(`Bot ready as ${discordClient.user.tag}`));

discordClient.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!getservers')) return;
  
  try {
    if (!message.member?.permissions.has('Administrator')) {
      return message.reply('❌ You need admin permissions for this command')
        .then(m => setTimeout(() => m.delete(), 5000));
    }

    const requestId = `ServerData_${Date.now()}`;
    pendingRequests.set(requestId, message.channel);
    serverData.clear();

    await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
      command: `local players = game:GetService("Players"):GetPlayers()
        local names = {}
        for _, p in ipairs(players) do table.insert(names, p.Name) end
        return {
          jobId = game.JobId,
          players = names,
          count = #players,
          maxPlayers = game.Players.MaxPlayers
        }`,
      playerId: requestId
    }, { headers: { 'x-api-key': CONFIG.API_PASSCODE } });

    const loadingMsg = await message.reply('🔄 Collecting data from all servers (this takes 8 seconds)...');

    setTimeout(async () => {
      if (serverData.size === 0) {
        return loadingMsg.edit('❌ No servers responded in time');
      }

      let messageText = '🌐 **Active Servers**\n```\n';
      let totalPlayers = 0;

      serverData.forEach((server, id) => {
        messageText += `Server: ${id}\n`;
        messageText += `Players: ${server.count}/${server.maxPlayers}\n`;
        messageText += `Names: ${server.players.join(', ')}\n`;
        messageText += '----------------\n';
        totalPlayers += server.count;
      });

      messageText += `\nTotal Players: ${totalPlayers}\n\`\`\``;

      await loadingMsg.edit(messageText);
      pendingRequests.delete(requestId);
    }, COLLECTION_TIME);

  } catch (err) {
    console.error(err);
    message.reply('❌ Error collecting server data').then(m => setTimeout(() => m.delete(), 10000));
  }
});

discordClient.login(CONFIG.DISCORD_TOKEN);
app.listen(CONFIG.PORT, () => console.log(`Server running on port ${CONFIG.PORT}`));
