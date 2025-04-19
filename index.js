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
  if (!WEBHOOK_URL) return;
  
  try {
    const embed = {
      title: "📝 New Command Received",
      color: 0x00ff00,
      fields: [
        { name: "🕒 Timestamp", value: new Date().toISOString() },
        { name: "🔑 Command", value: `\`\`\`lua\n${command}\`\`\`` },
        { name: "📡 IP", value: req.ip || req.headers['x-forwarded-for'] || "Unknown" }
      ],
      footer: { text: "Command Logger" }
    };
    await axios.post(WEBHOOK_URL, { embeds: [embed] });
  } catch (err) {
    console.error("Discord log failed:", err.message);
  }
}

app.post('/command', async (req, res) => {
  try {
    if (req.headers['x-api-key'] !== PASSCODE) {
      console.warn("Invalid passcode attempt from:", req.ip);
      return res.status(403).send("Invalid passcode!");
    }

    if (!req.body.command) {
      return res.status(400).send("No command provided");
    }

    lastCommand = req.body.command;
    console.log("📩 New command:", lastCommand);

    await logToDiscord(req, lastCommand);

    res.send(`✅ Command received: ${lastCommand}`);
  } catch (err) {
    console.error("Command error:", err);
    res.status(500).send("Server error");
  }
});

app.get('/get-command', (req, res) => {
  res.json({ command: lastCommand || "" }); 
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔑 API Passcode: ${PASSCODE ? "Set" : "Warning: Not set!"}`);
});
