require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const app = express();

const CONFIG = {
  PORT: process.env.PORT || 3000,
  API_PASSCODE: process.env.API_PASSCODE,
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL || 'https://replitalive.onrender.com',
  REQUEST_TIMEOUT: 30000,
  MAX_QUEUE_SIZE: 100,
  RESPONSE_COLLECTION_DELAY: 10000, // 10s for !getservers
  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO'
};

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLogLevel = LOG_LEVELS[CONFIG.LOG_LEVEL] || LOG_LEVELS.INFO;

function log(level, message, data = null) {
  if (LOG_LEVELS[level] < currentLogLevel) return;
  
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}][${level}] ${message}`;
  
  if (level === 'ERROR') {
    console.error(logMessage, data ? JSON.stringify(data, null, 2) : '');
  } else {
    console.log(logMessage, data ? JSON.stringify(data, null, 2) : '');
  }
}

// State
const commandQueue = new Map();
const pendingRequests = new Map();
const serverResponses = new Map();
const commandHistory = [];
const MAX_HISTORY = 100;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

function requireAuth(req, res, next) {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    log('WARN', 'Unauthorized API access', { ip: req.ip, path: req.path });
    return res.status(403).json({ error: 'Invalid API key' });
  }
  next();
}

// Routes
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    version: '2.3.0',
    queueSize: commandQueue.size,
    pending: pendingRequests.size
  });
});

app.get('/get-command', requireAuth, (req, res) => {
  const nextCommand = Array.from(commandQueue.values())[0];
  
  if (nextCommand) {
    // Broadcast commands (*) stay in queue for multiple servers
    if (nextCommand.targetJobId !== '*') {
      commandQueue.delete(nextCommand.playerId);
    }
    
    log('INFO', 'Command delivered', { 
      playerId: nextCommand.playerId,
      targetJobId: nextCommand.targetJobId,
      broadcast: nextCommand.targetJobId === '*'
    });
    
    res.json({
      status: 'success',
      command: nextCommand.command,
      playerId: nextCommand.playerId,
      targetJobId: nextCommand.targetJobId
    });
  } else {
    res.json({
      status: 'success',
      command: 'return "No pending commands"'
    });
  }
});

app.post('/discord-command', requireAuth, (req, res) => {
  const { command, playerId, targetJobId } = req.body;
  
  if (!command || !playerId) {
    return res.status(400).json({ error: 'Missing command/playerId' });
  }
  
  if (commandQueue.size >= CONFIG.MAX_QUEUE_SIZE) {
    return res.status(429).json({ error: 'Queue full' });
  }
  
  commandQueue.set(playerId, {
    command,
    playerId,
    targetJobId: targetJobId || '*',
    queuedAt: Date.now()
  });
  
  log('INFO', 'Command queued', { playerId, targetJobId: targetJobId || '*' });
  res.json({ status: 'success', queued: true });
});

app.post('/data-response', requireAuth, (req, res) => {
  try {
    const { playerId, success, data, error, metadata } = req.body;
    
    if (!playerId) return res.status(400).json({ error: 'Missing playerId' });
    
    const request = pendingRequests.get(playerId);
    if (!request) return res.json({ status: 'ok' });

    log('INFO', 'Response received', { playerId, success, serverId: metadata?.serverId });

    // !getservers - 10s aggregation
    if (playerId.startsWith('ServerList_')) {
      if (!serverResponses.has(playerId)) serverResponses.set(playerId, []);
      
      serverResponses.get(playerId).push({
        jobId: metadata?.serverId || data?.result?.jobId || 'unknown',
        players: data?.result?.players || [],
        count: data?.result?.count || 0,
        maxPlayers: data?.result?.maxPlayers || 0
      });

      clearTimeout(request.collectionTimeout);
      request.collectionTimeout = setTimeout(() => {
        const servers = serverResponses.get(playerId) || [];
        serverResponses.delete(playerId);
        
        const uniqueServers = [];
        const seen = new Set();
        servers.forEach(s => {
          if (!seen.has(s.jobId)) {
            seen.add(s.jobId);
            uniqueServers.push(s);
          }
        });

        const embed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('🌐 Active Servers')
          .setDescription(`${uniqueServers.length} servers (${uniqueServers.reduce((sum, s) => sum + s.count, 0)} players)`);

        uniqueServers.slice(0, 10).forEach((server, i) => {
          embed.addFields({
            name: `Server ${i+1}`,
            value: `\`${server.jobId?.slice(0,20)}...\` (${server.count}/${server.maxPlayers || '?'})`,
            inline: true
          });
        });

        request.channel.send({ embeds: [embed] }).catch(e => log('ERROR', 'Send servers failed', e));
        pendingRequests.delete(playerId);
      }, CONFIG.RESPONSE_COLLECTION_DELAY);

      return res.json({ status: 'ok' });
    }

    // !execute results
    if (playerId.startsWith('Execute_')) {
      const resultText = success 
        ? String(data?.result || 'Success (no return)')
        : error || 'Unknown error';
      
      const embed = new EmbedBuilder()
        .setColor(success ? 0x00ff00 : 0xFF0000)
        .setTitle(success ? '✅ Executed' : '❌ Error')
        .setDescription(`\`\`\`lua\n${resultText.slice(0, 1900)}\n\`\`\``)
        .setFooter({ text: `Server: ${metadata?.serverId?.slice(0,20) || 'N/A'}` });

      request.channel.send({ embeds: [embed] }).catch(e => log('ERROR', 'Send execute result failed', e));
      pendingRequests.delete(playerId);
      return res.json({ status: 'ok' });
    }

    res.json({ status: 'ok' });
  } catch (err) {
    log('ERROR', 'Data response error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Discord Bot
const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

async function queueRobloxCommand(channel, luaCode, playerId, targetJobId = '*') {
  pendingRequests.set(playerId, { channel, createdAt: Date.now() });
  
  try {
    await axios.post(`${CONFIG.SERVER_URL}/discord-command`, {
      command: luaCode,
      playerId,
      targetJobId
    }, {
      headers: { 'x-api-key': CONFIG.API_PASSCODE, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    
    log('DEBUG', 'Command queued', { playerId, targetJobId });
  } catch (err) {
    log('ERROR', 'Queue failed', { playerId, error: err.message });
    pendingRequests.delete(playerId);
    throw err;
  }
}

discordClient.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    if (message.content.startsWith('!')) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🔒 No Permission')
        .setDescription('Admin only');
      return message.reply({ embeds: [embed] });
    }
    return;
  }

  const args = message.content.split(' ');
  const cmd = args[0].toLowerCase();

  try {
    if (cmd === '!getservers') {
      const requestId = `ServerList_${Date.now()}`;
      await queueRobloxCommand(message.channel, 
        `local players = game:GetService("Players"):GetPlayers()
        return {
          jobId = game.JobId,
          players = {},
          count = #players,
          maxPlayers = game.Players.MaxPlayers
        }`, 
        requestId, '*');
      message.reply('🔍 Scanning all servers (10s)...');

    } else if (cmd === '!execute') {
      const target = args[1];
      const code = args.slice(2).join(' ');
      
      if (!target || !code) {
        return message.reply('`!execute * print("hello")`');
      }
      
      const requestId = `Execute_${Date.now()}`;
      await queueRobloxCommand(message.channel, code, requestId, target);
      message.reply(`✅ Queued on ${target === '*' ? 'all servers' : target}`);

    } else if (cmd === '!help') {
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🤖 Commands')
        .addFields(
          { name: '!getservers', value: 'List all servers', inline: true },
          { name: '!execute * code', value: 'Run Lua code', inline: true },
          { name: '!help', value: 'This message', inline: true }
        );
      message.reply({ embeds: [embed] });
    }
  } catch (err) {
    log('ERROR', 'Discord command failed', { cmd, error: err.message });
    message.reply('❌ Command failed');
  }
});

discordClient.once('ready', () => {
  log('INFO', `Bot ready: ${discordClient.user.tag}`);
});

// Cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, req] of pendingRequests) {
    if (now - req.createdAt > CONFIG.REQUEST_TIMEOUT) {
      pendingRequests.delete(id);
    }
  }
}, 10000);

// Start
discordClient.login(CONFIG.DISCORD_TOKEN).catch(err => {
  log('ERROR', 'Discord login failed', err);
  process
