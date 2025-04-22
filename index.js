const express = require('express');
const app = express();
const PORT = 3000;

app.use((req, res, next) => {
    console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
    console.log('Headers:', req.headers);
    next();
});

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'x-api-key, Content-Type');
    next();
});

app.get('/health', (req, res) => {
    const receivedKey = req.headers['x-api-key'];
    const expectedKey = process.env.API_KEY;
    
    console.log(`Received API Key: "${receivedKey}"`);
    console.log(`Expected API Key: "${expectedKey}"`);
    
    if (!receivedKey || receivedKey !== expectedKey) {
        console.log('❌ Key mismatch or missing');
        return res.status(403).json({
            status: "error",
            message: "Invalid API key",
            debug: {
                received: receivedKey,
                expected: expectedKey ? "***REDACTED***" : "NOT_SET"
            }
        });
    }
    
    res.json({
        status: "success",
        message: "API Key Verified",
        timestamp: Date.now()
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`🔑 API Key: ${process.env.API_KEY ? "SET" : "NOT SET"}`);
    console.log(`🔍 Test endpoint: http://localhost:${PORT}/health`);
});
