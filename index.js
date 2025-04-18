const express = require('express');
const app = express();

// 🔐 Security - use secrets or env vars
const PASSCODE = process.env.API_PASSCODE || "CHANGE_ME";
let lastCommand = null;

// ✅ FIXED: Wildcard route to capture full command after /command/
app.get('/command/*', (req, res) => {
  // Check x-api-key header
  if (req.headers['x-api-key'] !== PASSCODE) {
    return res.status(403).send("Invalid passcode!");
  }

  // Capture everything after /command/
  const fullCommand = req.params[0] || '';
  lastCommand = decodeURIComponent(fullCommand);

  console.log(`📩 Received: ${lastCommand}`);
  res.send(`✅ Forwarding to Roblox: ${lastCommand}`);
});

// ⬅️ Endpoint to retrieve the last command
app.get('/get-command', (req, res) => {
  res.json({ command: lastCommand });
});

// 🚀 Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
