require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const app = express();

const CONFIG = {
  PORT: 3000,
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
const REQUEST_TIMEOUT = 30000;
const serverList = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
    version: '2.1.0'
  });
});

app.get('/get-command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const nextCommand = Array.from(commandQueue.values())[0];
  
  if (nextCommand) {
    commandQueue.delete(nextCommand.playerId);
    res.json({
      status: 'success',
      command: nextCommand.command,
      playerId: nextCommand.playerId
    });
  } else {
    res.json({
      status: 'success',
      command: 'return "No pending commands"'
    });
  }
});

app.post('/discord-command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const { command, playerId } = req.body;
  if (!command || !playerId) {
    return res.status(400).json({ error: 'Missing command or playerId' });
  }

  commandQueue.set(playerId, { command, playerId });
  res.json({ status: 'success', playerId });
});

app.post('/data-response', express.json(), (req, res) => {
  try {
    const { playerId, data, success, error, metadata } = req.body;
    if (!playerId) return res.status(400).json({ error: 'Missing playerId' });

    const channel = pendingRequests.get(playerId);
    if (!channel) return res.status(200).json({ status: 'no pending request' });

    if (playerId.startsWith('ServerList_')) {
      serverList.set(metadata.serverId, data.result);
      pendingRequests.delete(playerId);
      return res.json({ status: 'success' });
    }

    const playerData = data?.result || {};
    let message = `📊 **${playerId}'s Data**\n\`\`\`diff\n`;

    if (playerId.startsWith('AllServers_')) {
      message = '🌐 **Active Servers**\n```\n';
      let totalPlayers = 0;
      
      serverList.forEach((server, id) => {
        message += `Server: ${id}\nPlayers: ${server.count}/${server.maxPlayers}\n`;
        if (server.players && server.players.length > 0) {
          message += `Player List: ${server.players.join(', ')}\n`;
        }
        message += '----------------\n';
        totalPlayers += server.count;
      });

      message += `\nTotal Players Across All Servers: ${totalPlayers}\n`;
      message += '```';
    } else {
      for (const [key, value] of Object.entries(playerData)) {
        let formattedValue = Array.isArray(value) ? value.join(', ') : value;
        if (typeof value === 'object') formattedValue = JSON.stringify(value);
        const changeIndicator = typeof value === 'number' ? (value > 0 ? '+' : '-') : ' ';
        message += `${changeIndicator} ${key}: ${formattedValue}\n`;
      }
      message += '```';
    }

    const embed = new EmbedBuilder()
      .setColor(success === false ? 0xFF0000 : 0x00AE86)
      .setDescription(success === false ? `❌ **Error**\n\`\`\`${error}\`\`\`` : message)
      .setFooter({ text: `Server: ${metadata?.serverId || 'N/A'}` });

    channel.send({ embeds: [embed] });
    pendingRequests.delete(playerId);
    res.json({ status: 'success' });

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

discordClient.on('ready', () => {
  console.log(`Bot logged in as ${discordClient.user.tag}`);
  setInterval(() => serverList.clear(), 60000);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.member?.permissions?.has('ADMINISTRATOR')) return;

  try {
    const args = message.content.split(' ');
    const command = args[0].toLowerCase();

    if (command === '!getservers') {
      const requestId = `AllServers_${Date.now()}`;
      pendingRequests.set(requestId, message.channel);
      serverList.clear();

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🌐 Fetching Server List')
        .setDescription('Collecting data from all servers...');

      await message.reply({ embeds: [embed] });

      const response = await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
        command: `local players = game:GetService("Players"):GetPlayers()
          local playerNames = {}
          for _, player in ipairs(players) do
            table.insert(playerNames, player.Name)
          end
          return {
            jobId = game.JobId,
            players = playerNames,
            count = #players,
            maxPlayers = game.Players.MaxPlayers
          }`,
        playerId: `ServerList_${game.JobId}`
      }, {
        headers: { 
          'x-api-key': CONFIG.API_PASSCODE,
          'Content-Type': 'application/json'
        }
      });

    } else if (command === '!getserverinfo') {
      const serverId = args[1];
      if (!serverId) {
        const embed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle('ℹ️ Usage')
          .setDescription('`!getserverinfo <serverJobId>`');
        return message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 5000));
      }

      const requestId = `ServerInfo_${serverId}_${Date.now()}`;
      pendingRequests.set(requestId, message.channel);

      const response = await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
        command: `local players = game:GetService("Players"):GetPlayers()
          local playerList = {}
          for _, player in ipairs(players) do
            table.insert(playerList, player.Name)
          end
          return {
            jobId = game.JobId,
            players = playerList,
            count = #players,
            maxPlayers = game.Players.MaxPlayers
          }`,
        playerId: requestId
      }, {
        headers: { 
          'x-api-key': CONFIG.API_PASSCODE,
          'Content-Type': 'application/json'
        }
      });

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Server Info Requested')
        .setDescription(`Fetching info for server ${serverId}...`);

      await message.reply({ embeds: [embed] });
    }

  } catch (err) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('⚠️ Error')
      .setDescription(err.message);

    message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 10000));
  }
});

discordClient.login(CONFIG.DISCORD_TOKEN);
app.listen(CONFIG.PORT);
