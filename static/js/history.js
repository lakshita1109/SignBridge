// Translation history page.
import { api, $, speak, toast } from "./common.js";

const list = $("#list");
const clearAll = $("#clearAll");

function formatDate(sqliteUtc) {
  const date = new Date(sqliteUtc.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? sqliteUtc : date.toLocaleString();
}

function render(items) {
  list.innerHTML = "";
  clearAll.hidden = items.length === 0;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "card empty";
    empty.textContent = "Nothing saved yet. Use \"Save to history\" on the Translate or Video page.";
    list.appendChild(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "card history-item";

    const info = document.createElement("div");
    const text = document.createElement("div");
    text.className = "history-text";
    text.textContent = item.text;
    const meta = document.createElement("div");
    meta.className = "muted small";
    meta.textContent = `${item.language.toUpperCase()} · ${item.mode} · ${formatDate(item.created_at)}`;
    info.append(text, meta);

    const actions = document.createElement("div");
    actions.className = "btn-row";
    const play = document.createElement("button");
    play.className = "btn btn-sm";
    play.textContent = "🔊 Play";
    play.addEventListener("click", () => speak(item.text));
    const del = document.createElement("button");
    del.className = "btn btn-sm btn-danger";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      try { await api(`/api/history/${item.id}`, { method: "DELETE" }); await load(); }
      catch (err) { toast(err.message); }
    });
    actions.append(play, del);

    card.append(info, actions);
    list.appendChild(card);
  }
}

async function load() {
  try { render(await api("/api/history")); }
  catch (err) { toast(err.message); }
}

clearAll.addEventListener("click", async () => {
  if (!window.confirm("Delete all saved translations?")) return;
  try { await api("/api/history", { method: "DELETE" }); await load(); }
  catch (err) { toast(err.message); }
});

load();