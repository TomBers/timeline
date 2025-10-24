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

// Lightweight analytics helper (gtag preferred; falls back to dataLayer or console)
const track = (event, params = {}) => {
  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", event, params);
    } else if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event, ...params });
    } else if (window.console && typeof console.debug === "function") {
      console.debug("[track]", event, params);
    }
  } catch (_e) {
    // no-op
  }
};

// Attach analytics handlers for score modal + share links
const bindScoreAnalytics = () => {
  // Track when the Score button is clicked (modal open is requested)
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest && e.target.closest("#score-btn");
      if (btn) {
        track("score_open", { component: "game" });
      }
    },
    true,
  );

  // Delegate inside the score modal
  document.addEventListener(
    "click",
    (e) => {
      const within = e.target.closest && e.target.closest("#score-modal");
      if (!within) return;

      // Share link clicks
      const shareLink =
        e.target.closest && e.target.closest("#score-modal a[href]");
      if (shareLink) {
        try {
          const url = new URL(shareLink.href);
          let platform = "other";
          if (url.hostname.includes("twitter.com")) platform = "x";
          else if (url.hostname.includes("facebook.com")) platform = "facebook";
          else if (url.hostname.includes("linkedin.com")) platform = "linkedin";
          track("share_click", { platform, component: "game" });
        } catch (_e) {
          // ignore URL parse errors
        }
        return;
      }

      // Modal close actions: close button, overlay, or any element calling hide(#score-modal)
      if (
        e.target.matches("#score-modal [aria-label='Close']") ||
        e.target.matches("#score-modal .bg-black\\/50") ||
        (e.target.closest &&
          e.target.closest('[phx-click*="hide(#score-modal)"]'))
      ) {
        track("score_close", { component: "game" });
      }
    },
    true,
  );
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindScoreAnalytics, {
    once: true,
  });
} else {
  bindScoreAnalytics();
}
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
      // Auto-scroll state (initialized lazily)
      this._scrollContainer = null;
      this._autoScrollEdge = 48; // px from edge to begin auto-scroll
      this._autoScrollMaxV = 18; // max px per frame during auto-scroll
      this._autoScrollVx = 0;
      this._autoScrollRAF = null;

      // A11y live region announcer
      this._announce = (msg) => {
        const el = document.getElementById("a11y-live");
        if (el) {
          el.textContent = "";
          el.textContent = msg;
        }
      };

      // Keyboard support in pool: Enter/Space selects the card
      this._onKeyDownPool = (e) => {
        const card = e.target.closest("[data-event-id]");
        if (!card) return;
        const id = card.getAttribute("data-event-id");
        if (!id) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.pushEvent("select_event", { id });
          if (this._announce) {
            const label = card.getAttribute("aria-label") || "event";
            this._announce(
              `Selected ${label}. Move focus to a slot and press Enter to place.`,
            );
          }
        }
      };
      this.el.addEventListener("keydown", this._onKeyDownPool);

      // Helpers for pointer-based DnD (touch/pen)
      this._highlightSlot = (el) =>
        el && el.classList.add("border-primary", "bg-base-100");
      this._unhighlightSlot = (el) =>
        el && el.classList.remove("border-primary", "bg-base-100");

      // Edge auto-scroll helpers (mobile-first, no-ops on desktop)
      this._findScrollContainer = () => {
        // Prefer explicit data attribute if present, then common fallbacks
        let el =
          document.querySelector("[data-dnd-scroll-container='true']") ||
          (document.getElementById("timeline") &&
            document
              .getElementById("timeline")
              .querySelector(".overflow-x-auto")) ||
          document.querySelector("#timeline .overflow-x-auto") ||
          document.querySelector(".overflow-x-auto");
        return el || null;
      };

      this._setAutoScrollVX = (vx) => {
        if (vx === this._autoScrollVx) return;
        this._autoScrollVx = vx;
        if (!vx) {
          if (this._autoScrollRAF) {
            cancelAnimationFrame(this._autoScrollRAF);
            this._autoScrollRAF = null;
          }
          return;
        }
        if (this._autoScrollRAF) return;
        const tick = () => {
          const sc = this._scrollContainer;
          if (!sc) {
            this._setAutoScrollVX(0);
            return;
          }
          sc.scrollLeft += this._autoScrollVx;
          this._autoScrollRAF = requestAnimationFrame(tick);
        };
        this._autoScrollRAF = requestAnimationFrame(tick);
      };

      this._updateAutoScroll = (e) => {
        if (!this._scrollContainer) {
          this._scrollContainer =
            this._findScrollContainer && this._findScrollContainer();
        }
        const sc = this._scrollContainer;
        if (!sc) return;
        const rect = sc.getBoundingClientRect();
        const edge = this._autoScrollEdge || 48;
        const maxV = this._autoScrollMaxV || 18;
        let vx = 0;

        // Left edge
        if (e.clientX < rect.left + edge && sc.scrollLeft > 0) {
          const t = (rect.left + edge - e.clientX) / edge; // 0..1
          vx = -Math.ceil(maxV * Math.min(1, Math.max(0, t)));
        }
        // Right edge
        else if (
          e.clientX > rect.right - edge &&
          sc.scrollLeft < sc.scrollWidth - sc.clientWidth
        ) {
          const t = (e.clientX - (rect.right - edge)) / edge; // 0..1
          vx = Math.ceil(maxV * Math.min(1, Math.max(0, t)));
        }

        this._setAutoScrollVX(vx);
      };

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
        // Light haptic feedback on drag start (supported devices only)
        if (navigator && typeof navigator.vibrate === "function") {
          navigator.vibrate(8);
        }

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

        // Update edge auto-scroll based on pointer position
        this._updateAutoScroll && this._updateAutoScroll(e);
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
          // Haptic tick on successful drop (supported devices only)
          if (navigator && typeof navigator.vibrate === "function") {
            navigator.vibrate(12);
          }
          this.pushEvent("place_selected", { id, slot: parseInt(idx, 10) });
          if (this._announce) {
            this._announce(`Placed into slot ${parseInt(idx, 10) + 1}`);
          }
        }

        this._hoverSlot = null;
        this._activeCard = null;
        this._pointerId = null;

        // Stop edge auto-scroll loop
        if (this._setAutoScrollVX) this._setAutoScrollVX(0);

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
      this.el.removeEventListener("keydown", this._onKeyDownPool);
      window.removeEventListener("pointermove", this._boundPointerMove);
      window.removeEventListener("pointerup", this._boundPointerUp);
      window.removeEventListener("pointercancel", this._boundPointerUp);
      if (this._autoScrollRAF) cancelAnimationFrame(this._autoScrollRAF);
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
        // Make slots focusable for keyboard users
        if (!slot.hasAttribute("tabindex")) {
          slot.setAttribute("tabindex", "0");
        }
        // A11y live region announcer (shared pattern)
        if (!this._announce) {
          this._announce = (msg) => {
            const el = document.getElementById("a11y-live");
            if (el) {
              el.textContent = "";
              el.textContent = msg;
            }
          };
        }
        // Keyboard controls: Enter/Space places selected, Backspace/Delete removes
        const onKeyDown = (e) => {
          const key = e.key;
          if (key === "Enter" || key === " ") {
            e.preventDefault();
            const selected = document.querySelector(
              "#pool [aria-pressed='true'][data-event-id]",
            );
            const id = selected && selected.getAttribute("data-event-id");
            const idx = slot.getAttribute("data-slot-idx");
            if (id && idx != null) {
              this.pushEvent("place_selected", {
                id,
                slot: parseInt(idx, 10),
              });
              if (this._announce) {
                this._announce(`Placed into slot ${parseInt(idx, 10) + 1}`);
              }
            }
          } else if (key === "Backspace" || key === "Delete") {
            e.preventDefault();
            const idx = slot.getAttribute("data-slot-idx");
            if (idx != null) {
              this.pushEvent("remove_from_slot", {
                slot: parseInt(idx, 10),
              });
              if (this._announce) {
                this._announce(`Removed from slot ${parseInt(idx, 10) + 1}`);
              }
            }
          }
        };
        slot.addEventListener("keydown", onKeyDown);
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
            if (this._announce) {
              this._announce(`Placed into slot ${parseInt(idx, 10) + 1}`);
            }
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
        // Preserve the current block duration during moves.
        const minDur =
          this._drag &&
          Number.isFinite(this._drag.duration) &&
          this._drag.duration > 0
            ? this._drag.duration
            : 1;
        // Clamp start so that [start, start+minDur] always fits within the axis.
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
        const trackClick = !handle && !guess;

        e.preventDefault();

        const mode = "move";

        const startAtDown = this._guessStart;
        const endAtDown = this._guessEnd;
        const pointerYear = this._posToYear(e.clientX);
        const duration = endAtDown - startAtDown;
        // If drag starts on empty track (not on bar or handle), center bar under pointer during drag.
        const offset = trackClick
          ? Math.round(duration / 2)
          : pointerYear - startAtDown;

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

        if (true) {
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
          // Recompute overlay handle positions from current guess values
          {
            const spanPctDen = this._axisMax - this._axisMin;
            if (spanPctDen > 0) {
              const startPct =
                ((this._guessStart - this._axisMin) * 100) / spanPctDen;
              const endPct =
                ((this._guessEnd - this._axisMin) * 100) / spanPctDen;
              const startHandle = this.el.querySelector(
                "[data-role='handle'][data-edge='start']",
              );
              const endHandle = this.el.querySelector(
                "[data-role='handle'][data-edge='end']",
              );
              if (startHandle) startHandle.style.left = startPct + "%";
              if (endHandle) endHandle.style.left = endPct + "%";
            }
          }
        } else if (false) {
          let newStart = Math.min(y, this._guessEnd - 1);
          this._pushGuess(newStart, this._guessEnd);
          {
            const spanPctDen = this._axisMax - this._axisMin;
            if (spanPctDen > 0) {
              const startPct =
                ((this._guessStart - this._axisMin) * 100) / spanPctDen;
              const startHandle = this.el.querySelector(
                "[data-role='handle'][data-edge='start']",
              );
              if (startHandle) startHandle.style.left = startPct + "%";
            }
          }
        } else if (false) {
          let newEnd = Math.max(y, this._guessStart + 1);
          this._pushGuess(this._guessStart, newEnd);
          {
            const spanPctDen = this._axisMax - this._axisMin;
            if (spanPctDen > 0) {
              const endPct =
                ((this._guessEnd - this._axisMin) * 100) / spanPctDen;
              const endHandle = this.el.querySelector(
                "[data-role='handle'][data-edge='end']",
              );
              if (endHandle) endHandle.style.left = endPct + "%";
            }
          }
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
  TimelineCanvas: {
    mounted() {
      // Canvas and context
      this._ctx = this.el.getContext("2d");
      // Config
      this._padding = { left: 40, right: 20, top: 32, bottom: 24 };
      this._headerH = 36;
      this._laneH = 88;
      this._laneGap = 18;
      this._drag = null;
      this._rects = new Map(); // id -> {x,y,w,h,lane}

      // Dataset
      const d = this.el.dataset;
      this._axisMin = parseInt(d.axisMin || "0", 10);
      this._axisMax = parseInt(d.axisMax || "1", 10);
      this._ticks = (d.ticks || "")
        .split(",")
        .map((t) => parseInt(t, 10))
        .filter((n) => Number.isFinite(n));
      this._placed = (d.placed || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      this._laneCount = parseInt(d.laneCount || "1", 10);
      this._laneOverrides = {};
      try {
        if (d.laneOverrides) {
          this._laneOverrides = JSON.parse(d.laneOverrides);
        }
      } catch (_e) {}
      // Show answers removed; no truth overlays rendered

      // Events meta from hidden DOM
      this._eventsById = {};
      this._imgCache = new Map();
      // Grid setup: derive origin/step from earliest and latest event years (fallback to axis)
      this._gridCols = 40;
      let earliest = Number.POSITIVE_INFINITY;
      let latest = Number.NEGATIVE_INFINITY;
      Object.values(this._eventsById).forEach((m) => {
        if (!m) return;
        if (Number.isFinite(m.start)) earliest = Math.min(earliest, m.start);
        if (Number.isFinite(m.end)) latest = Math.max(latest, m.end);
      });
      // Fallbacks if no events yet
      if (!Number.isFinite(earliest)) earliest = this._axisMin;
      if (!Number.isFinite(latest)) latest = this._axisMax;
      this._gridOriginYear = Math.min(earliest, this._axisMin);
      const gridSpanYears = Math.max(
        1,
        Math.max(latest, this._axisMax) - this._gridOriginYear,
      );
      this._gridSizeYears = Math.max(
        1,
        Math.round(gridSpanYears / this._gridCols),
      );
      const dataRoot =
        document.getElementById("timeline-canvas-data") ||
        this.el.parentElement;
      if (dataRoot) {
        const items = Array.from(dataRoot.querySelectorAll("[data-id]"));
        items.forEach((el) => {
          const id = el.getAttribute("data-id");
          this._eventsById[id] = {
            id,
            title: el.getAttribute("data-title") || "",
            start: parseInt(el.getAttribute("data-start") || "0", 10),
            end: parseInt(el.getAttribute("data-end") || "1", 10),
            guessStart: parseInt(
              el.getAttribute("data-guess-start") || "0",
              10,
            ),
            guessEnd: parseInt(el.getAttribute("data-guess-end") || "1", 10),
            image: el.getAttribute("data-image-src"),
          };
        });
      }

      // Helpers
      this._formatYear = (y) => {
        if (!Number.isFinite(y)) return `${y}`;
        if (y < 0) return `${-y} BCE`;
        if (y === 0) return "0";
        return `${y} CE`;
      };

      this._yearToX = (year) => {
        const span = this._axisMax - this._axisMin;
        if (span <= 0) return this._padding.left;
        const w = this._drawW();
        let t = (year - this._axisMin) / span;
        t = Math.max(0, Math.min(1, t));
        return this._padding.left + t * w;
      };

      this._xToYear = (clientX) => {
        const rect = this.el.getBoundingClientRect();
        const x = clientX - rect.left;
        const w = rect.width - (this._padding.left + this._padding.right);
        if (w <= 0) return this._axisMin;
        let t = (x - this._padding.left) / w;
        t = Math.max(0, Math.min(1, t));
        const span = this._axisMax - this._axisMin;
        return Math.round(this._axisMin + t * span);
      };
      this._colToYear = (col) => {
        return this._gridOriginYear + col * this._gridSizeYears;
      };
      this._yearToCol = (year) => {
        return Math.round((year - this._gridOriginYear) / this._gridSizeYears);
      };
      this._snapYear = (year) => {
        return this._colToYear(this._yearToCol(year));
      };

      this._laneY = (idx) => {
        const y0 =
          this._padding.top +
          this._headerH +
          idx * (this._laneH + this._laneGap);
        return y0 + this._laneH / 2;
      };

      // Compute lane index from pointer Y position
      this._laneFromY = (clientY) => {
        const rect = this.el.getBoundingClientRect();
        const y = clientY - rect.top;
        const y0 = this._padding.top + this._headerH;
        const laneSpan = this._laneH + this._laneGap;
        let idx = Math.floor((y - y0 + this._laneGap / 2) / laneSpan);
        idx = Math.max(0, Math.min((this._laneCount || 1) - 1, idx));
        return idx;
      };

      this._drawW = () =>
        this._cssWidth - (this._padding.left + this._padding.right);

      this._resizeCanvas = () => {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.el.getBoundingClientRect();
        // Dynamic height based on stable lane count from server
        const lanes = Math.max(this._laneCount || 1, 1);
        const heightCss =
          this._padding.top +
          this._headerH +
          lanes * (this._laneH + this._laneGap) -
          this._laneGap +
          this._padding.bottom;

        // Compute CSS pixel size and set intrinsic size for crisp drawing
        this._cssWidth = Math.max(1, Math.floor(rect.width));
        this._cssHeight = Math.max(1, Math.floor(heightCss));
        this.el.width = Math.max(1, Math.floor(this._cssWidth * dpr));
        this.el.height = Math.max(1, Math.floor(this._cssHeight * dpr));
        // Scale context so drawing uses CSS pixels
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Ensure CSS size reflects CSS pixels
        this.el.style.width = "100%";
        this.el.style.height = `${this._cssHeight}px`;
      };

      this._draw = () => {
        const ctx = this._ctx;
        // Clear
        ctx.clearRect(0, 0, this._cssWidth, this._cssHeight);

        // Axis header line (emphasized and theme-aware)
        const axisY = this._padding.top + this._headerH / 2;
        const __bcAxis = getComputedStyle(document.documentElement)
          .getPropertyValue("--bc")
          .trim();
        ctx.strokeStyle = __bcAxis
          ? `rgb(${__bcAxis})`
          : getComputedStyle(document.body).color || "#666";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this._padding.left, axisY);
        ctx.lineTo(this._padding.left + this._drawW(), axisY);
        ctx.stroke();

        // Grid vertical lines
        {
          const __bcGrid = getComputedStyle(document.documentElement)
            .getPropertyValue("--bc")
            .trim();
          ctx.strokeStyle = __bcGrid
            ? `rgba(${__bcGrid.replace(/\s+/g, ", ")}, 0.15)`
            : "rgba(0,0,0,0.15)";
        }
        ctx.lineWidth = 1.25;
        const yTop = this._padding.top + this._headerH;
        const yBottom =
          this._padding.top +
          this._headerH +
          Math.max(this._laneCount || 1, 1) * (this._laneH + this._laneGap) -
          this._laneGap;
        const colStart = this._yearToCol(this._axisMin);
        const colEnd = this._yearToCol(this._axisMax);
        for (let c = colStart; c <= colEnd; c++) {
          const x = this._yearToX(this._colToYear(c));
          ctx.beginPath();
          ctx.moveTo(x, yTop);
          ctx.lineTo(x, yBottom);
          ctx.stroke();
        }
        // Grid horizontal boundaries (single top and bottom lines)
        {
          const __bcGrid = getComputedStyle(document.documentElement)
            .getPropertyValue("--bc")
            .trim();
          ctx.strokeStyle = __bcGrid
            ? `rgba(${__bcGrid.replace(/\s+/g, ", ")}, 0.15)`
            : "rgba(0,0,0,0.15)";
        }
        ctx.lineWidth = 1.25;
        // Top boundary
        ctx.beginPath();
        ctx.moveTo(this._padding.left, yTop);
        ctx.lineTo(this._padding.left + this._drawW(), yTop);
        ctx.stroke();
        // Bottom boundary
        ctx.beginPath();
        ctx.moveTo(this._padding.left, yBottom);
        ctx.lineTo(this._padding.left + this._drawW(), yBottom);
        ctx.stroke();

        // Ticks and labels (evenly spaced, theme-aware)
        ctx.textBaseline = "top";
        ctx.font = "600 12px system-ui, sans-serif";
        {
          const nTicks = this._ticks.length;
          if (nTicks > 0) {
            const w = this._drawW();
            const left = this._padding.left;
            const step = nTicks > 1 ? w / (nTicks - 1) : 0;
            const __bc = getComputedStyle(document.documentElement)
              .getPropertyValue("--bc")
              .trim();
            const contentColor = __bc
              ? `rgb(${__bc})`
              : getComputedStyle(document.body).color || "#666";

            this._ticks.forEach((t, i) => {
              const x = left + step * i;

              // tick mark
              ctx.save();
              ctx.strokeStyle = contentColor;
              ctx.globalAlpha = 0.7;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x, axisY - 7);
              ctx.lineTo(x, axisY + 7);
              ctx.stroke();
              ctx.restore();

              // label
              const text = this._formatYear(t);
              ctx.fillStyle = contentColor;
              const tw = ctx.measureText(text).width;
              ctx.fillText(text, x - tw / 2, axisY + 10);
            });
          }
        }

        // Draw lanes: truth and blocks
        this._rects.clear();

        // Truth overlays removed

        // Using server-provided stable lanes; no client-side packing
        const idToLane = {};
        this._placed.forEach((pid) => {
          const m = this._eventsById[pid];
          if (!m) return;
          const override =
            this._laneOverrides &&
            Object.prototype.hasOwnProperty.call(this._laneOverrides, pid)
              ? this._laneOverrides[pid]
              : undefined;
          const lane = Number.isFinite(override)
            ? override
            : Number.isFinite(m.lane)
              ? m.lane
              : 0;
          idToLane[pid] = Math.max(
            0,
            Math.min((this._laneCount || 1) - 1, lane),
          );
        });

        // Draw placed blocks on their lanes
        this._placed.forEach((id, idx) => {
          const meta = this._eventsById[id];
          if (!meta) return;

          const lane = idToLane[id] ?? 0;
          const y = this._laneY(lane);

          // Truth overlay
          if (this._showTruth) {
            const tx = this._yearToX(meta.start);
            const tw = this._yearToX(meta.end) - tx;
            ctx.fillStyle = "rgba(245, 158, 11, 0.12)"; // warning/10
            ctx.strokeStyle = "rgba(245, 158, 11, 0.8)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            const th = 18;
            ctx.roundRect(tx, y - th / 2, Math.max(2, tw), th, 4);
            ctx.fill();
            ctx.stroke();
          }

          // Guess block (fixed duration) with solid positioning (snapped to grid columns)
          const startColDraw = this._yearToCol(meta.guessStart);
          const endColDraw = Math.max(
            startColDraw + 1,
            this._yearToCol(meta.guessEnd),
          );
          const gx = this._yearToX(this._colToYear(startColDraw));
          const gw = this._yearToX(this._colToYear(endColDraw)) - gx;
          const gh = 56;

          // Bar
          ctx.fillStyle = "rgba(37, 99, 235, 0.85)"; // primary/80ish
          ctx.strokeStyle = "rgba(37, 99, 235, 0.95)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(gx, y - gh / 2, Math.max(6, gw), gh, 6);
          ctx.fill();
          ctx.stroke();

          // Thumbnail (if available)
          if (meta.image && gw >= 140) {
            let img = this._imgCache.get(meta.image);
            if (!img) {
              img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => this._draw();
              img.onerror = () => {};
              img.src = meta.image;
              this._imgCache.set(meta.image, img);
            }
            if (img.complete && img.naturalWidth > 0) {
              const size = Math.min(gh - 6, 96);
              const ix = gx + 4;
              const iy = y - size / 2;
              ctx.save();
              ctx.beginPath();
              ctx.rect(ix, iy, size, size);
              ctx.clip();
              ctx.drawImage(img, ix, iy, size, size);
              ctx.restore();
            }
          }

          // Label
          const label = `${meta.title}`;
          ctx.font = "12px system-ui, sans-serif";
          const small = gw < 140;
          ctx.fillStyle = "#fff";
          if (!small) {
            // Offset label to avoid overlapping the thumbnail image and clip to bar interior
            let imgSize = 0;
            if (meta.image) {
              const _img = this._imgCache.get(meta.image);
              if (_img && _img.complete && _img.naturalWidth > 0) {
                imgSize = Math.min(gh - 6, 96);
              }
            }
            const padX = 6;
            const labelX = imgSize > 0 ? gx + 4 + imgSize + padX : gx + 8;
            const ty = y - 6;
            // Clip label within remaining bar area (to the right of the image)
            const clipLeft = labelX;
            const clipRight = gx + Math.max(6, gw) - 6;
            ctx.save();
            ctx.beginPath();
            ctx.rect(
              clipLeft,
              y - gh / 2 + 2,
              Math.max(0, clipRight - clipLeft),
              gh - 4,
            );
            ctx.clip();
            ctx.fillStyle = "#fff";
            ctx.fillText(label, labelX, ty);
            ctx.restore();
          } else {
            // Small bar: draw an external bubble label with dynamic height and centered text
            let tx = gx + Math.max(6, gw) / 2;

            // Measure text to compute bubble height
            const metrics = ctx.measureText(label);
            const ascent = metrics.actualBoundingBoxAscent || 9;
            const descent = metrics.actualBoundingBoxDescent || 3;
            const textH = Math.max(12, ascent + descent);
            const padH = 6; // horizontal padding
            const padV = 4; // vertical padding
            const bubbleH = Math.ceil(textH + padV * 2);

            // Preferred bubble position above the bar with small gap
            const gap = 6;
            let bubbleTop = Math.round(y - gh / 2 - gap - bubbleH);
            const topLimit = this._padding.top + 2;

            // If clipping at the top, flip the bubble below the bar
            if (bubbleTop < topLimit) {
              bubbleTop = Math.round(y + gh / 2 + gap);
            }

            // Clamp horizontally to canvas content area
            const minX = this._padding.left + 2;
            const maxX = this._padding.left + this._drawW() - 2;
            const tw = metrics.width;

            let boxLeft = Math.round(tx - tw / 2 - padH);
            let boxRight = Math.round(tx + tw / 2 + padH);

            if (boxLeft < minX) {
              const shift = minX - boxLeft;
              boxLeft += shift;
              boxRight += shift;
              tx += shift;
            } else if (boxRight > maxX) {
              const shift = maxX - boxRight;
              boxLeft += shift;
              boxRight += shift;
              tx += shift;
            }

            // background bubble
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.beginPath();
            ctx.roundRect(boxLeft, bubbleTop, tw + padH * 2, bubbleH, 4);
            ctx.fill();

            // text (theme-aware color, vertically centered)
            const __bc2a = getComputedStyle(document.documentElement)
              .getPropertyValue("--bc")
              .trim();
            ctx.fillStyle = __bc2a ? `rgb(${__bc2a})` : "#333";
            const textCy = bubbleTop + bubbleH / 2;
            const oldBaseline = ctx.textBaseline;
            ctx.textBaseline = "middle";
            ctx.fillText(label, Math.round(tx - tw / 2), Math.round(textCy));
            ctx.textBaseline = oldBaseline;
          }

          // Save rect for hit-testing
          this._rects.set(id, {
            x: gx,
            y: y - gh / 2,
            w: Math.max(6, gw),
            h: gh,
            lane: lane,
          });

          // Animation removed for solid block positioning
        });
      };

      // Dragging
      this._hitTest = (clientX, clientY) => {
        const rect = this.el.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        // Find topmost rect under pointer
        let hit = null;
        this._rects.forEach((r, id) => {
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            hit = { id, rect: r };
          }
        });
        return hit;
      };

      this._onPointerDown = (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault();
        const hit = this._hitTest(e.clientX, e.clientY);
        if (!hit) return;

        const meta = this._eventsById[hit.id];
        const dur = Math.max(meta.guessEnd - meta.guessStart, 1);
        const pointerYear = this._xToYear(e.clientX);
        const offset = pointerYear - meta.guessStart;

        this._drag = {
          id: hit.id,
          duration: dur,
          offset,
          pointerId: e.pointerId,
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

        const id = this._drag.id;
        const meta = this._eventsById[id];
        if (!meta) return;

        let newStart = Math.round(this._xToYear(e.clientX) - this._drag.offset);
        let newEnd = newStart + this._drag.duration;

        // Clamp to axis while preserving duration
        if (newStart < this._axisMin) {
          newStart = this._axisMin;
          newEnd = newStart + this._drag.duration;
        }
        if (newEnd > this._axisMax) {
          newEnd = this._axisMax;
          newStart = newEnd - this._drag.duration;
        }

        // Collision constraints (single lane): prevent overlaps with other placed blocks
        let lane = Number.isFinite(meta.lane) ? meta.lane : 0;
        const targetLane = this._laneFromY(e.clientY);
        if (Number.isFinite(targetLane) && targetLane !== lane) {
          lane = Math.max(0, Math.min((this._laneCount || 1) - 1, targetLane));
          meta.lane = lane;
          this._laneOverrides = this._laneOverrides || {};
          this._laneOverrides[id] = lane;
          // Persist overrides on canvas dataset for future LV updates
          this.el.dataset.laneOverrides = JSON.stringify(this._laneOverrides);
        }

        // Snap to grid and enforce non-overlap using discrete columns
        let startCol = this._yearToCol(
          Math.round(this._xToYear(e.clientX) - this._drag.offset),
        );
        const spanCols = Math.max(
          1,
          Math.round(this._drag.duration / this._gridSizeYears),
        );

        // Axis bounds in columns
        const minCol = this._yearToCol(this._axisMin);
        const maxCol = this._yearToCol(this._axisMax) - spanCols;

        // Build same-lane occupied intervals in columns
        const intervals = this._placed
          .filter((pid) => pid !== id)
          .map((pid) => {
            const r = this._rects.get(pid);
            if (!r || r.lane !== lane) return null;
            const m = this._eventsById[pid];
            if (!m) return null;
            const sCol = this._yearToCol(m.guessStart);
            const wCol = Math.max(
              1,
              Math.round((m.guessEnd - m.guessStart) / this._gridSizeYears),
            );
            return { id: pid, s: sCol, e: sCol + wCol };
          })
          .filter(Boolean)
          .sort((a, b) => a.s - b.s);

        // Compute corridor in columns
        let leftBoundCol = minCol;
        let rightBoundCol = maxCol;
        intervals.forEach((iv) => {
          if (iv.e <= startCol) {
            leftBoundCol = Math.max(leftBoundCol, iv.e);
          }
          if (iv.s >= startCol + spanCols) {
            rightBoundCol = Math.min(rightBoundCol, iv.s - spanCols);
          }
        });

        // Clamp within corridor
        startCol = Math.min(Math.max(startCol, leftBoundCol), rightBoundCol);

        // Prevent overlap: abort update if any occupied interval intersects proposed cells
        const overlaps = intervals.some(
          (iv) => !(startCol + spanCols <= iv.s || startCol >= iv.e),
        );
        if (overlaps) {
          return;
        }

        // Convert back to years snapped to grid
        newStart = this._colToYear(startCol);
        newEnd = this._colToYear(startCol + spanCols);

        // Update local state
        meta.guessStart = newStart;
        meta.guessEnd = newEnd;

        // Push to LV
        this.pushEvent("set_guess", {
          id,
          guess_start: newStart,
          guess_end: newEnd,
          lane,
        });

        // Redraw
        this._draw();
      };

      this._onPointerUp = (e) => {
        if (!this._drag || e.pointerId !== this._drag.pointerId) return;
        e.preventDefault();
        window.removeEventListener("pointermove", this._boundMove);
        window.removeEventListener("pointerup", this._boundUp);
        window.removeEventListener("pointercancel", this._boundUp);
        this._drag = null;
      };

      // Desktop HTML5 drag-and-drop from pool onto canvas
      this._onDragOver = (e) => {
        if (e.dataTransfer && e.dataTransfer.types.includes("text/event-id")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          this.el.classList.add("ring", "ring-primary");
        }
      };
      this._onDragLeave = (_e) => {
        this.el.classList.remove("ring", "ring-primary");
      };
      this._onDrop = (e) => {
        e.preventDefault();
        this.el.classList.remove("ring", "ring-primary");
        const id = e.dataTransfer && e.dataTransfer.getData("text/event-id");
        if (!id) return;

        // Determine target lane and snap drop X to grid
        const targetLane = this._laneFromY(e.clientY);
        const dropColRaw = this._yearToCol(this._xToYear(e.clientX));

        // Compute span in columns based on the event duration
        const meta = this._eventsById[id];
        if (!meta) return;
        const spanCols = Math.max(
          1,
          Math.round((meta.guessEnd - meta.guessStart) / this._gridSizeYears),
        );

        // Axis bounds in columns
        const minCol = this._yearToCol(this._axisMin);
        const maxCol = this._yearToCol(this._axisMax) - spanCols;

        // Build same-lane occupied intervals in columns
        const intervals = this._placed
          .map((pid) => {
            if (pid === id) return null;
            const r = this._rects.get(pid);
            const m = this._eventsById[pid];
            if (!r || !m) return null;
            const ov =
              this._laneOverrides &&
              Object.prototype.hasOwnProperty.call(this._laneOverrides, pid)
                ? this._laneOverrides[pid]
                : undefined;
            const laneVal = Number.isFinite(ov)
              ? ov
              : Number.isFinite(m.lane)
                ? m.lane
                : 0;
            if (laneVal !== targetLane) return null;
            const sCol = this._yearToCol(m.guessStart);
            const wCol = Math.max(
              1,
              Math.round((m.guessEnd - m.guessStart) / this._gridSizeYears),
            );
            return { s: sCol, e: sCol + wCol };
          })
          .filter(Boolean)
          .sort((a, b) => a.s - b.s);

        // Corridor limits around drop column
        let leftBoundCol = minCol;
        let rightBoundCol = maxCol;
        intervals.forEach((iv) => {
          if (iv.e <= dropColRaw) {
            leftBoundCol = Math.max(leftBoundCol, iv.e);
          }
          if (iv.s >= dropColRaw + spanCols) {
            rightBoundCol = Math.min(rightBoundCol, iv.s - spanCols);
          }
        });

        // Initial start centered at drop, clamped to corridor
        let startCol = dropColRaw - Math.floor(spanCols / 2);
        startCol = Math.min(Math.max(startCol, leftBoundCol), rightBoundCol);

        // If overlapping, search nearest free start within corridor
        const isOccupied = (c) =>
          intervals.some((iv) => !(c + spanCols <= iv.s || c >= iv.e));
        if (isOccupied(startCol)) {
          let found = null;
          const maxDelta = Math.max(
            startCol - leftBoundCol,
            rightBoundCol - startCol,
          );
          for (let delta = 1; delta <= maxDelta; delta++) {
            const cRight = startCol + delta;
            const cLeft = startCol - delta;
            if (cRight <= rightBoundCol && !isOccupied(cRight)) {
              found = cRight;
              break;
            }
            if (cLeft >= leftBoundCol && !isOccupied(cLeft)) {
              found = cLeft;
              break;
            }
          }
          if (found != null) {
            startCol = found;
          } else {
            // No free space available; abort placement
            return;
          }
        }

        // Compute a drop_year that will center to startCol on the server
        const centerCol = startCol + Math.floor(spanCols / 2);
        const drop_year = this._colToYear(centerCol);

        // Persist lane override locally for immediate feedback
        this._laneOverrides = this._laneOverrides || {};
        this._laneOverrides[id] = targetLane;
        this.el.dataset.laneOverrides = JSON.stringify(this._laneOverrides);

        // Place with snapped center and desired lane
        this.pushEvent("place_from_pool", { id, drop_year, lane: targetLane });
      };

      // Bind listeners
      this.el.addEventListener("pointerdown", this._onPointerDown, {
        passive: false,
      });
      this.el.addEventListener("dragover", this._onDragOver);
      this.el.addEventListener("dragleave", this._onDragLeave);
      this.el.addEventListener("drop", this._onDrop);

      // Resize observer to keep canvas crisp
      this._ro = new ResizeObserver(() => {
        this._resizeCanvas();
        this._draw();
      });
      this._ro.observe(this.el);

      // Observe DaisyUI theme changes and redraw on theme switch
      this._themeObserver = new MutationObserver(() => {
        this._draw();
      });
      this._themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });

      // Initial size and draw
      this._resizeCanvas();
      this._draw();
    },
    updated() {
      // Refresh dataset and meta after LV updates
      const d = this.el.dataset;
      this._axisMin = parseInt(d.axisMin || "0", 10);
      this._axisMax = parseInt(d.axisMax || "1", 10);
      this._ticks = (d.ticks || "")
        .split(",")
        .map((t) => parseInt(t, 10))
        .filter((n) => Number.isFinite(n));
      this._placed = (d.placed || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      this._laneCount = parseInt(d.laneCount || `${this._laneCount || 1}`, 10);
      try {
        this._laneOverrides = d.laneOverrides
          ? JSON.parse(d.laneOverrides)
          : this._laneOverrides || {};
      } catch (_e) {}
      // Show answers removed; no truth overlays rendered

      // Re-read per-event guess values
      const dataRoot =
        document.getElementById("timeline-canvas-data") ||
        this.el.parentElement;
      if (dataRoot) {
        const items = Array.from(dataRoot.querySelectorAll("[data-id]"));
        items.forEach((el) => {
          const id = el.getAttribute("data-id");
          const meta = this._eventsById[id] || { id };
          meta.title = el.getAttribute("data-title") || meta.title || "";
          meta.start = parseInt(
            el.getAttribute("data-start") || `${meta.start || 0}`,
            10,
          );
          meta.end = parseInt(
            el.getAttribute("data-end") || `${meta.end || 1}`,
            10,
          );
          meta.guessStart = parseInt(
            el.getAttribute("data-guess-start") || `${meta.guessStart || 0}`,
            10,
          );
          meta.guessEnd = parseInt(
            el.getAttribute("data-guess-end") || `${meta.guessEnd || 1}`,
            10,
          );
          meta.image = el.getAttribute("data-image-src") || meta.image;
          meta.lane = parseInt(
            el.getAttribute("data-lane") || `${meta.lane || 0}`,
            10,
          );
          this._eventsById[id] = meta;
        });
      }

      // Redraw with updated size/layout
      this._resizeCanvas();
      this._draw();
    },
    destroyed() {
      this.el.removeEventListener("pointerdown", this._onPointerDown);
      this.el.removeEventListener("dragover", this._onDragOver);
      this.el.removeEventListener("dragleave", this._onDragLeave);
      this.el.removeEventListener("drop", this._onDrop);
      if (this._boundMove)
        window.removeEventListener("pointermove", this._boundMove);
      if (this._boundUp) window.removeEventListener("pointerup", this._boundUp);
      if (this._ro) this._ro.disconnect();
      if (this._themeObserver) this._themeObserver.disconnect();
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
