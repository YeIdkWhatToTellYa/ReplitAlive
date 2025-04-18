
const express = require('express');
const app = express();

const PASSCODE = process.env.API_PASSCODE || "CHANGE_ME";
let lastCommand = null;

app.get('/command/:lua*?', (req, res) => {
  // Authentication
  if (req.headers['x-api-key'] !== PASSCODE) {
    return res.status(403).send("Invalid passcode!");
  }

  const fullCommand = req.params.lua || '';
  const additionalPath = req.params[0] || '';
  lastCommand = decodeURIComponent(fullCommand + additionalPath);

  console.log(`📩 Received: ${lastCommand}`);
  res.send(`✅ Forwarding to Roblox: ${lastCommand}`);
});


app.get('/get-command', (req, res) => {
  res.json({ command: lastCommand });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});