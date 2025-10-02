// If you want to use Phoenix channels, run `mix help phx.gen.channel`
// to get started and then uncomment the line below.
// import "./user_socket.js"

// You can include dependencies in two ways.
//
// The simplest option is to put them in assets/vendor and
// import them using relative paths:
//
//     import "../vendor/some-package.js"
//
// Alternatively, you can `npm install some-package --prefix assets` and import
// them using a path starting with the package name:
//
//     import "some-package"
//
// If you have dependencies that try to import CSS, esbuild will generate a separate `app.css` file.
// To load it, simply add a second `<link>` to your `root.html.heex` file.

// Include phoenix_html to handle method=PUT/DELETE in forms and buttons.
import "phoenix_html";
// Establish Phoenix Socket and LiveView configuration.
import { Socket } from "phoenix";
import { LiveSocket } from "phoenix_live_view";
import { hooks as colocatedHooks } from "phoenix-colocated/timeline";
import topbar from "../vendor/topbar";

const csrfToken = document
  .querySelector("meta[name='csrf-token']")
  .getAttribute("content");
const hooks = {
  ...colocatedHooks,
  DnDPool: {
    mounted() {
      this._activeCard = null;
      this._dragGhost = null;
      this._hoverSlot = null;
      this._pointerId = null;
      this._offsetX = 0;
      this._offsetY = 0;

      // Helpers for pointer-based DnD (touch/pen)
      this._highlightSlot = (el) =>
        el && el.classList.add("border-primary", "bg-base-100");
      this._unhighlightSlot = (el) =>
        el && el.classList.remove("border-primary", "bg-base-100");
      this._slotAt = (x, y) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        const slot = el.closest("[data-slot-idx]");
        if (!slot) return null;
        const filled = slot.getAttribute("data-filled") === "true";
        return filled ? null : slot;
      };

      // Desktop HTML5 drag-and-drop
      this._onDragStart = (e) => {
        const card = e.target.closest("[data-event-id]");
        if (!card) return;

        if (!card.getAttribute("draggable")) {
          card.setAttribute("draggable", "true");
        }

        const id = card.getAttribute("data-event-id");
        if (id && e.dataTransfer) {
          e.dataTransfer.setData("text/event-id", id);
          e.dataTransfer.effectAllowed = "move";
          card.classList.add("ring", "ring-primary", "cursor-grabbing");
          this._activeCard = card;
        }
      };

      this._onDragEnd = (e) => {
        const card = this._activeCard || e.target.closest("[data-event-id]");
        if (card) {
          card.classList.remove("ring", "ring-primary", "cursor-grabbing");
        }
        this._activeCard = null;
      };

      this.el.addEventListener("dragstart", this._onDragStart);
      this.el.addEventListener("dragend", this._onDragEnd);

      // Touch/Pen drag-and-drop via Pointer Events
      this._onPointerDown = (e) => {
        // Allow native mouse DnD; handle only touch/pen here
        if (e.pointerType === "mouse") return;
        if (e.button !== 0) return;

        const card = e.target.closest("[data-event-id]");
        if (!card) return;

        const id = card.getAttribute("data-event-id");
        if (!id) return;

        // Prevent page scroll on touch while dragging
        e.preventDefault();

        this._activeCard = card;
        this._pointerId = e.pointerId;

        const rect = card.getBoundingClientRect();
        this._offsetX = e.clientX - rect.left;
        this._offsetY = e.clientY - rect.top;

        // Visual affordance
        card.classList.add("ring", "ring-primary");

        // Create a lightweight drag ghost
        const ghost = card.cloneNode(true);
        ghost.style.position = "fixed";
        ghost.style.pointerEvents = "none";
        ghost.style.left = "0";
        ghost.style.top = "0";
        ghost.style.width = rect.width + "px";
        // scale up slightly for a lifted effect
        ghost.style.transform = `translate(${e.clientX - this._offsetX}px, ${e.clientY - this._offsetY}px) scale(1.03)`;
        ghost.style.transition =
          "transform 120ms ease-out, box-shadow 120ms ease-out, opacity 120ms ease-out";
        ghost.style.boxShadow = "0 12px 24px rgba(0, 0, 0, 0.2)";
        ghost.style.borderRadius = "0.75rem"; // ~12px
        ghost.style.willChange = "transform";
        ghost.style.zIndex = "9999";
        ghost.style.opacity = "0.95";
        this._dragGhost = ghost;
        document.body.appendChild(ghost);

        // Bind move/up handlers
        this._boundPointerMove = this._onPointerMove.bind(this);
        this._boundPointerUp = this._onPointerUp.bind(this);
        window.addEventListener("pointermove", this._boundPointerMove, {
          passive: false,
        });
        window.addEventListener("pointerup", this._boundPointerUp, {
          passive: false,
        });
        window.addEventListener("pointercancel", this._boundPointerUp, {
          passive: false,
        });
      };

      this._onPointerMove = (e) => {
        if (this._pointerId !== e.pointerId) return;
        if (!this._dragGhost) return;

        e.preventDefault();

        // Move ghost
        this._dragGhost.style.transform = `translate(${e.clientX - this._offsetX}px, ${e.clientY - this._offsetY}px) scale(1.03)`;

        // Highlight hovered empty slot
        const slot = this._slotAt(e.clientX, e.clientY);
        if (slot !== this._hoverSlot) {
          this._unhighlightSlot(this._hoverSlot);
          this._hoverSlot = slot;
          this._highlightSlot(this._hoverSlot);
        }
      };

      this._onPointerUp = (e) => {
        if (this._pointerId !== e.pointerId) return;
        e.preventDefault();

        // Remove ghost
        if (this._dragGhost && this._dragGhost.parentNode) {
          this._dragGhost.parentNode.removeChild(this._dragGhost);
        }
        this._dragGhost = null;

        // Unhighlight last hovered slot
        this._unhighlightSlot(this._hoverSlot);

        const slot = this._hoverSlot;
        const card = this._activeCard;
        const id = card && card.getAttribute("data-event-id");

        if (card) {
          card.classList.remove("ring", "ring-primary");
        }

        if (slot && id) {
          const idx = slot.getAttribute("data-slot-idx");
          // Subtle placement animation
          slot.classList.add("animate-pulse");
          setTimeout(() => slot.classList.remove("animate-pulse"), 250);
          this.pushEvent("place_selected", { id, slot: parseInt(idx, 10) });
        }

        this._hoverSlot = null;
        this._activeCard = null;
        this._pointerId = null;

        window.removeEventListener("pointermove", this._boundPointerMove);
        window.removeEventListener("pointerup", this._boundPointerUp);
        window.removeEventListener("pointercancel", this._boundPointerUp);
      };

      this.el.addEventListener("pointerdown", this._onPointerDown, {
        passive: false,
      });
    },
    updated() {
      // No-op: using event delegation, nothing to rebind
    },
    destroyed() {
      this.el.removeEventListener("dragstart", this._onDragStart);
      this.el.removeEventListener("dragend", this._onDragEnd);
      this.el.removeEventListener("pointerdown", this._onPointerDown);
      window.removeEventListener("pointermove", this._boundPointerMove);
      window.removeEventListener("pointerup", this._boundPointerUp);
      window.removeEventListener("pointercancel", this._boundPointerUp);
    },
  },
  DnDSlots: {
    mounted() {
      this.setup();
    },
    updated() {
      this.setup();
    },
    setup() {
      const highlight = (el) =>
        el.classList.add("border-primary", "bg-base-100");
      const unhighlight = (el) =>
        el.classList.remove("border-primary", "bg-base-100");
      this.el.querySelectorAll("[data-slot-idx]").forEach((slot) => {
        const isFilled = () => slot.getAttribute("data-filled") === "true";
        const onDragOver = (e) => {
          if (isFilled()) {
            if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
            return;
          }
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          highlight(slot);
        };
        const onDragLeave = () => {
          unhighlight(slot);
        };
        const onDrop = (e) => {
          e.preventDefault();
          const eventId = e.dataTransfer.getData("text/event-id");
          const idx = slot.getAttribute("data-slot-idx");
          unhighlight(slot);
          if (eventId && idx != null) {
            // Subtle placement animation on drop
            slot.classList.add("animate-pulse");
            setTimeout(() => slot.classList.remove("animate-pulse"), 250);
            this.pushEvent("place_selected", {
              id: eventId,
              slot: parseInt(idx, 10),
            });
          }
        };
        slot.addEventListener("dragover", onDragOver);
        slot.addEventListener("dragleave", onDragLeave);
        slot.addEventListener("drop", onDrop);
      });
    },
  },
  PeriodRange: {
    mounted() {
      const d = this.el.dataset;
      this._id = d.id;
      this._axisMin = parseInt(d.axisMin, 10);
      this._axisMax = parseInt(d.axisMax, 10);
      this._guessStart = parseInt(d.guessStart, 10);
      this._guessEnd = parseInt(d.guessEnd, 10);
      this._drag = null;

      this._posToYear = (clientX) => {
        const rect = this.el.getBoundingClientRect();
        const span = this._axisMax - this._axisMin;
        if (rect.width <= 0 || span <= 0) return this._axisMin;
        let ratio = (clientX - rect.left) / rect.width;
        ratio = Math.max(0, Math.min(1, ratio));
        return Math.round(this._axisMin + ratio * span);
      };

      this._clampRange = (start, end) => {
        const minDur = 1;
        start = Math.max(
          this._axisMin,
          Math.min(start, this._axisMax - minDur),
        );
        end = Math.max(start + minDur, Math.min(end, this._axisMax));
        return [start, end];
      };

      this._pushGuess = (start, end) => {
        const [s, e] = this._clampRange(start, end);
        this._guessStart = s;
        this._guessEnd = e;
        this.pushEvent("set_guess", {
          id: this._id,
          guess_start: s,
          guess_end: e,
        });
      };

      this._onPointerDown = (e) => {
        // Allow only primary interactions for mouse; always allow touch/pen
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const target = e.target;
        const handle = target.closest("[data-role='handle']");
        const guess = target.closest("[data-role='guess']");
        if (!handle && !guess) return;

        e.preventDefault();

        const mode = handle
          ? handle.getAttribute("data-edge") === "start"
            ? "resize-start"
            : "resize-end"
          : "move";

        const startAtDown = this._guessStart;
        const endAtDown = this._guessEnd;
        const pointerYear = this._posToYear(e.clientX);
        const duration = endAtDown - startAtDown;
        const offset = pointerYear - startAtDown;

        this._drag = {
          pointerId: e.pointerId,
          mode,
          startAtDown,
          endAtDown,
          offset,
          duration,
        };

        this._boundMove = this._onPointerMove.bind(this);
        this._boundUp = this._onPointerUp.bind(this);
        window.addEventListener("pointermove", this._boundMove, {
          passive: false,
        });
        window.addEventListener("pointerup", this._boundUp, { passive: false });
        window.addEventListener("pointercancel", this._boundUp, {
          passive: false,
        });
      };

      this._onPointerMove = (e) => {
        if (!this._drag || e.pointerId !== this._drag.pointerId) return;
        e.preventDefault();

        const y = this._posToYear(e.clientX);

        if (this._drag.mode === "move") {
          let newStart = Math.round(y - this._drag.offset);
          let newEnd = newStart + this._drag.duration;

          // Clamp to axis while preserving duration
          const span = this._axisMax - this._axisMin;
          if (newEnd > this._axisMax) {
            newEnd = this._axisMax;
            newStart = newEnd - this._drag.duration;
          }
          if (newStart < this._axisMin) {
            newStart = this._axisMin;
            newEnd = newStart + this._drag.duration;
          }

          this._pushGuess(newStart, newEnd);
        } else if (this._drag.mode === "resize-start") {
          let newStart = Math.min(y, this._guessEnd - 1);
          this._pushGuess(newStart, this._guessEnd);
        } else if (this._drag.mode === "resize-end") {
          let newEnd = Math.max(y, this._guessStart + 1);
          this._pushGuess(this._guessStart, newEnd);
        }
      };

      this._onPointerUp = (e) => {
        if (!this._drag || e.pointerId !== this._drag.pointerId) return;
        e.preventDefault();
        window.removeEventListener("pointermove", this._boundMove);
        window.removeEventListener("pointerup", this._boundUp);
        window.removeEventListener("pointercancel", this._boundUp);
        this._drag = null;
      };

      this.el.addEventListener("pointerdown", this._onPointerDown, {
        passive: false,
      });
    },
    updated() {
      // Refresh cached dataset values in case LV updated them
      const d = this.el.dataset;
      this._axisMin = parseInt(d.axisMin, 10);
      this._axisMax = parseInt(d.axisMax, 10);
      this._guessStart = parseInt(d.guessStart, 10);
      this._guessEnd = parseInt(d.guessEnd, 10);
    },
    destroyed() {
      this.el.removeEventListener("pointerdown", this._onPointerDown);
      window.removeEventListener("pointermove", this._boundMove);
      window.removeEventListener("pointerup", this._boundUp);
      window.removeEventListener("pointercancel", this._boundUp);
    },
  },
};
const liveSocket = new LiveSocket("/live", Socket, {
  longPollFallbackMs: 2500,
  params: { _csrf_token: csrfToken },
  hooks,
});

// Show progress bar on live navigation and form submits
topbar.config({ barColors: { 0: "#29d" }, shadowColor: "rgba(0, 0, 0, .3)" });
window.addEventListener("phx:page-loading-start", (_info) => topbar.show(300));
window.addEventListener("phx:page-loading-stop", (_info) => topbar.hide());

// connect if there are any LiveViews on the page
liveSocket.connect();

// expose liveSocket on window for web console debug logs and latency simulation:
// >> liveSocket.enableDebug()
// >> liveSocket.enableLatencySim(1000)  // enabled for duration of browser session
// >> liveSocket.disableLatencySim()
window.liveSocket = liveSocket;

// The lines below enable quality of life phoenix_live_reload
// development features:
//
//     1. stream server logs to the browser console
//     2. click on elements to jump to their definitions in your code editor
//
if (process.env.NODE_ENV === "development") {
  window.addEventListener(
    "phx:live_reload:attached",
    ({ detail: reloader }) => {
      // Enable server log streaming to client.
      // Disable with reloader.disableServerLogs()
      reloader.enableServerLogs();

      // Open configured PLUG_EDITOR at file:line of the clicked element's HEEx component
      //
      //   * click with "c" key pressed to open at caller location
      //   * click with "d" key pressed to open at function component definition location
      let keyDown;
      window.addEventListener("keydown", (e) => (keyDown = e.key));
      window.addEventListener("keyup", (e) => (keyDown = null));
      window.addEventListener(
        "click",
        (e) => {
          if (keyDown === "c") {
            e.preventDefault();
            e.stopImmediatePropagation();
            reloader.openEditorAtCaller(e.target);
          } else if (keyDown === "d") {
            e.preventDefault();
            e.stopImmediatePropagation();
            reloader.openEditorAtDef(e.target);
          }
        },
        true,
      );

      window.liveReloader = reloader;
    },
  );
}
