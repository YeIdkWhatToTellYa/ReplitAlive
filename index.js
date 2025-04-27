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
    version: '2.1.0',
    endpoints: {
      getCommand: 'GET /get-command',
      dataResponse: 'POST /data-response',
      discordCommand: 'POST /discord-command'
    }
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

  res.json({
    status: 'success',
    message: 'Command queued for Roblox client',
    playerId
  });
});

app.post('/data-response', express.json(), (req, res) => {
  try {
    const { playerId, data, success, error, metadata } = req.body;
    if (!playerId) return res.status(400).json({ error: 'Missing playerId' });

    const channel = pendingRequests.get(playerId);
    if (!channel) return res.status(200).json({ status: 'no pending request' });

    const playerData = data?.result || {};

    let message = `📊 **${playerId}'s Data**\n\`\`\`diff\n`;
    for (const [key, value] of Object.entries(playerData)) {
      let formattedValue = value;
      if (Array.isArray(value)) {
        formattedValue = value.join(', ');
      } else if (typeof value === 'object' && value !== null) {
        formattedValue = JSON.stringify(value);
      }
      
      const changeIndicator = typeof value === 'number' 
        ? (value > 0 ? '+' : value < 0 ? '-' : ' ')
        : ' ';
      
      message += `${changeIndicator} ${key}: ${formattedValue}\n`;
    }
    message += '```';

    const embed = new EmbedBuilder()
      .setColor(success === false ? 0xFF0000 : 0x00AE86)
      .setDescription(success === false 
        ? `❌ **Error**\n\`\`\`${error}\`\`\`` 
        : message)
      .setFooter({ 
        text: `Server: ${metadata?.serverId || 'N/A'}`
      });

    channel.send({ embeds: [embed] });
    pendingRequests.delete(playerId);
    res.json({ status: 'success' });

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

discordClient.on('ready', () => {
  console.log(`\n🤖 Bot logged in as ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot) return;

    if (!message.member?.permissions?.has('ADMINISTRATOR')) return;

    const args = message.content.split(' ');
    const command = args[0].toLowerCase();

    if (command === '!getdata') {
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

      const response = await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
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
        .setDescription(`Waiting for data for **${playerKey}**`)
        .addFields(
          { name: 'Status', value: 'Pending', inline: true },
          { name: 'Timeout', value: `${REQUEST_TIMEOUT/1000} seconds`, inline: true }
        );

      await message.reply({ embeds: [embed] });
    } else if (command === '!getservers') {
    const requestId = `ServerList_${Date.now()}`;
    pendingRequests.set(requestId, message.channel);

    const getServersResponse = await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
        command: `local servers = {}
            for _, server in ipairs(game:GetService("GameServerManager"):GetAllServers()) do
                table.insert(servers, server.JobId)
            end
            return servers`,
        playerId: requestId
    }, {
        headers: { 
            'x-api-key': CONFIG.API_PASSCODE,
            'Content-Type': 'application/json'
        }
    });

    const getServerDetailsCommand = `local servers = {}
        for _, jobId in ipairs(${JSON.stringify(getServersResponse.data.data.result)}) do
            local server = game:GetService("GameServerManager"):GetServerByJobId(jobId)
            if server then
                local players = server:GetPlayers()
                local playerNames = {}
                for _, player in ipairs(players) do
                    table.insert(playerNames, player.Name)
                end
                table.insert(servers, {
                    jobId = jobId,
                    players = playerNames,
                    count = #players,
                    maxPlayers = server.Players.MaxPlayers,
                    placeId = server.PlaceId,
                    vipServerId = server.VIPServerId
                })
            end
        end
        return servers`;

    const detailsResponse = await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
        command: getServerDetailsCommand,
        playerId: requestId
    }, {
        headers: { 
            'x-api-key': CONFIG.API_PASSCODE,
            'Content-Type': 'application/json'
        }
    });

    const servers = detailsResponse.data.data.result;

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🌐 Active Servers')
        .setDescription(`Found ${servers.length} active servers`);

    servers.forEach(server => {
        const playerList = server.players.length > 0 
            ? server.players.join(', ')
            : 'No players';
        
        embed.addFields({
            name: `Server ${server.jobId} (${server.count}/${server.maxPlayers})`,
            value: `Players: ${playerList}`,
            inline: false
        });
    });

    await message.reply({ embeds: [embed] });
}
      
    else if (command === '!getserverinfo') {
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
    else if (command === '!execute') {
      const serverId = args[1];
      const cmd = args.slice(2).join(' ');
      
      if (!serverId || !cmd) {
        const embed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle('ℹ️ Usage')
          .setDescription('`!execute <serverJobId|*> <command>`\nUse * to execute on all servers');
        return message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 5000));
      }

      const requestId = `Execute_${Date.now()}`;
      pendingRequests.set(requestId, message.channel);

      const response = await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
        command: `local fn, err = require(game.ServerScriptService.ExternalCommands.Loadstring)([[${cmd}]])
          if not fn then return {error = err} end
          local success, result = pcall(fn)
          if not success then return {error = result} end
          return {result = result}`,
        playerId: requestId
      }, {
        headers: { 
          'x-api-key': CONFIG.API_PASSCODE,
          'Content-Type': 'application/json'
        }
      });

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Command Execution')
        .setDescription(serverId === '*' 
          ? `Executing command on all servers:\n\`${cmd}\``
          : `Executing command on server ${serverId}:\n\`${cmd}\``);

      await message.reply({ embeds: [embed] });
    }
    else if (command === '!searchforplayer') {
      const playerId = args[1]?.match(/\d+/)?.[0];
      if (!playerId) {
        const embed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle('ℹ️ Usage')
          .setDescription('`!searchforplayer <playerId>`');
        return message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 5000));
      }

      const requestId = `SearchPlayer_${playerId}_${Date.now()}`;
      pendingRequests.set(requestId, message.channel);

      const response = await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
        command: `local player = game:GetService("Players"):GetPlayerByUserId(${playerId})
          if player then
            return {
              found = true,
              serverId = game.JobId,
              playerName = player.Name,
              userId = player.UserId
            }
          else
            return {
              found = false,
              message = "Player not found in this server"
            }
          end`,
        playerId: requestId
      }, {
        headers: { 
          'x-api-key': CONFIG.API_PASSCODE,
          'Content-Type': 'application/json'
        }
      });

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Player Search')
        .setDescription(`Searching for player ${playerId}...`);

      await message.reply({ embeds: [embed] });

  }
});

discordClient.login(CONFIG.DISCORD_TOKEN);
app.listen(CONFIG.PORT);

