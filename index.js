require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
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
const REQUEST_TIMEOUT = 30000;
const serverList = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

    const responseData = data?.result || {};
    let message = '';

    if (playerId.startsWith('AllServers_')) {
      message = '🌐 **Active Servers**\n```\n';
      let totalPlayers = 0;
      
      serverList.forEach((server, id) => {
        message += `Server: ${id}\nPlayers: ${server.count}/${server.maxPlayers}\n`;
        if (server.players && server.players.length > 0) {
          message += `Players: ${server.players.join(', ')}\n`;
        }
        message += '----------------\n';
        totalPlayers += server.count;
      });

      message += `\nTotal Players: ${totalPlayers}\n`;
      message += '```';
    } else {
      message = `📊 **${playerId}'s Data**\n\`\`\`diff\n`;
      for (const [key, value] of Object.entries(responseData)) {
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
    console.error('Error processing response:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

discordClient.on('ready', () => {
  console.log(`Bot logged in as ${discordClient.user.tag}`);
  setInterval(() => serverList.clear(), 60000);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;

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

      await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
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
        playerId: `ServerList_${Date.now()}`
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

      await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
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
    } else if (command === '!getdata') {
      const playerId = args[1]?.match(/\d+/)?.[0];
      if (!playerId) {
        const embed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle('ℹ️ Usage')
          .setDescription('`!getdata <playerId>`');
        return message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 5000));
      }

      const playerKey = `Player_${playerId}`;
      pendingRequests.set(playerKey, message.channel);

      const timeout = setTimeout(() => {
        if (pendingRequests.has(playerKey)) {
          pendingRequests.delete(playerKey);
          const embed = new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle('⌛ Timeout')
            .setDescription(`Failed to fetch data for ${playerKey} within ${REQUEST_TIMEOUT/1000} seconds`);
          message.channel.send({ embeds: [embed] });
        }
      }, REQUEST_TIMEOUT);

      await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
        command: `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("${playerKey}")`,
        playerId: playerKey
      }, {
        headers: { 
          'x-api-key': CONFIG.API_PASSCODE,
          'Content-Type': 'application/json'
        }
      });

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Request Queued')
        .setDescription(`Fetching data for player ${playerId}...`);

      await message.reply({ embeds: [embed] });
    }

  } catch (err) {
    console.error('Command error:', err);
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('⚠️ Error')
      .setDescription(err.message);

    message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 10000));
  }
});

discordClient.login(CONFIG.DISCORD_TOKEN).catch(console.error);
app.listen(CONFIG.PORT, () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
});
