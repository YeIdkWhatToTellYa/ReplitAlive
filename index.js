const express = require('express');
const axios = require('axios');
const app = express();

const PASSCODE = process.env.API_PASSCODE;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
let lastCommand = null;

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
