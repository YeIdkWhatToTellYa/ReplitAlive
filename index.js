const express = require('express');
const axios = require('axios');
const app = express();

const PASSCODE = process.env.API_PASSCODE;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
let lastCommand = null;
let commandProcessed = false;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Roblox Command Server is running!');
});

async function logToDiscord(req, command) {
  try {
    const embed = {
      title: "📝 New Command Received",
      color: 0x00ff00,
      fields: [
        { name: "🕒 Timestamp", value: new Date().toISOString(), inline: true },
        { name: "🔑 Command", value: `\`\`\`lua\n${command}\`\`\``, inline: false },
        { name: ":satellite: IP Address", value: req.ip || req.headers['x-forwarded-for'] || "Unknown", inline: true },
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

    lastCommand = req.body.command;
    commandProcessed = false;
    console.log(`📩 Received: ${lastCommand}`);
    await logToDiscord(req, lastCommand);
    res.send(`✅ Command received: ${lastCommand}`);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).send("Server error");
  }
});

app.get('/get-command', (req, res) => {
  if (!commandProcessed && lastCommand) {
    commandProcessed = true;
    res.json({ command: lastCommand });
  } else {
    res.json({ command: "" });
  }
});

app.listen(3000, () => console.log("Server ready"));