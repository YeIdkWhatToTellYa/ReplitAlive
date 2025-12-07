// index.js
require('dotenv').config();
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField
} = require('discord.js');
const axios = require('axios');

const app = express();

// ================== CONFIG ==================
const CONFIG = {
  PORT: Number(process.env.PORT) || 3000,
  API_PASSCODE: process.env.API_PASSCODE,
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
  SERVER_URL: process.env.ROBLOX_SERVER_URL,
  REQUEST_TIMEOUT: 30000,
  MAX_QUEUE_SIZE: 100,
  RESPONSE_COLLECTION_DELAY: 10000,
  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO'
};

// ================== LOGGING ==================
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLogLevel = LOG_LEVELS[CONFIG.LOG_LEVEL] ?? LOG_LEVELS.INFO;

function log(level, message, data) {
  if ((LOG_LEVELS[level] ?? 99) < currentLogLevel) return;

  const ts = new Date().toISOString();
  const base = `[${ts}][${level}] ${message}`;
  const extra = data ? ` ${JSON.stringify(data, null, 2)}` : '';

  if (level === 'ERROR') console.error(base + extra);
  else if (level === 'WARN') console.warn(base + extra);
  else console.log(base + extra);
}

// ================== CONFIG VALIDATION ==================
function validateConfig() {
  const errors = [];
  if (!CONFIG.API_PASSCODE) errors.push('API_PASSCODE not set');
  if (!CONFIG.DISCORD_TOKEN) errors.push('DISCORD_BOT_TOKEN not set');
  if (!CONFIG.SERVER_URL) errors.push('ROBLOX_SERVER_URL not set');

  if (errors.length) {
    log('ERROR', 'Configuration validation failed', { errors });
    process.exit(1);
  }
}
validateConfig();

log('INFO', '=== CONFIGURATION ===');
log('INFO', `PORT: ${CONFIG.PORT}`);
log('INFO', `SERVER_URL: ${CONFIG.SERVER_URL}`);
log('INFO', `API_PASSCODE: ${CONFIG.API_PASSCODE ? '***SET***' : 'NOT SET'}`);
log('INFO', `DISCORD_TOKEN: ${CONFIG.DISCORD_TOKEN ? '***SET***' : 'NOT SET'}`);
log('INFO', `LOG_LEVEL: ${CONFIG.LOG_LEVEL}`);

// ================== DISCORD CLIENT ==================
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================== STATE ==================
const commandQueue = new Map();           // key: playerId
const pendingRequests = new Map();        // key: playerId -> { channel, createdAt, targetJobId, collectionTimeout? }
const serverResponses = new Map();        // for ServerList_*
const commandHistory = [];
const MAX_HISTORY = 100;

// ================== EXPRESS MIDDLEWARE ==================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-api-key, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');

  if (req.method === 'OPTIONS') return res.sendStatus(200);

  log('DEBUG', `${req.method} ${req.path}`, {
    ip: req.ip,
    headers: req.headers
  });

  next();
});

// ================== AUTH MIDDLEWARE ==================
function requireAuth(req, res, next) {
  if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
    log('WARN', 'Unauthorized API access attempt', {
      ip: req.ip,
      path: req.path
    });
    return res.status(403).json({ error: 'Invalid API key' });
  }
  next();
}

// ================== HELPERS ==================
function addToHistory(entry) {
  commandHistory.unshift({
    ...entry,
    timestamp: new Date().toISOString()
  });
  if (commandHistory.length > MAX_HISTORY) commandHistory.pop();
}

function cleanupExpiredRequests() {
  const now = Date.now();
  const timeout = CONFIG.REQUEST_TIMEOUT;

  for (const [id, reqInfo] of pendingRequests.entries()) {
    if (now - reqInfo.createdAt > timeout) {
      log('WARN', 'Request timed out', { requestId: id });

      if (reqInfo.channel) {
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('⏱️ Request Timeout')
          .setDescription(
            `Request **${id}** timed out after ${Math.floor(timeout / 1000)} seconds`
          )
          .setFooter({
            text: 'The Roblox server may be offline or unresponsive'
          });

          reqInfo.channel.send({ embeds: [embed] }).catch(err =>
            log('ERROR', 'Failed to send timeout message', { error: err.message })
          );
      }

      pendingRequests.delete(id);
    }
  }
}
setInterval(cleanupExpiredRequests, 10000);

// ================== ROUTES ==================
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    server: 'Discord-Roblox Bridge',
    version: '2.2.0',
    uptime: process.uptime(),
    stats: {
      queueSize: commandQueue.size,
      pendingRequests: pendingRequests.size,
      commandsProcessed: commandHistory.length
    },
    endpoints: {
      health: 'GET /health',
      getCommand: 'GET /get-command',
      dataResponse: 'POST /data-response',
      discordCommand: 'POST /discord-command',
      clearQueue: 'DELETE /clear-queue'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    discord: {
      connected: discordClient.isReady(),
      guilds: discordClient.guilds.cache.size
    },
    stats: {
      queueSize: commandQueue.size,
      pendingRequests: pendingRequests.size,
      recentCommands: commandHistory.slice(0, 10)
    }
  });
});

// Roblox polls this
app.get('/get-command', requireAuth, (req, res) => {
  const nextCommand = Array.from(commandQueue.values())[0];

  if (!nextCommand) {
    return res.json({
      status: 'success',
      command: 'return "No pending commands"'
    });
  }

  const isBroadcast = nextCommand.targetJobId === '*';
  const serverJobId = (req.query.serverJobId || 'unknown').toString();

  if (isBroadcast) {
    if (!nextCommand.receivedBy) {
      nextCommand.receivedBy = new Set();
    }

    if (nextCommand.receivedBy.has(serverJobId)) {
      return res.json({
        status: 'success',
        command: 'return "Command already processed by this server"'
      });
    }

    nextCommand.receivedBy.add(serverJobId);

    log('INFO', 'Broadcast delivered to server', {
      playerId: nextCommand.playerId,
      serverJobId,
      totalServers: nextCommand.receivedBy.size
    });
  } else {
    commandQueue.delete(nextCommand.playerId);
    log('INFO', 'Single-target command delivered', {
      playerId: nextCommand.playerId,
      targetJobId: nextCommand.targetJobId
    });
  }

  return res.json({
    status: 'success',
    command: nextCommand.command,
    playerId: nextCommand.playerId,
    targetJobId: nextCommand.targetJobId
  });
});

// Roblox-side / discord-side helper to queue commands
app.post('/discord-command', requireAuth, (req, res) => {
  const { command, playerId, targetJobId } = req.body || {};

  if (!command || !playerId) {
    log('WARN', 'Invalid command request', { command, playerId });
    return res.status(400).json({ error: 'Missing command or playerId' });
  }

  if (commandQueue.size >= CONFIG.MAX_QUEUE_SIZE) {
    log('ERROR', 'Command queue full', { size: commandQueue.size });
    return res.status(429).json({
      error: 'Command queue full',
      queueSize: commandQueue.size,
      maxSize: CONFIG.MAX_QUEUE_SIZE
    });
  }

  const jobId = targetJobId || '*';

  commandQueue.set(playerId, {
    command,
    playerId,
    targetJobId: jobId,
    queuedAt: Date.now()
  });

  log('INFO', 'Command queued', {
    playerId,
    targetJobId: jobId,
    queueSize: commandQueue.size
  });

  addToHistory({
    type: 'command_queued',
    playerId,
    targetJobId: jobId,
    commandPreview: command.substring(0, 50),
    success: true
  });

  return res.json({
    status: 'success',
    message: 'Command queued for Roblox client',
    playerId,
    targetJobId: jobId,
    queuePosition: commandQueue.size
  });
});

app.post('/data-response', requireAuth, (req, res) => {
  try {
    const { playerId, data, success, error, metadata } = req.body || {};

    if (!playerId) {
      log('WARN', 'Response missing playerId');
      return res.status(400).json({ error: 'Missing playerId' });
    }

    const request = pendingRequests.get(playerId);
    if (!request) {
      log('DEBUG', 'No pending request found', { playerId });
      return res.status(200).json({ status: 'no pending request' });
    }

    log('INFO', 'Response received', {
      playerId,
      success,
      serverId: metadata?.serverId
    });

    // ===== Server list aggregation (!getservers) =====
    if (playerId.startsWith('ServerList_')) {
      log('INFO', 'ServerList response received', {
        playerId,
        serverId: metadata?.serverId,
        serversSoFar: serverResponses.has(playerId)
          ? serverResponses.get(playerId).length
          : 0
      });

      if (!serverResponses.has(playerId)) {
        serverResponses.set(playerId, []);
      }

      const servers = serverResponses.get(playerId);
      servers.push({
        jobId: data?.result?.jobId || 'unknown',
        players: data?.result?.players || [],
        count: data?.result?.count || 0,
        maxPlayers: data?.result?.maxPlayers || 0,
        placeId: data?.result?.placeId,
        vipServerId: data?.result?.vipServerId
      });

      // Reset and schedule final send
      clearTimeout(request.collectionTimeout);
      request.collectionTimeout = setTimeout(() => {
        const allServers = serverResponses.get(playerId) || [];
        serverResponses.delete(playerId);

        const uniqueServers = [];
        const seenJobIds = new Set();
        for (const s of allServers) {
          const jobIdStr = typeof s.jobId === 'string' ? s.jobId : 'unknown';
          if (!seenJobIds.has(jobIdStr)) {
            seenJobIds.add(jobIdStr);
            uniqueServers.push(s);
          }
        }

        const totalPlayers = uniqueServers.reduce(
          (sum, s) => sum + (s.count || 0),
          0
        );

        const embed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('🌐 Active Servers')
          .setDescription(
            uniqueServers.length === 0
              ? '**No servers responded within 10 seconds**'
              : `**Results after 10s** (${uniqueServers.length} server(s), ${totalPlayers} players total)`
          );

        uniqueServers.forEach((server, index) => {
          const players = Array.isArray(server.players) ? server.players : [];
          const playerList =
            players.length > 0
              ? players.slice(0, 10).join(', ') +
                (players.length > 10 ? '...' : '')
              : 'No players';

          const jobIdDisplay =
            typeof server.jobId === 'string'
              ? server.jobId
              : 'unknown';

          embed.addFields({
            name: `Server ${index + 1}: ${jobIdDisplay} (${server.count}/${server.maxPlayers})`,
            value: `**Players:** ${playerList}`,
            inline: false
          });
        });

        request.channel.send({ embeds: [embed] }).catch(err =>
          log('ERROR', 'Failed to send server list', { error: err.message })
        );

        pendingRequests.delete(playerId);
      }, CONFIG.RESPONSE_COLLECTION_DELAY);

      return res.json({ status: 'success' });
    }

    // ===== Player search (!searchforplayer) =====
    if (playerId.startsWith('SearchPlayer_')) {
      const result = data?.result;
      const embed = new EmbedBuilder()
        .setColor(result?.found ? 0x00ff00 : 0xff9900);

      if (result?.found) {
        const jobIdDisplay =
          result.serverId && result.serverId.length > 32
            ? result.serverId.substring(0, 32) + '...'
            : (result.serverId || 'unknown');

        embed
          .setTitle('✅ Player Found')
          .setDescription(`**${result.playerName}** (${result.userId})`)
          .addFields({
            name: 'Server ID',
            value: `\`${jobIdDisplay}\``,
            inline: true
          });
      } else {
        embed
          .setTitle('⚠️ Player Not Found')
          .setDescription('Player not found in any active server');
      }

      request.channel.send({ embeds: [embed] }).catch(err =>
        log('ERROR', 'Failed to send search result', { error: err.message })
      );

      pendingRequests.delete(playerId);
      return res.json({ status: 'success' });
    }

    // ===== Execute response (!execute) =====
    if (playerId.startsWith('Execute_')) {
      const result = data?.result;
      let responseText = '';

      if (success === false) {
        responseText = `**❌ Execution Error**\n\`\`\`\n${error || 'Unknown error'}\n\`\`\``;
      } else {
        if (result !== undefined && result !== null) {
          if (typeof result === 'object') {
            responseText = `**✅ Execution Success**\n\`\`\`json\n${JSON.stringify(
              result,
              null,
              2
            )}\n\`\`\``;
          } else {
            responseText = `**✅ Execution Success**\n\`\`\`\n${String(
              result
            )}\n\`\`\``;
          }
        } else {
          responseText =
            '**✅ Execution Success**\n``````';
        }

        const serverIdDisplay =
          metadata?.serverId && metadata.serverId.length > 32
            ? metadata.serverId.substring(0, 32) + '...'
            : metadata?.serverId || 'N/A';

        responseText += `\nServer: \`${serverIdDisplay}\``;
      }

      if (responseText.length > 1900) {
        responseText =
          responseText.substring(0, 1900) +
          '\n```
      }

      request.channel.send(responseText).catch(err =>
        log('ERROR', 'Failed to send execution result', { error: err.message })
      );

      pendingRequests.delete(playerId);
      return res.json({ status: 'success' });
    }

    // ===== Generic data response (!getdata etc.) =====
    const playerData = data?.result || {};
    let message = `📊 **${playerId}'s Data**\n\`\`\`diff\n`;

    if (Object.keys(playerData).length === 0) {
      message += 'No data found\n';
    } else {
      for (const [key, value] of Object.entries(playerData)) {
        let formatted = value;

        if (Array.isArray(value)) {
          formatted = value.join(', ');
        } else if (typeof value === 'object' && value !== null) {
          formatted = JSON.stringify(value);
        }

        const changeIndicator =
          typeof value === 'number'
            ? value > 0
              ? '+'
              : value < 0
              ? '-'
              : ' '
            : ' ';

        message += `${changeIndicator} ${key}: ${formatted}\n`;
      }
    }

    message += '```';

    const embed = new EmbedBuilder()
      .setColor(success === false ? 0xff0000 : 0x00ae86)
      .setDescription(
        success === false
          ? `❌ **Error**\n\`\`\`${error || 'Unknown error'}\`\`\``
          : message
      )
      .setFooter({
        text: `Server: ${metadata?.serverId?.substring(0, 32) || 'N/A'}`
      });

    request.channel.send({ embeds: [embed] }).catch(err =>
      log('ERROR', 'Failed to send data response', { error: err.message })
    );

    pendingRequests.delete(playerId);

    addToHistory({
      type: 'response_received',
      playerId,
      success,
      error
    });

    return res.json({ status: 'success' });
  } catch (err) {
    log('ERROR', 'Error processing data response', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/clear-queue', requireAuth, (req, res) => {
  const cleared = commandQueue.size;
  commandQueue.clear();

  log('INFO', 'Command queue cleared', { clearedItems: cleared });

  res.json({
    status: 'success',
    message: `Cleared ${cleared} queued commands`
  });
});

// ================== DISCORD HELPERS ==================
async function queueRobloxCommand(channel, command, playerId, targetJobId = '*') {
  pendingRequests.set(playerId, {
    channel,
    createdAt: Date.now(),
    targetJobId
  });

  const url = `${CONFIG.SERVER_URL}/discord-command`;

  try {
    const resp = await axios.post(
      url,
      { command, playerId, targetJobId },
      {
        headers: {
          'x-api-key': CONFIG.API_PASSCODE,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    log('DEBUG', 'Command queued successfully', {
      playerId,
      targetJobId,
      response: resp.data
    });

    return resp.data;
  } catch (err) {
    log('ERROR', 'Failed to queue command', {
      playerId,
      targetJobId,
      error: err.message
    });
    pendingRequests.delete(playerId);
    throw err;
  }
}

// ================== DISCORD EVENTS ==================
discordClient.on('ready', () => {
  log('INFO', `Bot logged in as ${discordClient.user.tag}`);
  log('INFO', `Serving ${discordClient.guilds.cache.size} guild(s)`);
  discordClient.user.setActivity('Roblox servers', { type: 3 }); // WATCHING
});

discordClient.on('error', err => {
  log('ERROR', 'Discord client error', { error: err.message });
});

discordClient.on('warn', warning => {
  log('WARN', 'Discord client warning', { warning });
});

// ================== DISCORD COMMANDS ==================
discordClient.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    if (message.content.startsWith('!')) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔒 Permission Denied')
        .setDescription('You need Administrator permissions to use bot commands.');

      return message
        .reply({ embeds: [embed] })
        .then(m =>
          setTimeout(() => {
            m.delete().catch(() => {});
          }, 5000)
        )
        .catch(() => {});
    }
    return;
  }

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  try {
    // -------- !getdata --------
    if (command === '!getdata') {
      const idMatch = args[1]?.match(/\d+/);
      const playerId = idMatch ? idMatch[0] : null;

      if (!playerId) {
        const embed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle('ℹ️ Usage')
          .setDescription('`!getdata <playerId>`\n\nExample: `!getdata 123456789`');

        return message
          .reply({ embeds: [embed] })
          .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
      }

      const playerKey = `Player_${playerId}`;

      await queueRobloxCommand(
        message.channel,
        `return game:GetService("DataStoreService"):GetDataStore("PlayerData"):GetAsync("${playerKey}")`,
        playerKey
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Request Queued')
        .setDescription(`Fetching data for player **${playerId}**`)
        .addFields(
          { name: 'Player ID', value: playerKey, inline: true },
          {
            name: 'Timeout',
            value: `${Math.floor(CONFIG.REQUEST_TIMEOUT / 1000)}s`,
            inline: true
          }
        );

      await message.reply({ embeds: [embed] });

      // -------- !getservers --------
    } else if (command === '!getservers') {
      const requestId = `ServerList_${Date.now()}`;

      await queueRobloxCommand(
        message.channel,
        `
          local players = game:GetService("Players"):GetPlayers()
          local playerNames = {}
          for _, player in ipairs(players) do
            table.insert(playerNames, player.Name)
          end
          return {
            jobId = game.JobId,
            players = playerNames,
            count = #players,
            maxPlayers = game.Players.MaxPlayers,
            placeId = game.PlaceId
          }
        `,
        requestId,
        '*'
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Server List Requested')
        .setDescription('Gathering information from all active servers...')
        .setFooter({
          text: `This may take ${Math.floor(
            CONFIG.RESPONSE_COLLECTION_DELAY / 1000
          )} seconds`
        });

      await message.reply({ embeds: [embed] });

      // -------- !execute --------
    } else if (command === '!execute') {
      const serverId = args[1];
      const cmd = args.slice(2).join(' ');

      if (!serverId || !cmd) {
        const embed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle('ℹ️ Usage')
          .setDescription(
            '`!execute <serverJobId|*> <lua_command>`\n\n' +
              'Examples:\n' +
              '`!execute * print("Hello all servers")`\n' +
              '`!execute abc123 print("Hello specific server")`\n\n' +
              'Use `*` to execute on all servers.'
          );

        return message
          .reply({ embeds: [embed] })
          .then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
      }

      const requestId = `Execute_${Date.now()}`;

      // Escape quotes for Lua string
      const escapedCmd = cmd.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      const lua = `
        local fn, err = require(game.ServerScriptService.ExternalCommands.Loadstring)('${escapedCmd}')
        if not fn then
          return { error = err }
        end
        local ok, result = pcall(fn)
        if not ok then
          return { error = result }
        end
        return { result = result }
      `;

      await queueRobloxCommand(
        message.channel,
        lua,
        requestId,
        serverId
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Execution Queued')
        .setDescription(
          `Executing code on **${
            serverId === '*' ? 'all servers' : `server ${serverId}`
          }**...`
        );

      await message.reply({ embeds: [embed] });

      // -------- !help --------
    } else if (command === '!help') {
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🤖 Bot Commands')
        .setDescription('Available commands for administrators:')
        .addFields(
          {
            name: '!getdata <playerId>',
            value: 'Fetch player data from DataStore',
            inline: false
          },
          {
            name: '!getservers',
            value: 'List all active game servers',
            inline: false
          },
          {
            name: '!execute <jobId|*> <lua_code>',
            value:
              'Execute Lua code on specific server or all servers (*)',
            inline: false
          },
          {
            name: '!searchforplayer <playerId>',
            value: 'Find which server a player is on',
            inline: false
          },
          {
            name: '!help',
            value: 'Show this help message',
            inline: false
          }
        )
        .setFooter({ text: 'Bridge v2.2.0' });

      await message.reply({ embeds: [embed] });
    }
  } catch (err) {
    log('ERROR', 'Command execution failed', {
      command,
      error: err.message
    });

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('❌ Error')
      .setDescription(`Failed to execute command: ${err.message}`)
      .setFooter({ text: 'Check server logs for details' });

    await message.reply({ embeds: [embed] }).catch(() => {});
  }
});

// ================== PROCESS EVENTS ==================
process.on('unhandledRejection', (reason, promise) => {
  log('ERROR', 'Unhandled Rejection', { reason, promise: String(promise) });
});

process.on('uncaughtException', error => {
  log('ERROR', 'Uncaught Exception', { error: error.message });
  process.exit(1);
});

function shutdown() {
  log('INFO', 'Shutting down gracefully...');
  discordClient.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ================== START ==================
discordClient.login(CONFIG.DISCORD_TOKEN).catch(err => {
  log('ERROR', 'Failed to login to Discord', { error: err.message });
  process.exit(1);
});

app.listen(CONFIG.PORT, () => {
  log('INFO', `Express server listening on port ${CONFIG.PORT}`);
  log('INFO', '=== Bridge is ready ===');
});
