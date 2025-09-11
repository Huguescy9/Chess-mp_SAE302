<div align="center">

# Chess Online

**Échecs multijoueur en temps réel dans le navigateur**

[![Node.js](https://img.shields.io/badge/Node.js-20+-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socketdotio&logoColor=white)](https://socket.io)
[![chess.js](https://img.shields.io/badge/chess.js-1.0-769656)](https://github.com/jhlywa/chess.js)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/fr/docs/Web/JavaScript)
[![GIPHY](https://img.shields.io/badge/API-GIPHY-FF6666?logo=giphy&logoColor=white)](https://developers.giphy.com)

[Fonctionnalités](#fonctionnalités) · [Installation](#installation) · [API](#api) · [Limites](#limites-et-pistes-damélioration)

</div>

---

Plateforme web pour jouer aux échecs en ligne, directement dans le navigateur : création et liste des parties dans un lobby, parties en temps réel entre deux joueurs, spectateurs, chat intégré (texte, images, GIFs, emojis) et export/relecture des parties au format **PGN**.

## Fonctionnalités

### Lobby
- Création d'une partie avec choix de la durée par joueur (5, 10, 15 ou 30 minutes, ou mode rapide).
- Liste des parties en cours ou en attente d'un adversaire.
- Rejoindre une partie depuis la liste ou par son identifiant.
- Choix d'un nom d'utilisateur.

### Partie
- Attribution automatique des rôles : **blancs**, **noirs** ou **spectateur**.
- Plateau orienté selon la couleur du joueur, déplacement des pièces au clic.
- **Validation des coups côté serveur** avec `chess.js` (roque, promotion, prise en passant…).
- Synchronisation instantanée des coups via WebSocket (Socket.IO).
- Historique des coups (Blancs / Noirs) et mise en évidence du dernier coup.
- Chronomètre par joueur, géré par le serveur.
- Fin de partie : échec et mat, nulle ou temps écoulé, avec affichage du vainqueur.
- Reconnexion : un joueur qui recharge la page retrouve sa partie et sa couleur.
- **Export PGN** de la partie à tout moment.

### Chat
- Chat en temps réel propre à chaque partie, ouvert aux joueurs et aux spectateurs.
- Envoi de messages, d'images, d'emojis et de **GIFs** (recherche GIPHY, commande `/gif`).
- Indicateur « en train d'écrire ».

### Visionneuse PGN
- Chargement d'un fichier `.pgn` ou collage de son contenu.
- Relecture de la partie coup par coup.
- Un fichier d'exemple est fourni pour tester : [`public/partie.pgn`](public/partie.pgn) (Hikaru – HanSchut, Chess.com, 1er mars 2025).

## Technologies

| Couche | Outils |
|---|---|
| Serveur | Node.js, Express, Socket.IO, chess.js, uuid, cors |
| Client | HTML, CSS, JavaScript (sans framework), Socket.IO client |
| Service externe | API GIPHY (via un proxy serveur, la clé API reste côté serveur) |

## Architecture

```
Navigateur (lobby / partie / visionneuse)
        │  HTTP (API REST)      │  WebSocket (Socket.IO)
        ▼                       ▼
┌──────────────────────────────────────────┐
│ server.js — Express + Socket.IO          │
│  • gestion des parties (en mémoire)      │
│  • validation des coups (chess.js)       │
│  • chronomètres, chat, rooms             │
│  • proxy vers l'API GIPHY                │
└──────────────────────────────────────────┘
```

Les parties sont stockées **en mémoire** : elles sont perdues au redémarrage du serveur.

### Structure du projet

```
chess-mp/
├── server.js            # Serveur Express + Socket.IO
├── package.json         # Dépendances et script de démarrage
├── .env.example         # Modèle de configuration (clé GIPHY)
└── public/              # Client web
    ├── index.html       # Lobby
    ├── lobby.js         # Logique du lobby
    ├── game.html        # Interface de partie
    ├── app.js           # Logique de partie (plateau, chrono, chat, socket)
    ├── viewer.html      # Visionneuse PGN
    ├── partie.pgn       # Partie d'exemple pour la visionneuse
    └── *.css            # Styles (plateau, chat, lobby, visionneuse…)
```

## Installation

### Prérequis

- [Node.js](https://nodejs.org/fr) **20.12 ou plus récent** (le serveur lit le fichier `.env` avec `process.loadEnvFile`)
- npm

### Étapes

1. **Cloner le dépôt**
   ```bash
   git clone https://github.com/Huguescy9/Chess-mp.git
   cd Chess-mp
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Configurer la clé GIPHY** (facultatif, seulement pour les GIFs du chat)
   ```bash
   cp .env.example .env
   ```
   Puis renseignez votre clé, obtenue gratuitement sur [developers.giphy.com](https://developers.giphy.com) :
   ```
   GIPHY_API_KEY=votre_cle
   ```
   Sans clé, le jeu fonctionne normalement : seule la recherche de GIFs est désactivée.

4. **Lancer le serveur**
   ```bash
   npm start
   ```

5. **Ouvrir l'application** : [http://localhost:3000](http://localhost:3000)
   Le port peut être changé avec la variable d'environnement `PORT`.

### Jouer à plusieurs

- **Sur la même machine** : ouvrez un second navigateur ou une fenêtre de navigation privée pour le deuxième joueur.
- **Sur le réseau local** : les autres joueurs se connectent à `http://<IP-du-serveur>:3000`. Sous Windows, autorisez `node.exe` dans le pare-feu (Panneau de configuration → Pare-feu Windows Defender → Applications autorisées, réseaux privé et public).
- Sous Windows, si PowerShell refuse d'exécuter `npm`, autorisez les scripts pour votre utilisateur :
  ```powershell
  Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

## API

### REST

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/games/list` | Liste des parties |
| `POST` | `/api/games` | Créer une partie (`clientId`, `time` en secondes) |
| `POST` | `/api/games/:id/join` | Rejoindre une partie |
| `GET` | `/api/games/:id` | État d'une partie |
| `GET` | `/api/gifs/trending` | GIFs tendances (proxy GIPHY) |
| `GET` | `/api/gifs/search?q=` | Recherche de GIFs (proxy GIPHY) |

### Événements Socket.IO (client → serveur)

| Événement | Rôle |
|---|---|
| `joinGame` | Rejoindre la room d'une partie (joueur ou spectateur) |
| `move` | Jouer un coup (`from`, `to`, `promotion`) |
| `timeout` | Signaler la fin du temps d'un joueur |
| `chatMessage` | Envoyer un message, une image ou un GIF |
| `chatTyping` | Indiquer qu'un participant écrit |

## Limites et pistes d'amélioration

- Pas d'authentification : les joueurs sont identifiés par un identifiant client stocké dans le navigateur.
- Pas de persistance : les parties sont perdues au redémarrage du serveur.
- Pistes : comptes utilisateurs, classement ELO, base de données, mode contre l'IA (Stockfish), déploiement en HTTPS.
