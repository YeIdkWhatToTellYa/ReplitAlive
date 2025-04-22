const express = require('express')
const app = express()
const PORT = 3000

app.use(express.json())

app.get('/test-endpoint', (req, res) => {
    if (req.headers['x-api-key'] !== process.env.API_KEY) {
        return res.status(403).json({ error: "Invalid API key" })
    }
    res.json({ 
        status: "success",
        message: "Hello from the server!",
        timestamp: Date.now()
    })
})

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
