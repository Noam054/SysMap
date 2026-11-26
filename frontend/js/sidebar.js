// The side panel with the tabs.
// Wide screens: always there; the « button shrinks it to icons (remembered in this browser).
// Narrow screens: hidden; the ☰ button slides it in, and choosing a tab (or tapping outside) closes it.
const body = document.body;
const sidebar = document.getElementById("sidebar");
const scrim = document.getElementById("scrim");
const openButton = document.getElementById("open-menu");
const collapseButton = document.getElementById("collapse");
const KEY = "sysmap.sidebar.collapsed";

const store = {
  get: () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } },
  set: (v) => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode: not remembered */ } },
};

function setCollapsed(collapsed) {
  body.classList.toggle("sidebar-collapsed", collapsed);
  collapseButton.setAttribute("aria-label", collapsed ? "Expand the side panel" : "Collapse the side panel");
  collapseButton.title = collapsed ? "Expand" : "Collapse";
  store.set(collapsed);
}

function setOpen(open) {
  body.classList.toggle("sidebar-open", open);
  scrim.hidden = !open;
  openButton.setAttribute("aria-expanded", String(open));
  if (open) sidebar.querySelector("nav a")?.focus();
}

setCollapsed(store.get());
collapseButton.addEventListener("click", () => setCollapsed(!body.classList.contains("sidebar-collapsed")));
openButton.addEventListener("click", () => setOpen(true));
scrim.addEventListener("click", () => setOpen(false));
sidebar.querySelectorAll("nav a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && body.classList.contains("sidebar-open")) setOpen(false); });
