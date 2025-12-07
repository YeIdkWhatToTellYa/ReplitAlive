require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const app = express();
const port = process.env.PORT || 3000;

const CONFIG = {
    API_PASSCODE: process.env.API_PASSCODE,
    DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN,
    ROBLOX_URL: process.env.ROBLOX_SERVER_URL || 'https://replitalive.onrender.com',
    MAX_QUEUE: 50,
    TIMEOUT: 15000
};

const commandQueue = new Map();
const pendingResponses = new Map();
const serverListResponses = new Map();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
    if (req.headers['x-api-key'] !== CONFIG.API_PASSCODE) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
});

// HEALTH CHECK
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        queueSize: commandQueue.size,
        pending: pendingResponses.size
    });
});

// GET NEXT COMMAND
app.get('/get-command', (req, res) => {
    const command = Array.from(commandQueue.values())[0];
    
    if (command) {
        res.json({
            status: 'success',
            command: command.code,
            playerId: command.id,
            targetJobId: command.targetServer || '*'
        });
    } else {
        res.json({ status: 'success', command: 'return "No pending commands"' });
    }
});

// QUEUE COMMAND FROM DISCORD
app.post('/discord-command', (req, res) => {
    const { code, id, targetServer } = req.body;
    
    if (commandQueue.size >= CONFIG.MAX_QUEUE) {
        return res.status(429).json({ error: 'Queue full' });
    }
    
    commandQueue.set(id, {
        code,
        id,
        targetServer: targetServer || '*',
        queuedAt: Date.now()
    });
    
    console.log(`Queued: ${id} -> ${targetServer || '*'} (${code.substring(0, 50)}...)`);
    res.json({ status: 'success', queued: true });
});

// HANDLE RESPONSES FROM ROBLOX
app.post('/data-response', (req, res) => {
    const { playerId, success, data, error, metadata } = req.body;
    
    const request = pendingResponses.get(playerId);
    if (!request) {
        return res.json({ status: 'ok' });
    }
    
    // SERVER LIST (collects from all servers)
    if (playerId.startsWith('ServerList_')) {
        if (!serverListResponses.has(playerId)) {
            serverListResponses.set(playerId, []);
        }
        
        serverListResponses.get(playerId).push({
            jobId: metadata.serverId,
            players: data?.result?.players || [],
            count: data?.result?.count || 0
        });
        
        // Send after 10 seconds regardless
        clearTimeout(request.timeoutId);
        request.timeoutId = setTimeout(() => {
            sendServerList(playerId, request.channel);
            pendingResponses.delete(playerId);
        }, 10000);
        
        return res.json({ status: 'ok' });
    }
    
    // EXECUTE RESULTS
    if (playerId.startsWith('Execute_')) {
        const embed = new EmbedBuilder()
            .setColor(success ? 0x00ff00 : 0xff0000)
            .setTitle(success ? '✅ Executed' : '❌ Error')
            .setDescription(success 
                ? `\`\`\`${String(data?.result || 'Success')}\`\`\``
                : `\`\`\`lua\n${error}\n\`\`\``)
            .setFooter({ text: `Server: ${metadata.serverId}` });
        
        request.channel.send({ embeds: [embed] });
        pendingResponses.delete(playerId);
        return res.json({ status: 'ok' });
    }
    
    res.json({ status: 'ok' });
});

function sendServerList(playerId, channel) {
    const servers = serverListResponses.get(playerId) || [];
    serverListResponses.delete(playerId);
    
    const uniqueServers = [];
    const seen = new Set();
    
    for (const server of servers) {
        if (!seen.has(server.jobId)) {
            seen.add(server.jobId);
            uniqueServers.push(server);
        }
    }
    
    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🌐 Active Servers')
        .setDescription(`${uniqueServers.length} servers found`);
    
    uniqueServers.forEach((server, i) => {
        embed.addFields({
            name: `Server ${i + 1}`,
            value: `\`${server.jobId.substring(0, 20)}...\`\n${server.count} players`,
            inline: true
        });
    });
    
    channel.send({ embeds: [embed] });
}

// CLEANUP OLD REQUESTS
setInterval(() => {
    const now = Date.now();
    for (const [id, request] of pendingResponses) {
        if (now - request.createdAt > CONFIG.TIMEOUT) {
            pendingResponses.delete(id);
        }
    }
}, 5000);

// DISCORD BOT
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

async function queueCommand(channel, code, id, targetServer = '*') {
    pendingResponses.set(id, {
        channel,
        createdAt: Date.now()
    });
    
    const response = await fetch(`${CONFIG.ROBLOX_URL}/discord-command`, {
        method: 'POST',
        headers: { 'x-api-key': CONFIG.API_PASSCODE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, id, targetServer })
    });
    
    return response.ok;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return;
    }
    
    const args = message.content.split(' ');
    const cmd = args[0].toLowerCase();
    
    if (cmd === '!getservers') {
        const requestId = `ServerList_${Date.now()}`;
        await queueCommand(message.channel, `
            local players = game:GetService("Players"):GetPlayers()
            return {
                jobId = game.JobId,
                players = {table.concat(players, ", ")},
                count = #players
            }
        `, requestId, '*');
        
        message.reply('🔍 Scanning all servers... (10s)');
        
    } else if (cmd === '!execute') {
        const serverId = args[1];
        const luaCode = args.slice(2).join(' ');
        
        if (!serverId || !luaCode) {
            return message.reply('Usage: `!execute * print("hello")`');
        }
        
        const requestId = `Execute_${Date.now()}`;
        await queueCommand(message.channel, luaCode, requestId, serverId);
        
        message.reply(`✅ Queued on ${serverId === '*' ? 'all servers' : serverId}`);
    }
});

client.once('ready', () => {
    console.log(`✅ Bot ready - ${client.user.tag}`);
});

client.login(CONFIG.DISCORD_TOKEN);

// START SERVER
app.listen(port, () => {
    console.log(`🚀 Bridge running on port ${port}`);
});
