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
  console.log('\n[DATA FROM ROBLOX]');
  
  try {
    // Check for HTML error responses
    if (req.headers['content-type']?.includes('text/html')) {
      console.error('Received HTML error page instead of JSON response');
      return res.status(500).json({ 
        error: 'Internal Server Error',
        details: 'Roblox server returned an HTML error page' 
      });
    }

    console.log('Body:', req.body);
    const { playerId, data, serverId, timestamp } = req.body;
    
    if (!playerId) {
      return res.status(400).json({ error: 'Missing playerId' });
    }

    const channel = pendingRequests.get(playerId);
    if (channel) {
      // Handle error responses
      if (data && data.error) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('⚠️ Command Execution Error')
          .setDescription(`Error occurred while processing command for: \`${playerId}\``)
          .setColor(0xFF0000)
          .addFields(
            {
              name: '🔴 Error Message',
              value: `\`\`\`${data.message || 'Unknown error'}\`\`\``,
              inline: false
            },
            {
              name: '🆔 Server ID',
              value: `\`${serverId || 'Unknown'}\``,
              inline: true
            },
            {
              name: '📅 Time',
              value: timestamp ? `<t:${Math.floor(timestamp)}:R>` : 'Unknown',
              inline: true
            }
          );
        
        channel.send({ embeds: [errorEmbed] });
      } 
      // Handle HTML error pages in data
      else if (typeof data === 'string' && data.includes('<html') && data.includes('Internal Server Error')) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('⚠️ Roblox Server Error')
          .setDescription(`Roblox server returned an error for player: \`${playerId}\``)
          .setColor(0xFF0000)
          .addFields(
            {
              name: '🔴 Error Type',
              value: '```500 Internal Server Error```',
              inline: true
            },
            {
              name: '📅 Time',
              value: `<t:${Math.floor(Date.now()/1000)}:R>`,
              inline: true
            }
          )
          .setFooter({ text: 'Check the Roblox server logs for more details' });
        
        channel.send({ embeds: [errorEmbed] });
      } 
      // Success response
      else {
        const successEmbed = new EmbedBuilder()
          .setTitle('📊 Player Data Response')
          .setDescription(`Data received from Roblox client for player: \`${playerId}\``)
          .setColor(0x00AE86)
          .setTimestamp()
          .addFields(
            {
              name: '🔹 Player ID',
              value: `\`\`\`${playerId}\`\`\``,
              inline: true
            },
            {
              name: '🆔 Server ID',
              value: `\`${serverId || 'Unknown'}\``,
              inline: true
            },
            {
              name: '📅 Response Time',
              value: timestamp ? `<t:${Math.floor(timestamp)}:R>` : 'Unknown',
              inline: true
            }
          );

        if (data !== null && data !== undefined) {
          if (typeof data === 'object') {
            for (const [key, value] of Object.entries(data)) {
              // Skip undefined values
              if (value !== undefined) {
                successEmbed.addFields({
                  name: `📌 ${key}`,
                  value: `\`\`\`json\n${JSON.stringify(value, (k, v) => 
                    v === Infinity ? "Infinity" : 
                    v === -Infinity ? "-Infinity" : 
                    Number.isNaN(v) ? "NaN" : v, 2).substring(0, 1000)}\`\`\``,
                  inline: false
                });
              }
            }
          } else {
            successEmbed.addFields({
              name: '📌 Data',
              value: `\`\`\`${data}\`\`\``,
              inline: false
            });
          }
        } else {
          successEmbed.addFields({
            name: '📌 Data',
            value: '```null```',
            inline: false
          });
        }

        channel.send({ embeds: [successEmbed] });
      }
      pendingRequests.delete(playerId);
    }

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Error processing data response:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      details: error.message 
    });
  }
});

discordClient.on('ready', () => {
  console.log(`\n🤖 Bot logged in as ${discordClient.user.tag}`);
  
  discordClient.user.setPresence({
    activities: [{ name: 'Roblox Data', type: 3 }],
    status: 'online'
  });
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith('!getdata')) return;

  try {
    if (!message.member?.permissions?.has('ADMINISTRATOR')) {
      const embed = new EmbedBuilder()
        .setDescription('❌ **Error:** This command is for administrators only.')
        .setColor(0xFF0000);
      return message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 5000));
    }

    const playerId = message.content.split(' ')[1]?.match(/\d+/)?.[0];
    if (!playerId) {
      const embed = new EmbedBuilder()
        .setTitle('ℹ️ Command Usage')
        .setDescription('```!getdata <playerId>```')
        .setColor(0x3498DB)
        .addFields({
          name: 'Example',
          value: '```!getdata 123456789```',
          inline: true
        });
      return message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 5000));
    }

    const playerKey = `Player_${playerId}`;
    pendingRequests.set(playerKey, message.channel);

    const timeout = setTimeout(() => {
      if (pendingRequests.has(playerKey)) {
        pendingRequests.delete(playerKey);
        const embed = new EmbedBuilder()
          .setDescription(`⌛ **Timeout:** No response received for \`${playerKey}\` after ${REQUEST_TIMEOUT/1000} seconds`)
          .setColor(0xFFA500);
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
      responseType: 'json',
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });

    clearTimeout(timeout);

    if (typeof response.data === 'string' && response.data.includes('<html')) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️ Roblox Server Error')
        .setDescription('The Roblox server returned an HTML error page')
        .setColor(0xFF0000)
        .addFields(
          {
            name: '🔴 Status Code',
            value: `\`${response.status}\``,
            inline: true
          },
          {
            name: '📄 Response Type',
            value: '```HTML Error Page```',
            inline: true
          }
        )
        .setFooter({ text: 'This usually indicates a server-side configuration issue' });
      
      return message.reply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setDescription(`✅ **Request Queued:** Data request for \`${playerKey}\` has been sent to Roblox client.`)
      .setColor(0x2ECC71)
      .addFields({
        name: '⏳ Status',
        value: 'Waiting for response...',
        inline: true
      }, {
        name: '🕒 Timeout',
        value: `${REQUEST_TIMEOUT/1000} seconds`,
        inline: true
      });

    await message.reply({ embeds: [embed] });

  } catch (err) {
    console.error('Command error:', err);
    
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Command Error')
      .setColor(0xFF0000);

    if (err.response) {
      if (typeof err.response.data === 'string' && err.response.data.includes('<html')) {
        embed.setDescription('**Roblox Server Error** - Received HTML error page');
        embed.addFields({
          name: '🔴 Status Code',
          value: `\`${err.response.status}\``,
          inline: true
        }, {
          name: '📄 Content Type',
          value: '```text/html```',
          inline: true
        });
      } else {
        embed.setDescription(`**Status ${err.response.status}** - Request failed`);
        if (err.response.data) {
          embed.addFields({
            name: 'Response',
            value: `\`\`\`json\n${JSON.stringify(err.response.data).substring(0, 1000)}\n\`\`\``
          });
        }
      }
    } else if (err.request) {
      embed.setDescription('**Network Error** - No response received from server');
      embed.addFields({
        name: 'Possible Causes',
        value: '```1. Server is down\n2. Network issues\n3. Request timeout```'
      });
    } else {
      embed.setDescription(`**Error:** ${err.message}`);
    }

    message.reply({ embeds: [embed] }).then(m => setTimeout(() => m.delete(), 10000));
  }
});

discordClient.login(CONFIG.DISCORD_TOKEN)
  .then(() => console.log('🤖 Bot login successful'))
  .catch(err => {
    console.error('🔴 Discord login failed:', err.message);
    console.log('\nℹ️ Required intents in Discord Developer Portal:');
    console.log('- Message Content Intent (ENABLED)');
    console.log('- Server Members Intent (DISABLED)');
    process.exit(1);
  });

app.listen(CONFIG.PORT, () => {
  console.log(`\n🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`🔗 Available endpoints:`);
  console.log(`- GET  ${CONFIG.SERVER_URL}/get-command (Roblox client)`);
  console.log(`- POST ${CONFIG.SERVER_URL}/discord-command (Discord bot)`);
  console.log(`- POST ${CONFIG.SERVER_URL}/data-response (Roblox client)`);
});
