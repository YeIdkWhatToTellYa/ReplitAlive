const express = require('express')
const app = express()
const PORT = 3000

app.use(express.json())

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "x-api-key, Content-Type")
    next()
})

app.get('/health', (req, res) => {
    console.log("Health check received")
    
    if (req.headers['x-api-key'] !== process.env.API_KEY) {
        return res.status(403).json({ 
            status: "error",
            message: "Invalid API key" 
        })
    }
    
    res.json({
        status: "success",
        message: "Server is healthy",
        timestamp: Date.now()
    })
})

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`Test endpoint: http://localhost:${PORT}/health`)
})
