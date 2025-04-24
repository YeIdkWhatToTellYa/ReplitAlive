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
const serverList = new Map();

app.use(express.json());

app.get('/get-command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const [playerId, commandData] = commandQueue.entries().next().value || [];
  if (commandData) {
    commandQueue.delete(playerId);
    return res.json({
      status: 'success',
      command: commandData.command,
      playerId: commandData.playerId
    });
  }
  return res.json({ status: 'success', command: 'return "No pending commands"' });
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
  return res.json({ status: 'success' });
});

app.post('/data-response', express.json(), (req, res) => {
  try {
    const { playerId, data, success, error, metadata } = req.body;
    if (!playerId) return res.status(400).json({ error: 'Missing playerId' });

    const channel = pendingRequests.get(playerId);
    if (!channel) return res.status(200).json({ status: 'no pending request' });

    let message = '';
    if (playerId.startsWith('ServerList_')) {
      if (data?.result?.jobId) {
        serverList.set(data.result.jobId, data.result);
      }
      pendingRequests.delete(playerId);
      return res.json({ status: 'success' });
    }

    if (playerId.startsWith('AllServers_')) {
      message = '🌐 **Active Servers**\n```\n';
      serverList.forEach((server, id) => {
        message += `Server: ${id}\nPlayers: ${server.count}/${server.maxPlayers}\n`;
        if (server.players?.length > 0) {
          message += `Players: ${server.players.join(', ')}\n`;
        }
        message += '----------------\n';
      });
      message += '```';
    } else {
      message = `📊 **Data for ${playerId}**\n\`\`\`diff\n`;
      for (const [key, value] of Object.entries(data?.result || {})) {
        const formattedValue = Array.isArray(value) ? value.join(', ') : 
                           typeof value === 'object' ? JSON.stringify(value) : value;
        message += `${key}: ${formattedValue}\n`;
      }
      message += '```';
    }

    const embed = new EmbedBuilder()
      .setColor(success ? 0x00AE86 : 0xFF0000)
      .setDescription(success ? message : `❌ Error\n\`\`\`${error}\`\`\``)
      .setFooter({ text: `Server: ${metadata?.serverId || 'N/A'}` });

    channel.send({ embeds: [embed] });
    pendingRequests.delete(playerId);
    return res.json({ status: 'success' });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

discordClient.on('ready', () => {
  console.log(`Bot ready as ${discordClient.user.tag}`);
  setInterval(() => serverList.clear(), 60000);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  if (['!getservers', '!getserverinfo', '!getdata', '!execute', '!searchforplayer'].includes(command)) {
    if (!message.member?.permissions.has('Administrator')) {
      return message.reply({ content: '❌ You need admin permissions for this command' })
        .then(m => setTimeout(() => m.delete(), 5000));
    }
  }

  try {
    if (command === '!getservers') {
      const requestId = `AllServers_${Date.now()}`;
      pendingRequests.set(requestId, message.channel);
      serverList.clear();

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
        playerId: `ServerList_${requestId}`
      }, { headers: { 'x-api-key': CONFIG.API_PASSCODE } });

      setTimeout(() => {
        if (serverList.size === 0) {
          return message.channel.send('❌ No servers responded');
        }

        let messageContent = '🌐 **Active Servers**\n```\n';
        serverList.forEach((server, id) => {
          messageContent += `Server: ${id}\nPlayers: ${server.count}/${server.maxPlayers}\n`;
          if (server.players?.length > 0) {
            messageContent += `Players: ${server.players.join(', ')}\n`;
          }
          messageContent += '----------------\n';
        });
        messageContent += '```';

        const embed = new EmbedBuilder()
          .setColor(0x00AE86)
          .setDescription(messageContent);

        message.channel.send({ embeds: [embed] });
      }, 3000); 

      await message.reply('✅ Fetching server list...');

    } else if (command === '!getserverinfo') {
      const serverId = args[1];
      if (!serverId) return message.reply('ℹ️ Usage: `!getserverinfo <serverId>`')
        .then(m => setTimeout(() => m.delete(), 5000));

      const requestId = `ServerInfo_${serverId}_${Date.now()}`;
      pendingRequests.set(requestId, message.channel);

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

      await message.reply(`✅ Fetching info for server ${serverId}...`);

    } else if (command === '!getdata') {
      const playerId = args[1];
      if (!playerId) return message.reply('ℹ️ Usage: `!getdata <playerId>`')
        .then(m => setTimeout(() => m.delete(), 5000));

      const requestId = `Player_${playerId}_${Date.now()}`;
      pendingRequests.set(requestId, message.channel);

      await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
        command: `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("Player_${playerId}")`,
        playerId: requestId
      }, { headers: { 'x-api-key': CONFIG.API_PASSCODE } });

      await message.reply(`✅ Fetching data for player ${playerId}...`);
    }
  } catch (err) {
    console.error('Command error:', err);
    message.reply(`❌ Error: ${err.message}`).then(m => setTimeout(() => m.delete(), 10000));
  }
});

discordClient.login(CONFIG.DISCORD_TOKEN);
app.listen(CONFIG.PORT, () => console.log(`Server running on port ${CONFIG.PORT}`));
