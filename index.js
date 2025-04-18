const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();

// Security
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Config (set in Replit Secrets)
const PASSCODE = process.env.API_PASSCODE || "CHANGE_ME";
let lastCommand = null;

// Secure endpoint
app.get('/command/*', (req, res) => {
  // Authentication
  if (req.headers['x-api-key'] !== PASSCODE) {
    console.warn(`⚠️ Blocked unauthorized request from ${req.ip}`);
    return res.status(403).send("Invalid passcode!");
  }

  // Extract everything after /command/
  lastCommand = decodeURIComponent(req.params[0]);
  console.log(`📩 Received: ${lastCommand}`);
  res.send(`✅ Forwarding to Roblox: ${lastCommand}`);
});

// Fetch endpoint for Roblox
app.get('/get-command', (req, res) => {
  res.json({ 
    command: lastCommand,
    timestamp: Date.now() 
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🔐 Secure relay running");
});