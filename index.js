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
const serverList = new Map();
const REQUEST_TIMEOUT = 30000;

app.use(express.json());

app.get('/get-command', (req, res) => {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const nextCommand = Array.from(commandQueue.values())[0];
  if (nextCommand) {
    commandQueue.delete(nextCommand.playerId);
    return res.json({
      status: 'success',
      command: nextCommand.command,
      playerId: nextCommand.playerId
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

    if (playerId.startsWith('ServerList_')) {
      serverList.set(metadata.serverId, data.result);
      pendingRequests.delete(playerId);
      return res.json({ status: 'success' });
    }

    let message = '';
    if (playerId.startsWith('AllServers_')) {
      message = '🌐 **Active Servers**\n```\n';
      let totalPlayers = 0;
      
      serverList.forEach((server, id) => {
        message += `Server: ${id}\nPlayers: ${server.count}/${server.maxPlayers}\n`;
        if (server.players?.length > 0) {
          message += `Players: ${server.players.join(', ')}\n`;
        }
        message += '----------------\n';
        totalPlayers += server.count;
      });
      message += `Total Players: ${totalPlayers}\n\`\`\``;
    } else {
      message = `📊 **${playerId}'s Data**\n\`\`\`diff\n`;
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

  // Only check permissions for our commands
  const commands = ['!getservers', '!getserverinfo', '!getdata', '!execute', '!searchforplayer'];
  if (commands.includes(command)) {
    if (!message.member?.permissions.has('Administrator')) {
      return message.reply({ content: '❌ You need admin permissions for this command' })
        .then(m => setTimeout(() => m.delete(), 5000));
    }
  } else {
    return; // Ignore non-command messages
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
        playerId: `ServerList_${Date.now()}`
      }, { headers: { 'x-api-key': CONFIG.API_PASSCODE } });

      await message.reply('✅ Collecting data from all servers...');

    } else if (command === '!getserverinfo') {
      const serverId = args[1];
      if (!serverId) return message.reply('ℹ️ Usage: `!getserverinfo <serverId>`')
        .then(m => setTimeout(() => m.delete(), 5000));

      const requestId = `ServerInfo_${serverId}_${Date.now()}`;
      pendingRequests.set(requestId, message.channel);

      await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
        command: `local players = game:GetService("Players"):GetPlayers()
          local list = {}
          for _, p in ipairs(players) do table.insert(list, p.Name) end
          return {
            jobId = game.JobId,
            players = list,
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
