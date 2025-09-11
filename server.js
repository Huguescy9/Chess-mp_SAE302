import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { Chess } from "chess.js";

// Charge les variables du fichier .env (GIPHY_API_KEY) s'il existe
try {
  process.loadEnvFile();
} catch {}

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/**
 * Map des parties :
 * game = {
 *   id,
 *   chess: Chess(),
 *   players: { white: clientId|null, black: clientId|null },
 *   spectators: Set<clientId>,
 *   time,                  // durée initiale en secondes
 *   timeLeft: { white, black },
 *   lastUpdate: number | null, // timestamp ms de la dernière mise à jour (null tant que pas démarré)
 *   started: boolean,      // true quand black a rejoint
 *   winner: string|null,   // "white", "black" ou "draw"
 *   history: [],           // liste des coups (SAN + infos)
 *   chatMessages: [],      // historique des messages du chat
 *   participants: Map<clientId, {name, role, socketId}>  // participants connectés
 * }
 */
const games = new Map();

// Map des noms d'utilisateurs
const userNames = new Map();

/* --------- API REST --------- */

// Proxy GIPHY : la clé reste côté serveur
async function fetchGiphy(endpoint, params, res) {
  if (!GIPHY_API_KEY) {
    return res.status(500).json({ error: "GIPHY_API_KEY manquante" });
  }

  const url = new URL(`https://api.giphy.com/v1/gifs/${endpoint}`);
  url.search = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    limit: "20",
    rating: "g",
    ...params,
  });

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GIPHY ${response.status}`);

    const { data } = await response.json();
    res.json(
      data.map((gif) => ({
        id: gif.id,
        title: gif.title,
        preview: gif.images.fixed_width_small?.url || gif.images.fixed_width.url,
        url: gif.images.downsized?.url || gif.images.original.url,
      }))
    );
  } catch (error) {
    console.error("Erreur API GIPHY:", error.message);
    res.status(502).json({ error: "Erreur API GIPHY" });
  }
}

app.get("/api/gifs/trending", (req, res) => {
  fetchGiphy("trending", {}, res);
});

app.get("/api/gifs/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  fetchGiphy("search", { q, lang: "fr" }, res);
});

// Liste des parties (pour le lobby)
app.get("/api/games/list", (req, res) => {
  const list = [];
  for (const [id, game] of games.entries()) {
    const playerCount =
      (game.players.white ? 1 : 0) + (game.players.black ? 1 : 0);
    list.push({
      id,
      white: !!game.players.white,
      black: !!game.players.black,
      playerCount,
      time: game.time,
      started: !!game.started,
      winner: game.winner || null,
    });
  }
  res.json(list);
});

// Créer une partie
app.post("/api/games", (req, res) => {
  const clientId = req.body?.clientId || null;
  const time = Number.isFinite(parseInt(req.body?.time, 10))
    ? parseInt(req.body.time, 10)
    : 600; // défaut 10min

  const id = uuidv4();
  const game = {
    id,
    chess: new Chess(),
    players: { white: clientId, black: null },
    spectators: new Set(),
    time,
    timeLeft: { white: time, black: time },
    lastUpdate: null,
    started: false,
    winner: null,
    history: [], // ✅ on garde l'historique des coups
    chatMessages: [], // historique du chat
    participants: new Map(), // participants connectés
  };
  games.set(id, game);

  res.json({ gameId: id, color: clientId ? "white" : "spectator", time });
});

// Rejoindre une partie (REST)
app.post("/api/games/:id/join", (req, res) => {
  const id = req.params.id;
  const clientId = req.body?.clientId;
  if (!clientId)
    return res.status(400).json({ error: "clientId manquant" });

  const game = games.get(id);
  if (!game) return res.status(404).json({ error: "Partie introuvable" });

  // cas où le client est déjà assigné
  if (game.players.white === clientId)
    return res.json({
      gameId: id,
      color: "white",
      timeLeft: game.timeLeft,
      started: game.started,
      history: game.history,
    });
  if (game.players.black === clientId)
    return res.json({
      gameId: id,
      color: "black",
      timeLeft: game.timeLeft,
      started: game.started,
      history: game.history,
    });
  if (game.spectators.has(clientId))
    return res.json({
      gameId: id,
      color: "spectator",
      timeLeft: game.timeLeft,
      started: game.started,
      history: game.history,
    });

  // assignation des joueurs
  if (!game.players.white) {
    game.players.white = clientId;
    return res.json({
      gameId: id,
      color: "white",
      timeLeft: game.timeLeft,
      started: game.started,
      history: game.history,
    });
  }

  if (!game.players.black) {
    game.players.black = clientId;

    // démarrer la partie maintenant que black est présent
    if (!game.started) {
      game.started = true;
      game.lastUpdate = Date.now();
      io.to(id).emit("update", {
        fen: game.chess.fen(),
        last: null,
        timeLeft: game.timeLeft,
        started: game.started,
        history: game.history,
      });
    }

    return res.json({
      gameId: id,
      color: "black",
      timeLeft: game.timeLeft,
      started: game.started,
      history: game.history,
    });
  }

  // si déjà complet -> spectateur
  game.spectators.add(clientId);
  return res.json({
    gameId: id,
    color: "spectator",
    timeLeft: game.timeLeft,
    started: game.started,
    history: game.history,
  });
});

// État public (debug)
app.get("/api/games/:id", (req, res) => {
  const game = games.get(req.params.id);
  if (!game) return res.status(404).json({ error: "Partie introuvable" });
  res.json({
    gameId: game.id,
    fen: game.chess.fen(),
    players: game.players,
    spectators: [...game.spectators],
    turn: game.chess.turn(),
    over: game.chess.isGameOver(),
    timeLeft: game.timeLeft,
    started: game.started,
    winner: game.winner,
    history: game.history, // ✅ exposé dans l'API
  });
});

/* --------- Socket.IO --------- */

io.on("connection", (socket) => {
  // Rejoindre une room socket
  socket.on("joinGame", ({ gameId, clientId, userName }) => {
    const game = games.get(gameId);
    if (!game) {
      socket.emit("errorMsg", "Partie introuvable");
      return;
    }
    socket.join(gameId);

    // Enregistrer le nom d'utilisateur
    if (userName) {
      userNames.set(clientId, userName);
    }

    let role = "spectator";
    if (game.players.white === clientId) role = "white";
    else if (game.players.black === clientId) role = "black";
    else if (game.spectators.has(clientId)) role = "spectator";

    // Ajouter aux participants
    game.participants.set(clientId, {
      name: userNames.get(clientId) || clientId.slice(0, 8),
      role,
      socketId: socket.id,
    });

    // Notifier tout le monde de la nouvelle connexion
    io.to(gameId).emit("participantJoined", {
      clientId,
      name: game.participants.get(clientId).name,
      role,
    });

    // Envoyer la liste complète des participants
    const participantsList = Array.from(game.participants.entries()).map(([id, data]) => ({
      id,
      name: data.name,
      role: data.role,
    }));

    socket.emit("update", {
      fen: game.chess.fen(),
      role,
      timeLeft: game.timeLeft,
      started: game.started,
      history: game.history, // ✅ historique complet envoyé
      chatMessages: game.chatMessages, // messages du chat
      participants: participantsList, // liste des participants
    });
  });

  // Tentative de coup
  socket.on("move", ({ gameId, clientId, from, to, promotion }) => {
    const game = games.get(gameId);
    if (!game) return;

    if (!game.started) {
      io.to(socket.id).emit(
        "errorMsg",
        "La partie n'a pas commencé (en attente d'un adversaire)."
      );
      return;
    }

    const turnColor = game.chess.turn() === "w" ? "white" : "black";

    if (game.timeLeft[turnColor] <= 0) {
      game.timeLeft[turnColor] = 0;
      game.winner = turnColor === "white" ? "black" : "white";
      io.to(gameId).emit("gameOver", {
        winner: game.winner,
        reason: "timeout",
      });
      return;
    }

    // Vérifie que c'est bien son tour
    if (game.players[turnColor] !== clientId) {
      io.to(socket.id).emit("errorMsg", "Ce n'est pas ton tour.");
      return;
    }

    // Met à jour le chrono
    const now = Date.now();
    if (game.lastUpdate !== null) {
      const elapsed = Math.floor((now - game.lastUpdate) / 1000);
      game.timeLeft[turnColor] -= elapsed;
      if (game.timeLeft[turnColor] <= 0) {
        game.timeLeft[turnColor] = 0;
        game.winner = turnColor === "white" ? "black" : "white";
        io.to(gameId).emit("gameOver", {
          winner: game.winner,
          reason: "timeout",
        });
        return;
      }
    }

    const move = { from, to, ...(promotion ? { promotion } : {}) };
    const result = game.chess.move(move);
    if (!result) {
      io.to(socket.id).emit("errorMsg", "Coup illégal.");
      return;
    }

    // ✅ on ajoute ce coup dans l'historique
    game.history.push(result);

    game.lastUpdate = now;
    io.to(gameId).emit("update", {
      fen: game.chess.fen(),
      last: result,
      timeLeft: game.timeLeft,
      started: game.started,
      history: game.history,
    });

    if (game.chess.isGameOver()) {
      if (game.chess.isCheckmate()) {
        game.winner = result.color === "w" ? "white" : "black";
        io.to(gameId).emit("gameOver", {
          winner: game.winner,
          reason: "checkmate",
        });
      } else {
        game.winner = "draw";
        io.to(gameId).emit("gameOver", {
          winner: null,
          reason: "draw",
        });
      }
    }
  });

  // Timeout déclenché côté client
  socket.on("timeout", ({ gameId, clientId }) => {
    const game = games.get(gameId);
    if (!game || !game.started) return;

    const turnColor = game.chess.turn() === "w" ? "white" : "black";
    if (game.players[turnColor] !== clientId) return;

    const now = Date.now();
    const elapsed = Math.floor((now - (game.lastUpdate || now)) / 1000);
    game.timeLeft[turnColor] -= elapsed;
    if (game.timeLeft[turnColor] <= 0) {
      game.timeLeft[turnColor] = 0;
      game.winner = turnColor === "white" ? "black" : "white";
      io.to(gameId).emit("gameOver", {
        winner: game.winner,
        reason: "timeout",
      });
      return;
    }

    game.lastUpdate = now;
    io.to(gameId).emit("update", {
      fen: game.chess.fen(),
      timeLeft: game.timeLeft,
      started: game.started,
      history: game.history,
    });
  });


  // Chat: envoi de message
  socket.on("chatMessage", ({ gameId, clientId, message, image }) => {
    const game = games.get(gameId);
    if (!game) return;

    const participant = game.participants.get(clientId);
    if (!participant) return;

    const chatMsg = {
      id: uuidv4(),
      clientId,
      name: participant.name,
      role: participant.role,
      message: message ? message.trim() : undefined,
      image: image || undefined,
      timestamp: Date.now(),
    };

    game.chatMessages.push(chatMsg);

    // Limiter l'historique à 100 messages
    if (game.chatMessages.length > 100) {
      game.chatMessages.shift();
    }

    io.to(gameId).emit("chatMessage", chatMsg);
  });

  // Chat: indicateur de saisie
  socket.on("chatTyping", ({ gameId, clientId, isTyping }) => {
    const game = games.get(gameId);
    if (!game) return;

    const participant = game.participants.get(clientId);
    if (!participant) return;

    socket.to(gameId).emit("chatTyping", {
      clientId,
      name: participant.name,
      isTyping,
    });
  });

  socket.on("disconnect", () => {
    // Gérer la déconnexion d'un participant
    for (const [gameId, game] of games.entries()) {
      for (const [clientId, participant] of game.participants.entries()) {
        if (participant.socketId === socket.id) {
          game.participants.delete(clientId);
          io.to(gameId).emit("participantLeft", {
            clientId,
            name: userNames.get(clientId) || clientId.slice(0, 8),
          });
          break;
        }
      }
    }
  });

});


/* --------- Lancement serveur --------- */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur prêt : http://localhost:${PORT}`);
});