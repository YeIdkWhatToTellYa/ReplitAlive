require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();

const CONFIG = {
  PORT: process.env.PORT || 3000,
  PASSCODE: process.env.API_PASSCODE,
  DISCORD_TOKEN: process.env.DISCORD_BOT_TOKEN
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'x-api-key, Content-Type');
  next();
});

app.get('/', (req, res) => {
  console.log('Health check passed');
  res.status(200).send('Server is healthy');
});

app.get('/get-command', (req, res) => {
  console.log('Received get-command request');
  res.json({ 
    status: 'success',
    command: 'return "Test command received"',
    timestamp: Date.now()
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Internal Server Error');
});

app.listen(CONFIG.PORT, () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
  console.log(`Test endpoint: http://localhost:${CONFIG.PORT}/get-command`);
});
