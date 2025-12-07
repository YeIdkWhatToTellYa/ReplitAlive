local HttpService = game:GetService("HttpService")
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local CONFIG = {
	SERVER_URL = "https://replitalive.onrender.com",
	API_KEY = "4NF2A435Izlv265nkOc4LoaLzHWqIrap4SNxvaaM",
	REQUEST_INTERVAL = 5,
	MAX_RETRIES = 3,
	RESPONSE_TIMEOUT = 30,
	DEBUG_MODE = true
}

local commandHistory = {}
local MAX_HISTORY = 50
local processedCommands = {} -- commandId = timestamp

local function Log(level, message, data)
	if not CONFIG.DEBUG_MODE and level == "DEBUG" then return end

	local timestamp = os.date("%H:%M:%S")
	local logMessage = string.format("[%s][%s] %s", timestamp, level, message)

	if level == "ERROR" then
		warn(logMessage)
	else
		print(logMessage)
	end

	if data and CONFIG.DEBUG_MODE then
		pcall(function()
			print(HttpService:JSONEncode(data))
		end)
	end
end

local function SafeJSONEncode(data)
	local success, result = pcall(function()
		return HttpService:JSONEncode(data)
	end)

	if not success then
		Log("ERROR", "JSON encoding failed", {error = result})
		return nil
	end

	return result
end

local function SafeJSONDecode(jsonString)
	if not jsonString or #jsonString == 0 then
		return nil, "Empty response body"
	end

	local success, result = pcall(function()
		return HttpService:JSONDecode(jsonString)
	end)

	if not success then
		Log("ERROR", "JSON decoding failed", {error = result})
		return nil, "Invalid JSON response"
	end

	return result
end

local function MakeRequest(method, endpoint, body, retryCount)
	retryCount = retryCount or 0
	local url = CONFIG.SERVER_URL .. endpoint

	local requestData = {
		Url = url,
		Method = method,
		Headers = {
			["x-api-key"] = CONFIG.API_KEY,
			["Content-Type"] = "application/json",
		}
	}

	if body then
		requestData.Body = SafeJSONEncode(body)
		if not requestData.Body then
			return nil, "Failed to encode request body"
		end
	end

	Log("DEBUG", string.format("%s %s", method, endpoint), body)

	local success, response = pcall(function()
		return HttpService:RequestAsync(requestData)
	end)

	if not success then
		local errorMsg = tostring(response)
		Log("ERROR", "HTTP request failed", {
			endpoint = endpoint,
			error = errorMsg,
			retry = retryCount
		})

		if retryCount < CONFIG.MAX_RETRIES then
			task.wait(math.min(2 ^ retryCount, 10))
			return MakeRequest(method, endpoint, body, retryCount + 1)
		end

		return nil, "Request failed after " .. CONFIG.MAX_RETRIES .. " retries: " .. errorMsg
	end

	if response.StatusCode >= 500 then
		if retryCount < CONFIG.MAX_RETRIES then
			task.wait(math.min(2 ^ retryCount, 10))
			return MakeRequest(method, endpoint, body, retryCount + 1)
		end
		return nil, "Server error (HTTP " .. response.StatusCode .. ")"
	elseif response.StatusCode >= 400 then
		if response.StatusCode == 403 then
			return nil, "Authentication failed - invalid API key"
		end
		return nil, "Client error (HTTP " .. response.StatusCode .. ")"
	end

	local decoded, decodeErr = SafeJSONDecode(response.Body)
	if not decoded then
		return nil, decodeErr
	end

	Log("DEBUG", "Response received", decoded)
	return decoded
end

local function ExecuteCommand(commandStr, playerId)
	if not commandStr or type(commandStr) ~= "string" then
		return nil, "Invalid command: must be a string"
	end

	if #commandStr > 10000 then
		return nil, "Command too long (max 10000 characters)"
	end

	Log("INFO", "Executing command", {
		playerId = playerId,
		commandLength = #commandStr
	})

	local loadstringModule = script.Parent:FindFirstChild("ExternalCommands")
		and script.Parent.ExternalCommands:FindFirstChild("Loadstring")

	if not loadstringModule then
		return nil, "Loadstring module not found"
	end

	print("=== COMMAND ===")
	print(commandStr)
	print("===============")

	local loadSuccess, chunk = pcall(function()
		return require(loadstringModule)(commandStr)
	end)

	if not loadSuccess or not chunk then
		Log("ERROR", "Command load failed", {error = chunk})
		return nil, "Load error: " .. tostring(chunk)
	end

	local startTime = tick()
	local success, result = pcall(chunk)
	local executionTime = tick() - startTime

	if not success then
		Log("ERROR", "Command execution failed", {
			error = result,
			executionTime = executionTime
		})
		return nil, "Execution error: " .. tostring(result)
	end

	Log("INFO", "Command executed successfully", {
		executionTime = executionTime,
		resultType = type(result)
	})

	table.insert(commandHistory, 1, {
		playerId = playerId,
		timestamp = os.time(),
		success = true,
		executionTime = executionTime
	})

	if #commandHistory > MAX_HISTORY then
		table.remove(commandHistory, #commandHistory)
	end

	return result
end

local function SendResponse(playerId, data, success, error, commandId)
	Log("DEBUG", "Sending response", { 
		playerId = playerId or "unknown", 
		success = success,
		commandId = commandId
	})

	local response = {
		playerId = playerId or "unknown",
		success = success or false,
		commandId = commandId,
		metadata = {
			serverId = game.JobId or "studio",
			timestamp = os.time(),
			serverVersion = game.PlaceVersion or "studio"
		}
	}

	if success and data ~= nil then
		response.data = { result = data }
	else
		response.error = error or "Unknown error"
	end

	local result, sendErr = MakeRequest("POST", "/data-response", response)

	if sendErr then
		Log("ERROR", "❌ FAILED to send response", {
			playerId = playerId,
			error = sendErr
		})
		return false
	end

	Log("INFO", "✅ Response sent successfully", {playerId = playerId or "unknown"})
	return true
end

local function SendHealthCheck()
	local playerList = {}
	for _, player in ipairs(Players:GetPlayers()) do
		table.insert(playerList, {
			name = player.Name,
			userId = player.UserId
		})
	end

	local healthData = {
		status = "online",
		serverId = game.JobId,
		players = playerList,
		playerCount = #playerList,
		maxPlayers = Players.MaxPlayers,
		uptime = time(),
		placeId = game.PlaceId,
		commandsProcessed = #commandHistory
	}

	MakeRequest("POST", "/health", healthData)
end

local function CleanupProcessedCommands()
	local now = os.time()
	local toRemove = {}
	
	for commandId, timestamp in pairs(processedCommands) do
		if now - timestamp > 120 then -- Remove after 2 minutes
			table.insert(toRemove, commandId)
		end
	end
	
	for _, commandId in ipairs(toRemove) do
		processedCommands[commandId] = nil
	end
end

local function MainLoop()
	Log("INFO", "Starting main command loop", {
		serverId = game.JobId or "studio",
		interval = CONFIG.REQUEST_INTERVAL
	})

	local loopCount = 0
	local lastHealthCheck = 0

	while true do
		loopCount = loopCount + 1

		-- Cleanup old processed commands every 50 loops
		if loopCount % 50 == 0 then
			CleanupProcessedCommands()
		end

		-- Send health check every 60 seconds
		if tick() - lastHealthCheck > 60 then
			SendHealthCheck()
			lastHealthCheck = tick()
		end

		local commandData = MakeRequest("GET", "/get-command")

		if commandData and commandData.status == "success" and commandData.command then
			if commandData.command ~= 'return "No pending commands"' then
				local playerId = commandData.playerId or "unknown"
				local targetJobId = commandData.targetJobId or "*"
				local commandId = commandData.commandId
				local currentJobId = game.JobId or "studio"

				-- Create a unique key per server: commandId + currentJobId
				local serverSpecificCommandId = commandId .. "_" .. currentJobId

				-- Check if THIS SERVER already processed this command
				if commandId and processedCommands[serverSpecificCommandId] then
					Log("DEBUG", "Command already processed by this server, skipping", {
						commandId = commandId,
						playerId = playerId,
						serverId = currentJobId
					})
				else
					Log("INFO", "Command received", {
						playerId = playerId,
						commandPreview = commandData.command:sub(1, 50),
						targetJobId = targetJobId,
						currentJobId = currentJobId,
						commandId = commandId
					})

					local shouldExecute = targetJobId == '*' or targetJobId == currentJobId

					if shouldExecute then
						-- Mark as processed by THIS SERVER
						if commandId then
							processedCommands[serverSpecificCommandId] = os.time()
						end

						Log("INFO", "Executing command on this server", {
							targetJobId = targetJobId,
							currentJobId = currentJobId
						})

						local data, execErr = ExecuteCommand(commandData.command, playerId)
						task.spawn(SendResponse, playerId, data, data ~= nil, execErr, commandId)
					else
						Log("INFO", "Command skipped - not targeted", {
							targetJobId = targetJobId,
							currentJobId = currentJobId
						})
					end
				end
			end
		end

		task.wait(CONFIG.REQUEST_INTERVAL)
	end
end

local function ValidateConfiguration()
	local errors = {}

	if CONFIG.SERVER_URL == "" or not CONFIG.SERVER_URL:match("^https?://") then
		table.insert(errors, "Invalid SERVER_URL - must start with http:// or https://")
	end

	if CONFIG.API_KEY == "" then
		table.insert(errors, "API_KEY is not configured")
	end

	local externalCommands = game.ServerScriptService:FindFirstChild("ExternalCommands")
	if not externalCommands then
		table.insert(errors, "ExternalCommands folder not found in ServerScriptService")
	elseif not externalCommands:FindFirstChild("Loadstring") then
		table.insert(errors, "Loadstring module not found in ExternalCommands")
	end

	if #errors > 0 then
		Log("ERROR", "Configuration validation failed:")
		for _, err in ipairs(errors) do
			warn("  - " .. err)
		end
		return false
	end

	return true
end

Log("INFO", "=== Discord-Roblox Bridge Starting ===")
Log("INFO", "Server ID: " .. (game.JobId or "studio"))
Log("INFO", "Place ID: " .. game.PlaceId)

if not ValidateConfiguration() then
	error("Bridge configuration is invalid. Please check the errors above.")
end

task.spawn(function()
	local success, err = pcall(MainLoop)
	if not success then
		Log("ERROR", "Main loop crashed", {error = tostring(err)})
		warn("MainLoop CRASHED:", err)
	end
end)

Players.PlayerAdded:Connect(function(player)
	Log("INFO", "Player joined", {
		name = player.Name,
		userId = player.UserId
	})
end)

Players.PlayerRemoving:Connect(function(player)
	Log("INFO", "Player left", {
		name = player.Name,
		userId = player.UserId
	})
end)

Log("INFO", "🚀 Bridge initialized successfully")
