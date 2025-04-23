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
  console.log('\n[ROBLOX CLIENT REQUEST]');
  
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    console.warn('Invalid API key');
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const nextCommand = Array.from(commandQueue.values())[0];
  
  if (nextCommand) {
    commandQueue.delete(nextCommand.playerId);
    res.json({
      status: 'success',
      command: nextCommand.command,
      playerId: nextCommand.playerId,
      timestamp: Date.now()
    });
  } else {
    res.json({
      status: 'success',
      command: 'return "No pending commands"',
      timestamp: Date.now()
    });
  }
});

app.post('/discord-command', (req, res) => {
  console.log('\n[DISCORD BOT COMMAND]');
  
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    console.warn('Invalid API key');
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const { command, playerId } = req.body;
  if (!command || !playerId) {
    return res.status(400).json({ error: 'Missing command or playerId' });
  }

  console.log(`Queuing command for ${playerId}:`, command);
  commandQueue.set(playerId, { command, playerId });

  res.json({
    status: 'success',
    message: 'Command queued for Roblox client',
    playerId,
    timestamp: Date.now()
  });
});


app.post('/data-response', express.json(), (req, res) => {
  console.log('\n[DATA FROM ROBLOX] Received:', JSON.stringify(req.body, null, 2));
  
  try {
    const { playerId, data, success, error, metadata } = req.body;
    if (!playerId) return res.status(400).json({ error: 'Missing playerId' });

    const channel = pendingRequests.get(playerId);
    if (!channel) return res.status(200).json({ status: 'no pending request' });

    const formatValue = (value) => {
      if (typeof value === 'boolean') return value ? '✅ true' : '❌ false';
      if (value === null) return '∅ null';
      if (value === undefined) return 'undefined';
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value, null, 2).replace(/{|}|"/g, '').trim();
        } catch {
          return '[Complex Data]';
        }
      }
      return value;
    };

    let formattedText = '```\n';
    const displayData = data?.data || data || {};
    
    for (const [key, value] of Object.entries(displayData)) {
      const formattedValue = formatValue(value);
      formattedText += `${key.padEnd(25)}: ${formattedValue}\n`;
      
      if (formattedText.length > 1500) {
        formattedText += '```';
        channel.send(formattedText);
        formattedText = '```\n';
      }
    }

    const embed = new EmbedBuilder()
      .setColor(success === false ? 0xff0000 : 0x0099ff)
      .setTitle(`${success === false ? '❌' : '📊'} Player Data: ${playerId}`)
      .setTimestamp();

    if (metadata?.serverId) embed.addFields({ name: 'Server', value: metadata.serverId, inline: true });
    if (metadata?.placeId) embed.addFields({ name: 'Place', value: metadata.placeId.toString(), inline: true });

    if (success === false) {
      embed.setDescription(`**Command Failed**\n\`\`\`${error}\`\`\``);
    } else if (formattedText === '```\n```') {
      embed.setDescription('✅ Command executed successfully\n*(No data returned)*');
    } else {
      embed.setDescription(formattedText + '```');
    }

    channel.send({ embeds: [embed] });
    pendingRequests.delete(playerId);
    res.json({ status: 'success' });

  } catch (err) {
    console.error('Data processing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

discordClient.on('ready', () => {
  console.log(`\n🤖 Bot logged in as ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!getdata')) return;

  try {
    if (!message.member?.permissions?.has('ADMINISTRATOR')) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Access Denied')
        .setDescription('This command is restricted to administrators only.');
      return message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 5000));
    }

    const playerId = message.content.split(' ')[1]?.match(/\d+/)?.[0];
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
          .setDescription(`Failed to fetch data for ${playerKey} within ${REQUEST_TIMEOUT/1000} seconds`)
          .addFields({
            name: 'Possible Causes',
            value: '- Roblox server offline\n- Player not in game\n- Network issues',
            inline: false
          });
        message.channel.send({ embeds: [embed] });
      }
    }, REQUEST_TIMEOUT);

    const response = await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
      command: `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("${playerKey}")`,
      playerId: playerKey
    }, {
      headers: { 
        'x-api-key': CONFIG.API_PASSCODE,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 10000,
      responseType: 'json'
    });

    clearTimeout(timeout);

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('✅ Request Queued')
      .setDescription(`Waiting for Roblox client to respond with data for **${playerKey}**`)
      .addFields(
        { name: 'Status', value: 'Pending', inline: true },
        { name: 'Timeout', value: `${REQUEST_TIMEOUT/1000} seconds`, inline: true }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });

  } catch (err) {
    console.error('Command error:', err);
    
    let errorMsg = 'An error occurred while processing your request.';
    if (err.response) {
      errorMsg += `\nStatus: ${err.response.status}`;
      if (err.response.data) {
        errorMsg += `\nResponse: ${JSON.stringify(err.response.data).substring(0, 100)}`;
      }
    } else {
      errorMsg += `\nError: ${err.message}`;
    }

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('⚠️ Error')
      .setDescription(errorMsg)
      .setTimestamp();

    if (err.response) {
      embed.addFields(
        { name: 'Status Code', value: err.response.status.toString(), inline: true },
        { name: 'Response', value: `\`\`\`${JSON.stringify(err.response.data).substring(0, 100)}\`\`\``, inline: true }
      );
    }

    message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 10000));
  }
});


discordClient.login(CONFIG.DISCORD_TOKEN)
  .then(() => console.log('🤖 Bot login successful'))
  .catch(err => {
    console.error('🔴 Discord login failed:', err.message);
    process.exit(1);
  });

app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 Server running on port ${CONFIG.PORT}`);
});
