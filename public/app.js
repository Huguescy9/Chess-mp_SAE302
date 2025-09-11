/* global Chess, io */

/*
  app.js – frontend
  - affiche coordonnage adaptatif (blanc/noir)
  - historique en tableau Blancs / Noirs
  - consomme `history` envoyé par le serveur
  - chat en direct
*/

const socket = io();

// clientId persistant
const clientId = (() => {
  const k = "clientId";
  let v = localStorage.getItem(k);
  if (!v) {
    v = (crypto.randomUUID ? crypto.randomUUID() : "client-" + Math.random().toString(36).slice(2));
    localStorage.setItem(k, v);
  }
  return v;
})();

// Nom d'utilisateur
const userName = (() => {
  const k = "userName";
  let v = localStorage.getItem(k);
  if (!v) {
    v = prompt("Entrez votre nom d'utilisateur:") || `Joueur${Math.floor(Math.random() * 1000)}`;
    localStorage.setItem(k, v);
  }
  return v;
})();

let gameId = null;
let role = "spectator"; // "white" | "black" | "spectator"
const game = new Chess();

let fullHistory = []; // tableau complet des coups envoyés par le serveur

// État du chat
let participants = [];
let typingTimeout = null;
let chatOpen = false;
let unreadMessages = 0;

// UI refs
const ui = {
  board: document.getElementById("board"),
  status: document.getElementById("status"),
  me: document.getElementById("me"),
  role: document.getElementById("role"),
  logBody: document.querySelector("#log tbody"),
  chatMessages: document.getElementById("chat-messages"),
  chatInput: document.getElementById("chat-input"),
  chatSend: document.getElementById("chat-send"),
  chatImageBtn: document.getElementById("chat-image-btn"),
  chatImageInput: document.getElementById("chat-image-input"),
  participantsList: document.getElementById("participants"),
  typingIndicator: document.getElementById("typing-indicator"),
  chatPanel: document.getElementById("chat-panel"),
  chatToggle: document.getElementById("chat-toggle"),
  chatClose: document.getElementById("chat-close"),
  chatNotification: document.getElementById("chat-notification"),
};

// ✅ GIFs via GIPHY (proxy serveur, la clé API reste dans .env)

// UI refs pour GIF
ui.gifBtn = document.getElementById("chat-gif-btn");
ui.gifPicker = document.getElementById("gif-picker");
ui.gifSearch = document.getElementById("gif-search");
ui.gifGrid = document.getElementById("gif-grid");

let gifPickerOpen = false;
let gifSearchTimeout = null;

const modal = document.getElementById("winner-modal");
const winnerText = document.getElementById("winner-text");
if (modal) {
  modal.addEventListener("click", e => { if (e.target === modal) modal.classList.add("hidden"); });
}

if (ui.me) {
  ui.me.textContent = `${userName} (${clientId.slice(0, 8)})`;
  
  // Ajouter un bouton pour changer de pseudo
  const changeNameBtn = document.createElement("button");
  changeNameBtn.textContent = "✏️ Changer";
  changeNameBtn.style.cssText = "margin-left: 8px; padding: 4px 8px; font-size: 11px;";
  changeNameBtn.onclick = () => {
    const newName = prompt("Nouveau nom d'utilisateur:", userName);
    if (newName && newName.trim()) {
      localStorage.setItem("userName", newName.trim());
      window.location.reload();
    }
  };
  ui.me.appendChild(changeNameBtn);
}

// état sélection
let selected = null;
let legalTargets = new Set();
let lastMoveSquares = [];

// helpers UI
const PIECES = { p:"♟", r:"♜", n:"♞", b:"♝", q:"♛", k:"♚", P:"♙", R:"♖", N:"♘", B:"♗", Q:"♕", K:"♔" };
function pieceChar(p){ return p ? PIECES[p] || "" : ""; }
function turnColor(){ return game.turn() === "w" ? "white" : "black"; }
function isMyTurn(){ return role !== "spectator" && role === turnColor(); }

/* --------- rendu plateau --------- */

function render() {
  if (!ui.board) return;
  
  ui.board.innerHTML = "";

  if (role === "black") {
    ui.board.classList.add("board-black");
  } else {
    ui.board.classList.remove("board-black");
  }

  // obtenir les rangs FEN
  const fenRows = game.fen().split(" ")[0].split("/");

  for (let y = 0; y < 8; y++) {
    const row = fenRows[y];
    let x = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        const n = parseInt(ch, 10);
        for (let i = 0; i < n; i++) mountSquare(x++, y, "");
      } else {
        mountSquare(x++, y, ch);
      }
    }
  }

  //Changement de couleur du rôle
  if (ui.role) {
    if (role === "white") {
      ui.role.textContent = "♔ Vous jouez les Blancs";
      ui.role.className = "clock white";
    } else if (role === "black") {
      ui.role.textContent = "♚ Vous jouez les Noirs";
      ui.role.className = "clock black";
    } else {
      ui.role.textContent = "Spectateur";
      ui.role.className = "clock white";
    }
  }

  if (ui.status) {
    if (!game.game_over()) {
      const color = turnColor();
      const turnClass = color === "white" ? "turn-white" : "turn-black";
      ui.status.innerHTML = `Partie: <b>${gameId ?? "–"}</b> • <span id="turn-indicator" class="${turnClass}">
        Tour des ${color === "white" ? "Blancs" : "Noirs"}
      </span>`;
    } else {
      ui.status.innerHTML = `Partie: <b>${gameId ?? "–"}</b>`;
    }
  }
}

// convertit coordonnées internes (x,y) -> nom case 'a1'
function coordToSquare(x, y) {
  return String.fromCharCode(97 + x) + (8 - y);
}

function mountSquare(x, y, piece) {
  const div = document.createElement("div");
  div.className = "square " + ((x + y) % 2 === 0 ? "light" : "dark");
  const sq = coordToSquare(x, y);
  div.dataset.square = sq;
  div.textContent = pieceChar(piece);

  // --- COORD LABELS CORRECTES SELON ORIENTATION --
  if (role === "black") {
    if (y === 0) {
      div.classList.add("file");
      div.dataset.file = String.fromCharCode(97 + x);
    }
    if (x === 7) {
      div.classList.add("rank");
      div.dataset.rank = String(8 - y);
    }
  } else {
    if (y === 7) {
      div.classList.add("file");
      div.dataset.file = String.fromCharCode(97 + x);
    }
    if (x === 0) {
      div.classList.add("rank");
      div.dataset.rank = String(8 - y);
    }
  }

  // highlights & hints
  if (selected === sq) div.classList.add("selected");
  if (legalTargets.has(sq)) div.classList.add("hint");
  if (lastMoveSquares && lastMoveSquares.includes(sq)) div.classList.add("last-move");

  div.addEventListener("click", () => onSquareClick(sq));
  ui.board.appendChild(div);
}

/* --------- historique (tableau 2 colonnes) --------- */
function updateHistory(historyArray) {
  if (!ui.logBody) return;
  
  ui.logBody.innerHTML = "";

  if (!Array.isArray(historyArray) || historyArray.length === 0) return;

  for (let i = 0; i < historyArray.length; i += 2) {
    const moveNumber = Math.floor(i / 2) + 1;
    const whiteMove = historyArray[i] ? (historyArray[i].san || `${historyArray[i].from}-${historyArray[i].to}`) : "";
    const blackMove = historyArray[i + 1] ? (historyArray[i + 1].san || `${historyArray[i+1].from}-${historyArray[i+1].to}`) : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${moveNumber}</td><td>${escapeHtml(whiteMove)}</td><td>${escapeHtml(blackMove)}</td>`;
    ui.logBody.appendChild(tr);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/[&<>"']/g, s => ( {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s] ))
    .replace(/\n/g, '<br>'); // Convertir les retours à la ligne en <br>
}

// Extraire l'ID YouTube depuis une URL
function extractYoutubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
    /youtube\.com\/shorts\/([^&\s?]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

// Détecter et remplacer les liens YouTube par une miniature cliquable
function processYoutubeLinks(text) {
  if (!text) return "";
  
  const youtubeRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)[\w-]+(?:[^\s]*)?)/gi;
  
  return text.replace(youtubeRegex, (match) => {
    const videoId = extractYoutubeId(match);
    if (!videoId) return match;
    
    // ✅ Version avec image YouTube + fallback placeholder
    return `<div class="youtube-embed youtube-preview" data-video-id="${videoId}">
      <div class="youtube-thumbnail-wrapper">
        <img 
          src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" 
          alt="Miniature YouTube"
          loading="lazy"
          class="youtube-thumbnail-img"
          onerror="this.parentElement.innerHTML='<div class=\\'youtube-placeholder-simple\\'><div class=\\'play-icon\\'>▶</div><div class=\\'play-text\\'>Cliquer pour lire la vidéo</div></div>'"
        />
        <div class="youtube-play-button">▶</div>
      </div>
    </div>`;
  });
}

// Gérer le clic sur une miniature YouTube
function handleYoutubeClick(event) {
  const preview = event.target.closest('.youtube-preview');
  if (!preview) return;
  
  const videoId = preview.dataset.videoId;
  if (!videoId) return;
  
  // ✅ Empêcher les clics multiples
  if (preview.classList.contains('loading')) return;
  preview.classList.add('loading');
  
  // ✅ Remplacer la miniature par l'iframe (uniquement pour ce client)
  preview.innerHTML = `
    <iframe 
      src="https://www.youtube.com/embed/${videoId}?autoplay=1" 
      frameborder="0" 
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
      allowfullscreen
      loading="lazy"
    ></iframe>
  `;
  
  preview.classList.remove('youtube-preview');
  preview.classList.remove('loading');
}

// Écouter les clics sur les miniatures YouTube
document.addEventListener('click', handleYoutubeClick);

/* --------- TIMER (client-side) --------- */

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function updateClocks(white, black) {
  const elW = document.getElementById("time-white");
  const elB = document.getElementById("time-black");
  if (elW) elW.textContent = formatTime(white);
  if (elB) elB.textContent = formatTime(black);
}

let localTimers = { white: 0, black: 0 };
let tickInterval = null;

function stopLocalTimer() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function startLocalTimer(serverTimeLeft) {
  localTimers = { white: serverTimeLeft.white, black: serverTimeLeft.black };
  updateClocks(localTimers.white, localTimers.black);

  stopLocalTimer();
  tickInterval = setInterval(() => {
    const current = turnColor();
    if (localTimers[current] > 0) {
      localTimers[current] -= 1;
      updateClocks(localTimers.white, localTimers.black);

      if (localTimers[current] <= 0) {
        stopLocalTimer();
        socket.emit("timeout", { gameId, clientId });
      }
    }
  }, 1000);
}

/* --------- interactions plateau (click / move) --------- */

function onSquareClick(sq) {
  if (role === "spectator") return;

  if (!selected) {
    const p = game.get(sq);
    if (!p) return;
    const isMine = (role === "white" && p.color === "w") || (role === "black" && p.color === "b");
    if (!isMine) return;
    if (!isMyTurn()) { logLocal("Pas ton tour."); return; }
    selected = sq;
    legalTargets = new Set(game.moves({ square: sq, verbose: true }).map(m => m.to));
    render();
    return;
  }

  if (selected === sq) {
    selected = null;
    legalTargets.clear();
    render();
    return;
  }

  if (!legalTargets.has(sq)) {
    const p = game.get(sq);
    if (p) {
      const isMine = (role === "white" && p.color === "w") || (role === "black" && p.color === "b");
      if (isMine) {
        selected = sq;
        legalTargets = new Set(game.moves({ square: sq, verbose: true }).map(m => m.to));
        render();
      }
    }
    return;
  }

  const from = selected;
  const to = sq;
  let promotion = undefined;
  const isWhite = role === "white";
  if ((isWhite && from[1] === "7" && to[1] === "8") || (!isWhite && from[1] === "2" && to[1] === "1")) promotion = "q";

  stopLocalTimer();
  socket.emit("move", { gameId, clientId, from, to, promotion });
  selected = null;
  legalTargets.clear();
  render();
}

function logLocal(line) {
  if (!ui.status) return;
  ui.status.textContent = line;
  setTimeout(() => {
    if (ui.status) {
      ui.status.innerHTML = `Partie: <b>${gameId ?? "–"}</b>`;
    }
  }, 1200);
}

/* --------- CHAT EN DIRECT --------- */

/* --------- CHAT EN DIRECT --------- */

// Gestion du panneau de chat rétractable
function toggleChat() {
  chatOpen = !chatOpen;
  if (ui.chatPanel) {
    ui.chatPanel.classList.toggle("open", chatOpen);
  }
  
  // Réinitialiser les notifications (à l'ouverture ou à la fermeture, on a vu les messages)
  unreadMessages = 0;
  updateChatNotification();
  
  // Focus sur l'input si on ouvre le chat
  if (chatOpen && ui.chatInput) {
    setTimeout(() => ui.chatInput.focus(), 300);
  }
}

function updateChatNotification() {
  if (!ui.chatNotification) return;
  
  if (unreadMessages > 0) {
    ui.chatNotification.textContent = unreadMessages > 99 ? '99+' : unreadMessages;
    ui.chatNotification.classList.remove("hidden");
  } else {
    ui.chatNotification.classList.add("hidden");
  }
}

// Event listeners pour les boutons du chat
if (ui.chatToggle) {
  ui.chatToggle.addEventListener("click", toggleChat);
}

if (ui.chatClose) {
  ui.chatClose.addEventListener("click", toggleChat);
}

// Fermer le chat avec la touche Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && chatOpen) {
    toggleChat();
  }
});

/* --------- Redimensionnement du chat --------- */
let isResizing = false;
let startX = 0;
let startWidth = 0;

// Récupérer la largeur sauvegardée
const savedChatWidth = localStorage.getItem('chatWidth');
if (savedChatWidth && ui.chatPanel) {
  ui.chatPanel.style.width = savedChatWidth + 'px';
}

const resizeHandle = document.querySelector('.chat-resize-handle');
if (resizeHandle && ui.chatPanel) {
  // Simple clic pour fermer le chat
  resizeHandle.addEventListener('dblclick', (e) => {
    if (!isResizing && chatOpen) {
      toggleChat();
    }
  });

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = ui.chatPanel.offsetWidth;
    ui.chatPanel.classList.add('resizing');
    resizeHandle.classList.add('active');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const deltaX = startX - e.clientX;
    const newWidth = Math.max(startWidth + deltaX, 300);
    ui.chatPanel.style.width = newWidth + 'px';
  });
  
  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      ui.chatPanel.classList.remove('resizing');
      resizeHandle.classList.remove('active');
      
      // Sauvegarder la nouvelle largeur
      const currentWidth = ui.chatPanel.offsetWidth;
      localStorage.setItem('chatWidth', currentWidth);
    }
  });
}

// Mettre à jour la liste des participants
function updateParticipants(participantsList) {
  if (!ui.participantsList) return;
  
  participants = participantsList || [];
  ui.participantsList.innerHTML = "";
  
  participants.forEach(p => {
    const badge = document.createElement("span");
    badge.className = `participant ${p.role}`;
    
    // Icône selon le rôle
    let icon = '👁️';
    if (p.role === 'white') icon = '♔';
    else if (p.role === 'black') icon = '♚';
    
    // Indicateur si c'est moi
    const isMe = p.id === clientId;
    badge.textContent = `${icon} ${p.name}${isMe ? ' (moi)' : ''}`;
    
    ui.participantsList.appendChild(badge);
  });
}

// Ajouter un message au chat
function addChatMessage(msg, isSystem = false) {
  if (!ui.chatMessages) return;
  
  // ✅ Éviter les doublons (au cas où le même message arrive 2 fois)
  if (msg.id && document.querySelector(`[data-msg-id="${msg.id}"]`)) {
    console.log("Message déjà affiché, ignoré:", msg.id);
    return;
  }
  
  const div = document.createElement("div");
  div.className = `chat-message ${isSystem ? 'system' : msg.role}`;
  
  // ✅ Ajouter un ID unique au message
  if (msg.id) {
    div.dataset.msgId = msg.id;
  }
  
  if (isSystem) {
    div.innerHTML = `<div class="chat-message-text">${escapeHtml(msg.text)}</div>`;
  } else {
    const time = new Date(msg.timestamp).toLocaleTimeString('fr-FR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    let content = '';
    if (msg.message) {
      // Traiter les liens YouTube
      const processedMessage = processYoutubeLinks(escapeHtml(msg.message));
      content += `<div class="chat-message-text">${processedMessage}</div>`;
    }
    if (msg.image) {
      content += `<img src="${msg.image}" class="chat-message-image" alt="Image partagée" onclick="viewImageFullscreen(this.src)">`;
    }
    
    div.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-message-author">${escapeHtml(msg.name)}</span>
        <span class="chat-message-time">${time}</span>
      </div>
      ${content}
    `;
  }
  
  ui.chatMessages.appendChild(div);
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;

  // Incrémenter les notifications si le chat est fermé, que ce n'est pas un message système, et que ce n'est pas notre message
  if (!chatOpen && !isSystem && msg.clientId && msg.clientId !== clientId) {
    unreadMessages++;
    updateChatNotification();
  }
}

// Charger l'historique des messages
function loadChatHistory(messages) {
  if (!ui.chatMessages) return;
  
  ui.chatMessages.innerHTML = "";
  if (Array.isArray(messages)) {
    messages.forEach(msg => {
      const div = document.createElement("div");
      div.className = `chat-message ${msg.role}`;
      
      const time = new Date(msg.timestamp).toLocaleTimeString('fr-FR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      let content = '';
      if (msg.message) {
        content += `<div class="chat-message-text">${escapeHtml(msg.message)}</div>`;
      }
      if (msg.message) {
        // Traiter les liens YouTube
        const processedMessage = processYoutubeLinks(escapeHtml(msg.message));
        content += `<div class="chat-message-text">${processedMessage}</div>`;
      }
      
      div.innerHTML = `
        <div class="chat-message-header">
          <span class="chat-message-author">${escapeHtml(msg.name)}</span>
          <span class="chat-message-time">${time}</span>
        </div>
        ${content}
      `;
      
      ui.chatMessages.appendChild(div);
    });
    ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
  }
}

// Envoyer un message
function sendChatMessage() {
  if (!ui.chatInput) return;
  
  const message = ui.chatInput.value.trim();
  if (!message || !gameId) return;
  
  socket.emit("chatMessage", { gameId, clientId, message });
  ui.chatInput.value = "";
  ui.chatInput.style.height = "40px";
  
  // Arrêter l'indicateur de saisie
  socket.emit("chatTyping", { gameId, clientId, isTyping: false });
}

// Envoyer une image
function sendChatImage(imageData) {
  if (!imageData || !gameId) return;
  
  socket.emit("chatMessage", { 
    gameId, 
    clientId, 
    image: imageData,
    message: ""
  });
}

// Gérer la saisie (indicateur)
function handleTyping() {
  if (!gameId) return;
  
  socket.emit("chatTyping", { gameId, clientId, isTyping: true });
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("chatTyping", { gameId, clientId, isTyping: false });
  }, 1000);
}

// Initialiser les événements du chat si les éléments existent
if (ui.chatInput) {
  // Auto-resize du textarea
  ui.chatInput.addEventListener("input", () => {
    ui.chatInput.style.height = "40px";
    ui.chatInput.style.height = Math.min(ui.chatInput.scrollHeight, 100) + "px";
    
    // Détecter la commande /gif
    const value = ui.chatInput.value;
    if (value === '/gif') {
      ui.chatInput.value = ''; // Effacer la commande
      if (!gifPickerOpen) {
        toggleGifPicker(); // Ouvrir le GIF picker
      }
    } else {
      handleTyping();
    }
  });

  // Envoyer avec Entrée
  ui.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

// Bouton envoyer
if (ui.chatSend) {
  ui.chatSend.addEventListener("click", sendChatMessage);
}

// Fonction pour traiter un fichier image
function processImageFile(file) {
  if (!file) return;

  // Vérifier que c'est une image
  if (!file.type.startsWith("image/")) {
    alert("Veuillez sélectionner une image");
    return;
  }

  // Limiter la taille à 5MB
  if (file.size > 5 * 1024 * 1024) {
    alert("L'image est trop grande (max 5MB)");
    return;
  }

  // Convertir en base64
  const reader = new FileReader();
  reader.onload = (event) => {
    sendChatImage(event.target.result);
    if (ui.chatImageInput) ui.chatImageInput.value = "";
  };
  reader.onerror = () => {
    alert("Erreur lors de la lecture de l'image");
  };
  reader.readAsDataURL(file);
}

// Afficher l'image en plein écran
function viewImageFullscreen(imageSrc) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.95);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
    animation: fadeIn 0.2s ease;
  `;
  
  const img = document.createElement('img');
  img.src = imageSrc;
  img.style.cssText = `
    max-width: 95%;
    max-height: 95%;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
  `;
  
  overlay.appendChild(img);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  
  // Fermer en cliquant n'importe où
  overlay.onclick = () => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  
  // Fermer avec Échap
  const closeOnEsc = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', closeOnEsc);
    }
  };
  document.addEventListener('keydown', closeOnEsc);
}

// Bouton image
if (ui.chatImageBtn && ui.chatImageInput) {
  ui.chatImageBtn.addEventListener("click", () => {
    ui.chatImageInput.click();
  });

  ui.chatImageInput.addEventListener("change", (e) => {
    processImageFile(e.target.files[0]);
  });
}

// Coller des images depuis le presse-papier (Ctrl+V)
document.addEventListener("paste", (e) => {
  if (!chatOpen) return;
  
  const items = e.clipboardData?.items;
  if (!items) return;
  
  // Chercher une image dans le presse-papier
  let imageFound = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith("image/")) {
      e.preventDefault();
      e.stopPropagation();
      const file = items[i].getAsFile();
      processImageFile(file);
      imageFound = true;
      
      // Focus sur le chat après collage
      if (ui.chatInput && e.target !== ui.chatInput) {
        ui.chatInput.focus();
      }
      break;
    }
  }
  
  if (imageFound && e.target === ui.chatInput) {
    e.preventDefault();
  }
});

/* --------- GESTION DES GIFs --------- */

// Toggle du sélecteur de GIFs
function toggleGifPicker() {
  gifPickerOpen = !gifPickerOpen;
  
  if (ui.gifPicker) {
    ui.gifPicker.classList.toggle("hidden", !gifPickerOpen);
  }
  
  if (ui.gifBtn) {
    ui.gifBtn.classList.toggle("active", gifPickerOpen);
  }
  
  if (gifPickerOpen) {
    loadTrendingGifs();
    if (ui.gifSearch) {
      setTimeout(() => ui.gifSearch.focus(), 100);
    }
  }
}

// Charger les GIFs tendances
async function loadTrendingGifs() {
  if (!ui.gifGrid) return;
  
  ui.gifGrid.innerHTML = '<div class="gif-loading">Chargement des GIFs...</div>';
  
  try {
    const response = await fetch("/api/gifs/trending");

    if (!response.ok) throw new Error("Erreur API GIPHY");

    const gifs = await response.json();
    displayGifs(gifs);
  } catch (error) {
    console.error("Erreur lors du chargement des GIFs:", error);
    ui.gifGrid.innerHTML = '<div class="gif-error">Impossible de charger les GIFs</div>';
  }
}

// Rechercher des GIFs
async function searchGifs(query) {
  if (!ui.gifGrid || !query.trim()) {
    loadTrendingGifs();
    return;
  }
  
  ui.gifGrid.innerHTML = '<div class="gif-loading">Recherche...</div>';
  
  try {
    const response = await fetch(`/api/gifs/search?q=${encodeURIComponent(query)}`);

    if (!response.ok) throw new Error("Erreur API GIPHY");

    const gifs = await response.json();

    if (gifs.length === 0) {
      ui.gifGrid.innerHTML = '<div class="gif-error">Aucun GIF trouvé</div>';
      return;
    }

    displayGifs(gifs);
  } catch (error) {
    console.error("Erreur lors de la recherche:", error);
    ui.gifGrid.innerHTML = '<div class="gif-error">Erreur de recherche</div>';
  }
}

// Afficher les GIFs dans la grille
function displayGifs(gifs) {
  if (!ui.gifGrid) return;
  
  ui.gifGrid.innerHTML = "";
  
  gifs.forEach(gif => {
    const gifItem = document.createElement("div");
    gifItem.className = "gif-item";
    
    // Petite version pour la preview, version "downsized" pour l'envoi
    const img = document.createElement("img");
    img.src = gif.preview;
    img.alt = gif.title || "GIF";
    img.loading = "lazy";
    gifItem.appendChild(img);

    gifItem.onclick = () => {
      sendGif(gif.url);
      toggleGifPicker();
    };
    
    ui.gifGrid.appendChild(gifItem);
  });

  // Attribution obligatoire GIPHY
  const attribution = document.createElement("div");
  attribution.className = "gif-attribution";
  attribution.textContent = "Powered by GIPHY";
  ui.gifGrid.appendChild(attribution);
}

// Envoyer un GIF
function sendGif(gifUrl) {
  if (!gifUrl || !gameId) return;
  
  socket.emit("chatMessage", { 
    gameId, 
    clientId, 
    image: gifUrl,
    message: ""
  });
}

// Initialiser les événements GIF
if (ui.gifBtn) {
  ui.gifBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleGifPicker();
  });
}

if (ui.gifSearch) {
  ui.gifSearch.addEventListener("input", (e) => {
    const query = e.target.value;
    
    clearTimeout(gifSearchTimeout);
    gifSearchTimeout = setTimeout(() => {
      searchGifs(query);
    }, 500);
  });
  
  ui.gifSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchGifs(e.target.value);
    }
  });
}

// Fermer le sélecteur GIF en cliquant ailleurs
document.addEventListener("click", (e) => {
  if (gifPickerOpen && 
      ui.gifPicker && 
      !ui.gifPicker.contains(e.target) && 
      e.target !== ui.gifBtn) {
    toggleGifPicker();
  }
});

/* --------- Socket events --------- */

socket.on("connect", () => {
  // rien d'automatique ; join via REST
});

socket.on("update", ({ fen, last, role: r, timeLeft, started, history, chatMessages, participants: participantsList }) => {
  if (r) role = r;

  if (fen) {
    game.load(fen);
  }

  // highlight last move squares if 'last' provided
  if (last && last.from && last.to) {
    lastMoveSquares = [last.from, last.to];
  } else {
    lastMoveSquares = [];
  }

  if (Array.isArray(history)) {
    updateHistory(history);
    fullHistory = history;
  } else {
    const h = game.history({ verbose: true }) || [];
    updateHistory(h);
  }

  // Charger les messages du chat
  if (Array.isArray(chatMessages)) {
    loadChatHistory(chatMessages);
  }

  // Mettre à jour les participants
  if (Array.isArray(participantsList)) {
    updateParticipants(participantsList);
  }

  render();

  if (timeLeft) {
    updateClocks(timeLeft.white, timeLeft.black);
    stopLocalTimer();
    if (started) startLocalTimer(timeLeft);
  }
});

socket.on("errorMsg", (m) => {
  logLocal("⚠️ " + m);
  if (ui.status) {
    ui.status.textContent = "⚠️ " + m;
    setTimeout(() => { 
      if (ui.status) {
        ui.status.innerHTML = `Partie: <b>${gameId ?? "–"}</b>`;
      }
    }, 1500);
  }
});

socket.on("gameOver", ({ winner, reason }) => {
  let txt = "";
  if (reason === "checkmate") {
    txt = winner === "white" ? "Les Blancs gagnent par échec et mat !" : "Les Noirs gagnent par échec et mat !";
  } else if (reason === "timeout") {
    txt = winner === "white" ? "Les Blancs gagnent au temps !" : "Les Noirs gagnent au temps !";
  } else if (reason === "draw") {
    txt = "Partie nulle";
  } else {
    txt = winner ? `${winner === "white" ? "Blancs" : "Noirs"} gagne (${reason})` : `Partie nulle (${reason})`;
  }
  
  if (winnerText) winnerText.textContent = txt;
  if (modal) modal.classList.remove("hidden");
  stopLocalTimer();
});

/* --------- Socket events pour le chat --------- */

socket.on("chatMessage", (msg) => {
  addChatMessage(msg);
});

socket.on("participantJoined", ({ name, role }) => {
  addChatMessage({ text: `${name} a rejoint la partie (${role})` }, true);
});

socket.on("participantLeft", ({ name }) => {
  addChatMessage({ text: `${name} a quitté la partie` }, true);
});

socket.on("chatTyping", ({ name, isTyping }) => {
  if (!ui.typingIndicator) return;
  
  // Ne pas afficher si c'est nous qui tapons
  if (name === userName) return;
  
  if (isTyping) {
    ui.typingIndicator.textContent = `${name} est en train d'écrire...`;
    ui.typingIndicator.classList.remove("hidden");
  } else {
    ui.typingIndicator.textContent = "";
    ui.typingIndicator.classList.add("hidden");
  }
});

/* --------- join logic (via REST then socket join) --------- */

async function joinGame(id) {
  try {
    const r = await fetch(`/api/games/${id}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId })
    });
    const data = await r.json();
    if (data.error) { alert(data.error); return; }
    gameId = data.gameId;
    role = data.color;
    if (ui.status) {
      ui.status.textContent = `Rejoint ${gameId} – tu es ${role}`;
    }

    if (Array.isArray(data.history)) {
      updateHistory(data.history);
    }

    render();
    socket.emit("joinGame", { gameId, clientId, userName });
  } catch (e) {
    console.error(e);
    alert("Impossible de rejoindre la partie");
  }
}

/* auto-join via param ?id= */
(function(){
  const params = new URLSearchParams(window.location.search);
  const gid = params.get("id");
  if (gid) joinGame(gid);
})();

/* init */
render();
console.log(`Client prêt: ${userName} (${clientId.slice(0,8)})`);

/* --------- Télécharger PGN --------- */
function downloadPGN() {
  // Création des métadonnées PGN standard
  const headers = [
    `[Event "Échecs multijoueur"]`,
    `[Site "MonSiteWeb"]`,
    `[Date "${new Date().toISOString().slice(0, 10)}"]`,
    `[Round "-"]`,
    `[White "${game.whiteName || "Blanc"}"]`,
    `[Black "${game.blackName || "Noir"}"]`,
    `[Result "${game.result || "*"}"]`
  ].join("\n");

  // Récupération des coups depuis fullHistory (envoyé par le serveur)
  let moveText = "";
  for (let i = 0; i < fullHistory.length; i++) {
    if (i % 2 === 0) moveText += `${Math.floor(i / 2) + 1}. `;
    moveText += fullHistory[i].san + " ";
  }

  const pgn = headers + "\n\n" + moveText.trim();

  // Téléchargement du fichier
  const blob = new Blob([pgn], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "partie.pgn";
  a.click();
  URL.revokeObjectURL(url);
}

// branchement du bouton
const btnDownloadPGN = document.getElementById("btn-download-pgn");
if (btnDownloadPGN) {
  btnDownloadPGN.addEventListener("click", downloadPGN);
}