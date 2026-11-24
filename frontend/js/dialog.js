// A confirmation box drawn by the app itself (not the browser's own pop-up).
// Usage: if (await confirmDialog({ title, message, confirmLabel: "Delete", danger: true })) { ... }
import { el } from "./dom.js";

export function confirmDialog({ title, message, confirmLabel = "OK", cancelLabel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const finish = (answer) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    const cancel = el("button", { type: "button", class: "btn ghost", onclick: () => finish(false) }, cancelLabel);
    const confirm = el("button", { type: "button", class: danger ? "btn danger-solid" : "btn", onclick: () => finish(true) }, confirmLabel);
    const dialog = el("dialog", { class: "dialog", "aria-labelledby": "dialog-title" },
      el("h2", { id: "dialog-title" }, title),
      el("p", {}, message),
      el("div", { class: "dialog-actions" }, cancel, confirm));
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); }); // Esc key
    dialog.addEventListener("click", (e) => { if (e.target === dialog) finish(false); }); // click outside the box
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus(); // the safe choice has the focus, so Enter does not delete by accident
  });
}

// A short message in the same style, with one button.
export function messageDialog({ title, message, label = "OK" }) {
  return new Promise((resolve) => {
    const ok = el("button", { type: "button", class: "btn", onclick: () => { dialog.close(); dialog.remove(); resolve(); } }, label);
    const dialog = el("dialog", { class: "dialog", "aria-labelledby": "dialog-title" },
      el("h2", { id: "dialog-title" }, title),
      el("p", {}, message),
      el("div", { class: "dialog-actions" }, ok));
    dialog.addEventListener("cancel", () => { dialog.remove(); resolve(); });
    document.body.append(dialog);
    dialog.showModal();
    ok.focus();
  });
}
