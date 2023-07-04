const uWS = require('uWebSockets.js');
require("dotenv").config()
const mongoose = require('mongoose');



const decodeMessage = (message) => {
    const buffer = Buffer.from(message);
    const jsonString = buffer.toString();
    const { event, data } = JSON.parse(jsonString);
    return { event, data };
};


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


const gameSchema = new mongoose.Schema({
    gameId: String,
    player1Id: String,
    player2Id: String,
    color: String,
    fen: String
});

const GameModel = mongoose.model('Game', gameSchema);


async function createNewGame(playerId, color) {
    const gameId = generateRandomString();

    const newGame = await GameModel.create({
        gameId,
        player1Id: playerId,
        player2Id: null,
        color: color,
        fen: null
    });

    return newGame;
}


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

const app = uWS.App();

app.ws('/*', {
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 16 * 1024 * 1024,
    idleTimeout: 0,
    message: async (ws, message, isBinary) => {
        const { event, data } = decodeMessage(message);
     
        switch (event) {
            case 'create-game':
                createNewGame(data.playerId, data.color)
                    .then((newGame) => {
                        ws.subscribe(newGame.gameId);
                        const mess = encodeMessage({ event: 'game-created', data: newGame });
                        ws.send(mess)
                    })
                    .catch((error) => {
                        const mess = encodeMessage({ event: 'game-creation-failed', data: error.message });
                        ws.send(mess)
                    });

                break;
            case 'join-game':
                ws.subscribe(data.gameId);
                joinExistingGame(data.gameId, data.playerId)
                    .then((gameData) => {
                        const message = encodeMessage({ event: "player-joined", data: { gameId: gameData.gameId, playerId: gameData.player2Id, gameData: gameData } });
                        ws.cork(() => {
                            ws.publish(data.gameId, message)
                            ws.send(message) 
                        });
                    })
                    .catch((error) => {

                        const mess = encodeMessage({ event: 'join-game-failed', data: error.message });
                        ws.send(mess)
                        ws.unsubscribe(data.gameId)
                    });
                break;

            case 'make-move':
                try {
                    const mess = encodeMessage({ event: 'opponent-made-move', data: data.moveData.move })
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

    },

    close: (ws, code, message) => {
        console.log('WebSocket closed', code, message);
    }
});


let PORT = process.env.PORT || 3000
app.listen(Number(PORT), (token) => {
    if (token) {
        console.log(`Server running on port ${PORT}`);
    } else {
        console.log('Failed to listen to uWebSockets.js server', token);
    }
});


