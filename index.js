require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const app = express();

const CONFIG = {
  PORT: process.env.PORT || 3000,
  API_PASSCODE: process.env.API_PASSCODE,
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL || 'https://replitalive.onrender.com',
  REQUEST_TIMEOUT: 30000,
  MAX_QUEUE_SIZE: 100
};

const commandQueue = new Map();
const pendingRequests = new Map();
const serverResponses = new Map();

function log(level, message, data) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}][${level}] ${message}`, data || '');
}

// ✅ MISSING FUNCTION ADDED
function requireAuth(req, res, next) {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  next();
}

// Middleware
app.use(express.json({ limit: '10mb' }));

// Routes
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    server: 'Discord-Roblox Bridge v2.3',
    queueSize: commandQueue.size,
    pendingRequests: pendingRequests.size
  });
});

app.get('/get-command', requireAuth, (req, res) => {
  const nextCommand = Array.from(commandQueue.values())[0];
  
  if (nextCommand) {
    log('INFO', 'Command delivered', { 
      playerId: nextCommand.playerId,
      targetJobId: nextCommand.targetJobId 
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
  
  commandQueue.set(playerId, { 
    command, 
    playerId, 
    targetJobId: targetJobId || '*',
    queuedAt: Date.now()
  });
  
  log('INFO', 'Command queued', { playerId, targetJobId: targetJobId || '*' });
  res.json({ status: 'success', queued: true });
});

app.post('/data-response', requireAuth, (req, res) => {  // ✅ Now works!
  const { playerId, success, data, error, metadata } = req.body;
  const request = pendingRequests.get(playerId);
  
  if (!request) return res.json({ status: 'ok' });

  // Server list aggregation
  if (playerId.startsWith('ServerList_')) {
    if (!serverResponses.has(playerId)) serverResponses.set(playerId, []);
    
    serverResponses.get(playerId).push({
      jobId: metadata?.serverId,
      players: data?.result?.players || [],
      count: data?.result?.count || 0
    });

    // 10s timeout
    clearTimeout(request.timeoutId);
    request.timeoutId = setTimeout(() => {
      const servers = serverResponses.get(playerId) || [];
      serverResponses.delete(playerId);
      
      const uniqueServers = servers.filter((s, i, arr) => 
        arr.findIndex(t => t.jobId === s.jobId) === i
      );
      
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🌐 Active Servers')
        .setDescription(`${uniqueServers.length} servers found in 10s`);
      
      uniqueServers.slice(0, 10).forEach((server, i) => {  // Limit to 10
        embed.addFields({
          name: `Server ${i+1}`,
          value: `\`${server.jobId?.slice(0,20)}...\` (${server.count} players)`,
          inline: true
        });
      });
      
      request.channel.send({ embeds: [embed] });
      pendingRequests.delete(playerId);
    }, 10000);
    
    return res.json({ status: 'ok' });
  }

  // Execute response
  if (playerId.startsWith('Execute_')) {
    const embed = new EmbedBuilder()
      .setColor(success ? 0x00ff00 : 0xff0000)
      .setTitle(success ? '✅ Success' : '❌ Error')
      .setDescription(success 
        ? `\`\`\`lua\n${String(data?.result || 'OK')}\n\`\`\``
        : `\`\`\`lua\n${error}\n\`\`\``)
      .setFooter({ text: `Server: ${metadata?.serverId?.slice(0,20)}` });
    
    request.channel.send({ embeds: [embed] });
    pendingRequests.delete(playerId);
    return res.json({ status: 'ok' });
  }

  res.json({ status: 'ok' });
});

// Discord Bot
const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

async function queueCommand(channel, luaCode, playerId, targetJobId = '*') {
  pendingRequests.set(playerId, { channel, createdAt: Date.now() });
  
  try {
    const response = await fetch(`${CONFIG.SERVER_URL}/discord-command`, {
      method: 'POST',
      headers: { 
        'x-api-key': CONFIG.API_PASSCODE, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ command: luaCode, playerId, targetJobId })
    });
    return response.ok;
  } catch (e) {
    log('ERROR', 'Queue command failed', { error: e.message });
    return false;
  }
}

discordClient.on('messageCreate', async message => {
  if (message.author.bot || !message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
  
  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  if (command === '!getservers') {
    const requestId = `ServerList_${Date.now()}`;
    await queueCommand(message.channel, 
      `local players = game:GetService("Players"):GetPlayers()
       return {
         jobId = game.JobId,
         players = {},
         count = #players,
         maxPlayers = game.Players.MaxPlayers
       }`, 
      requestId, '*');
    message.reply('🔍 Scanning servers... (10s)');
    
  } else if (command === '!execute') {
    const targetServer = args[1];
    const luaCode = args.slice(2).join(' ');
    
    if (!targetServer || !luaCode) {
      return message.reply('`!execute * print("hello")` or `!execute [jobId] [code]`');
    }
    
    const requestId = `Execute_${Date.now()}`;
    await queueCommand(message.channel, luaCode, requestId, targetServer);
    message.reply(`✅ Queued ${targetServer === '*' ? 'all servers' : targetServer}`);
  }
});

discordClient.once('ready', () => {
  log('INFO', `Bot ready - ${discordClient.user.tag}`);
});

discordClient.login(CONFIG.DISCORD_TOKEN);

// Cleanup old requests
setInterval(() => {
  const now = Date.now();
  for (const [id] of pendingRequests) {
    if (now - pendingRequests.get(id).createdAt > CONFIG.REQUEST_TIMEOUT) {
      pendingRequests.delete(id);
    }
  }
}, 10000);

// Start server
app.listen(CONFIG.PORT, () => {
  log('INFO', `🚀 Bridge running on port ${CONFIG.PORT}`);
});
