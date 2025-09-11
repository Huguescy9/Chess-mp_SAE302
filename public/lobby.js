// IIFE pour encapsuler
(() => {
  function getClientId() {
    const k = "clientId";
    let v = localStorage.getItem(k);
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID() : "client-" + Math.random().toString(36).slice(2));
      localStorage.setItem(k, v);
    }
    return v;
  }
  const clientId = getClientId();

  async function loadGames() {
    const container = document.getElementById("games-cards");
    container.innerHTML = "";
    try {
      const res = await fetch("/api/games/list");
      const games = await res.json();

      games.forEach((g) => {
        const card = document.createElement("div");
        card.className = "card";

        let winnerHtml = "—";
        if (g.winner === "white") winnerHtml = `<span class="winner-white">Blanc</span>`;
        else if (g.winner === "black") winnerHtml = `<span class="winner-black">Noir</span>`;
        else if (g.winner === "draw") winnerHtml = `<span class="winner-draw">Nulle</span>`;

        card.innerHTML = `
          <h3>Partie #${g.id}</h3>
          <p>Blanc: ${g.white ? "✅" : "—"}</p>
          <p>Noir: ${g.black ? "✅" : "—"}</p>
          <p>Vainqueur: ${winnerHtml}</p>
          <button onclick="joinGame('${g.id}')">Rejoindre</button>
        `;

        if (g.whiteClientId === clientId || g.blackClientId === clientId) {
          card.style.border = "2px solid #10b981";
        }

        container.appendChild(card);
      });
    } catch (err) {
      console.error("Erreur chargement games:", err);
      alert("Impossible de charger les parties.");
    }
  }

  async function createGame() {
    const time = parseInt(document.getElementById("time-select").value, 10);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, time }),
      });
      const data = await res.json();
      if (data.error) return alert(data.error);
      window.location.href = `game.html?id=${data.gameId}`;
    } catch (e) {
      console.error(e);
      alert("Impossible de créer la partie.");
    }
  }

  window.joinGame = function(id) {
    if (!id) return alert("Veuillez entrer un ID de partie.");
    window.location.href = `game.html?id=${id}`;
  };

  document.getElementById("btn-refresh").addEventListener("click", loadGames);
  document.getElementById("btn-new").addEventListener("click", createGame);
  document.getElementById("btn-join").addEventListener("click", () => {
    const id = document.getElementById("join-id").value.trim();
    window.joinGame(id);
  });

  window.addEventListener("DOMContentLoaded", loadGames);
})();
