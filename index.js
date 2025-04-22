const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const app = express();

const PASSCODE = process.env.API_PASSCODE;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
let lastCommand = null;

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

discordClient.on('ready', () => {
  console.log(`🤖 Discord bot logged in as ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.content !== '!hello') return;
  if (!message.member?.permissions.has('Administrator')) return;

  await message.reply('Executed!').catch(console.error);
});

discordClient.login(DISCORD_BOT_TOKEN).catch(err => {
  console.error('Failed to login to Discord:', err);
});

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Roblox Command Server and Discord Bot are running!');
});

async function logToDiscord(req, command) {
  try {
    const now = new Date();
    const utcTimestamp = now.toUTCString();
    const isoTimestamp = now.toISOString();

    const embed = {
      title: "📝 New Command Received",
      color: 0x00ff00,
      fields: [
        { name: "🕒 Timestamp (UTC)", value: utcTimestamp, inline: true },
        { name: "🔑 Command", value: `\`\`\`lua\n${command}\`\`\``, inline: false },
        { name: "🛰️ IP Address", value: req.ip || req.headers['x-forwarded-for'] || "Unknown", inline: true },
        { name: "🛡️ User Agent", value: req.headers['user-agent'] || "Unknown", inline: true }
      ],
      footer: { text: "Command Logger" }
    };
    await axios.post(WEBHOOK_URL, { embeds: [embed] });
  } catch (err) {
    console.error("Failed to log to Discord:", err.message);
  }
}

app.post('/command', async (req, res) => {
  try {
    if (req.headers['x-api-key'] !== PASSCODE) {
      return res.status(403).send("Invalid passcode!");
    }

    lastCommand = {
      value: req.body.command,
      timestamp: Date.now()
    };
    
    console.log(`📩 New command: ${lastCommand.value}`);
    await logToDiscord(req, lastCommand.value);
    res.send(`✅ Command received: ${lastCommand.value}`);
    
  } catch (err) {
    console.error("Error:", err);
    res.status(500).send("Server error");
  }
});

app.get('/get-command', (req, res) => {
  const isFresh = lastCommand && (Date.now() - lastCommand.timestamp < 10000);
  res.json({ 
    command: isFresh ? lastCommand.value : "",
    isFresh: isFresh
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server ready on port ${PORT}`);
});
