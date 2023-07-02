const uWS = require('uWebSockets.js');
require("dotenv").config()
const mongoose = require('mongoose');


// Function to decode the incoming message
const decodeMessage = (message) => {
    const buffer = Buffer.from(message);
    const jsonString = buffer.toString();
    const { event, data } = JSON.parse(jsonString);
    return { event, data };
};

// Function to encode a JSON object into a Uint8Array buffer
const encodeMessage = (jsonObject) => {
    const jsonString = JSON.stringify(jsonObject);
    const buffer = Buffer.from(jsonString);
    return new Uint8Array(buffer);
};

function generateRandomString() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomString = '';

    for (let i = 0; i < 6; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        randomString += characters[randomIndex];
    }

    return randomString;
}

// Connect to MongoDB using Mongoose
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.DB, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log(`MongoDB Connected`);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
connectDB()

// Define Game schema and model using Mongoose
const gameSchema = new mongoose.Schema({
    gameId: String,
    player1Id: String,
    player2Id: String,
    color: String,
    fen: String
});

const GameModel = mongoose.model('Game', gameSchema);

// Function to create a new game
async function createNewGame(playerId, color) {
    const gameId = generateRandomString(); // Implement your own function to generate unique random strings

    const newGame = await GameModel.create({
        gameId,
        player1Id: playerId,
        player2Id: null, // Initially no second player is assigned 
        color: color,
        fen: null
    });

    return newGame;
}

// Function to join an existing game with provided gameId if available
async function joinExistingGame(gameId, playerId) {
    const existingGame = await GameModel.findOne({ gameId });

    if (existingGame && !existingGame.player2Id) {
        if (existingGame.player2Id !== null) {
            throw Error("Game expired")
        }
        existingGame.player2Id = playerId;
        return existingGame.save()
    }

    else {
        console.log(existingGame);
        throw Error("Game Link Expired");
    }
}

// Create a uWebSockets.js server
const app = uWS.App();

// WebSocket route
app.ws('/*', {
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 16 * 1024 * 1024,
    idleTimeout: 0,
    // sendPingsAutomatically: true,
    open: (ws) => {
        console.log('WebSocket connected', ws.getUserData());
    },
    message: async (ws, message, isBinary) => {
      
        console.log('WebSocket message received');
        const { event, data } =  decodeMessage(message);
        // Handle different events
        switch (event) {
            case 'create-game':
                createNewGame(data.playerId, data.color)
                    .then((newGame) => {
                        ws.subscribe(newGame.gameId);
                        // userSocketMap[playerId] = ws.id;
                        const mess = encodeMessage({ event: 'game-created', data: newGame });
                        ws.send(mess)
            
                    })
                    .catch((error) => {
                        const mess = encodeMessage({ event: 'game-creation-failed', data: error.message });
                        ws.send(mess)
                    });

                break;
            case 'join-game':
                joinExistingGame(data.gameId, data.playerId)
                    .then((gameData) => {
                        ws.subscribe(gameData.gameId);
                        const mess = encodeMessage({ event: "player-joined", data: { gameId: gameData.gameId, playerId: data.playerId, gameData: gameData } });
                        ws.publish(data.gameId, mess)
                    })
                    .catch((error) => {
                        const mess = encodeMessage({ event: 'join-game-failed', data: error.message });
                        ws.send(mess)
                    });
                break;

            case 'make-move':
                try {
                    const mess = encodeMessage({ event: 'opponent-made-move', data: { fen: data?.moveData?.fen } })
                    ws.subscribe(data.gameId)
                    ws.publish(data.gameId, mess)

                    const filter = { gameId: data.gameId }
                    const dataMod = { fen: data.moveData.fen }
                    await GameModel.findOneAndUpdate(filter, dataMod);
                } catch (error) {
                    console.log("move error", error.message);
                }

                break;
            case 'get-game':
                try {
                    ws.subscribe(data.gameId)
                    const info = await GameModel.findOne({ gameId: data.gameId })
        
                    const messy = encodeMessage({ event: "game-details", data: info })
                    ws.send(messy)

                } catch (error) {
                    console.log("get-game-error", error.message)
                }
                break;
            case 'ping':
                ws.send(message)
                break
            default:
                console.log('Unknown event:', event);
                break;
        }

        console.log(event, data);
        // Send a response
        // ws.send(message);
    },

    close: (ws, code, message) => {
        console.log('WebSocket closed', code, message);
    }
});

// Start the server
let PORT = process.env.PORT || 3000
app.listen(Number(PORT), (token) => {
    if (token) {
        console.log(`Server running on port ${PORT}`);
    } else {
        console.log('Failed to listen to uWebSockets.js server', token);
    }
});


