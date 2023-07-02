// Import required modules and initialize express app
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { log } = require('console');
require("dotenv").config()

const userSocketMap = {};


// Create an instance of the express app
const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
    cors: {
        origin: process.env.CLIENT,
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    },
    transports: ['websocket'] 
});

console.log(process.env.CLIENT);

app.use(cors({
    "origin": "*",
}))

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
        throw Error("Invalid or full game ID");
    }
}


io.on('connection', (socket) => {
    // console.log(userSocket);
    socket.on('create-game', ({ playerId, color }) => {
        createNewGame(playerId, color)
            .then((newGame) => {

                socket.join(newGame.gameId);
                userSocketMap[playerId] = socket.id;
                socket.emit('game-created', newGame);
            })
            .catch((error) => {
                socket.emit('game-creation-failed', error.message);
            });
    });

    socket.on('join-game', ({ gameId, playerId }) => {
        joinExistingGame(gameId, playerId)
            .then((gameData) => {
                socket.join(gameId);
                io.to(gameId).emit("player-joined", { gameId, playerId , gameData});
                userSocketMap[playerId] = socket.id;
            })
            .catch((error) => {
                socket.emit('join-game-failed', error.message);
            });
    });

    // Handle real-time updates and moves
    // Implement your own logic for updating game state and notifying players

    socket.on('make-move', async ({ gameId, playerId, moveData }) => {
        const data = { fen: moveData.fen }
        io.to(gameId).emit('opponent-made-move', { data })
        const filter = { gameId }
        socket.join(gameId)
        await GameModel.findOneAndUpdate(filter, data);
    });

    socket.on("get-game", async ({ gameId }) => {
        socket.join(gameId)
        const data = await GameModel.findOne({ gameId })
        socket.emit("game-details", { data })
    })

});

// Start the server
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on port ${port}`));