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
      this._headerH = 28;
      this._laneH = 44;
      this._laneGap = 12;
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
      this._showTruth =
        d.showTruth === "true" ||
        d.showTruth === true ||
        d.showTruth === "True";

      // Events meta from hidden DOM
      this._eventsById = {};
      this._imgCache = new Map();
      this._animX = new Map();
      this._rafScheduled = false;
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

      this._laneY = (idx) => {
        const y0 =
          this._padding.top +
          this._headerH +
          idx * (this._laneH + this._laneGap);
        return y0 + this._laneH / 2;
      };

      this._drawW = () =>
        this.el.width - (this._padding.left + this._padding.right);

      this._resizeCanvas = () => {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.el.getBoundingClientRect();
        // Dynamic height based on placed items
        const lanes = this._laneCount || Math.max(this._placed.length, 1);
        const heightCss =
          this._padding.top +
          this._headerH +
          lanes * (this._laneH + this._laneGap) -
          this._laneGap +
          this._padding.bottom;

        // Set intrinsic size for crisp drawing
        this.el.width = Math.max(1, Math.floor(rect.width * dpr));
        this.el.height = Math.max(1, Math.floor(heightCss * dpr));
        // Scale context
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Also set CSS height to match
        this.el.style.height = `${heightCss}px`;
      };

      this._draw = () => {
        const ctx = this._ctx;
        // Clear
        ctx.clearRect(0, 0, this.el.width, this.el.height);

        // Axis header line
        const axisY = this._padding.top + this._headerH / 2;
        ctx.strokeStyle =
          getComputedStyle(document.documentElement).getPropertyValue(
            "--fallback-b3",
          ) || "#ccc";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this._padding.left, axisY);
        ctx.lineTo(this._padding.left + this._drawW(), axisY);
        ctx.stroke();

        // Ticks and labels
        ctx.fillStyle = getComputedStyle(document.body).color || "#666";
        ctx.textBaseline = "top";
        ctx.font = "10px system-ui, sans-serif";
        this._ticks.forEach((t) => {
          const x = this._yearToX(t);
          ctx.strokeStyle = "rgba(0,0,0,0.2)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, axisY - 6);
          ctx.lineTo(x, axisY + 6);
          ctx.stroke();

          const text = this._formatYear(t);
          const tw = ctx.measureText(text).width;
          ctx.fillText(text, x - tw / 2, axisY + 8);
        });

        // Draw lanes: truth and blocks
        // Multi-lane packing based on current guess intervals (greedy non-overlap)
        this._rects.clear();
        const intervals = this._placed
          .map((pid) => {
            const m = this._eventsById[pid];
            return m ? { id: pid, s: m.guessStart, e: m.guessEnd } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.s - b.s || a.e - b.e);
        const laneEnds = [];
        const idToLane = {};
        intervals.forEach((iv) => {
          let laneIdx = laneEnds.findIndex((end) => iv.s >= end);
          if (laneIdx === -1) {
            laneIdx = laneEnds.length;
            laneEnds.push(iv.e);
          } else {
            laneEnds[laneIdx] = iv.e;
          }
          idToLane[iv.id] = laneIdx;
        });
        this._laneCount = Math.max(laneEnds.length, 1);
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

          // Guess block (fixed duration) with animated x-position
          const targetX = this._yearToX(meta.guessStart);
          let gx = this._animX.has(id) ? this._animX.get(id) : targetX;
          const gw = this._yearToX(meta.guessEnd) - targetX;
          if (Math.abs(targetX - gx) > 0.5) {
            gx = gx + (targetX - gx) * 0.2;
            this._animX.set(id, gx);
            this._rafScheduled = this._rafScheduled || false;
          } else {
            gx = targetX;
            this._animX.set(id, gx);
          }
          const gh = 28;

          // Bar
          ctx.fillStyle = "rgba(37, 99, 235, 0.85)"; // primary/80ish
          ctx.strokeStyle = "rgba(37, 99, 235, 0.95)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(gx, y - gh / 2, Math.max(6, gw), gh, 6);
          ctx.fill();
          ctx.stroke();

          // Thumbnail (if available)
          if (meta.image) {
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
              const size = gh - 8;
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
          const label = `${meta.title} (${this._formatYear(meta.start)} → ${this._formatYear(meta.end)})`;
          ctx.font = "12px system-ui, sans-serif";
          const small = gw < 100;
          ctx.fillStyle = "#fff";
          if (!small) {
            const tx = gx + 8;
            const ty = y - 6;
            ctx.fillText(label, tx, ty);
          } else {
            const tx = gx + Math.max(6, gw) / 2;
            const ty = y - gh / 2 - 14;
            ctx.fillStyle = getComputedStyle(document.body).color || "#333";
            const tw = ctx.measureText(label).width;
            // background bubble
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            const pad = 4;
            ctx.beginPath();
            ctx.roundRect(tx - tw / 2 - pad, ty - 10, tw + pad * 2, 16, 4);
            ctx.fill();
            // text
            ctx.fillStyle = getComputedStyle(document.body).color || "#333";
            ctx.fillText(label, tx - tw / 2, ty);
          }

          // Save rect for hit-testing
          this._rects.set(id, {
            x: gx,
            y: y - gh / 2,
            w: Math.max(6, gw),
            h: gh,
            lane: lane,
          });

          // Schedule animation frame if needed
          if (Math.abs(targetX - gx) > 0.5 && !this._rafScheduled) {
            this._rafScheduled = true;
            requestAnimationFrame(() => {
              this._rafScheduled = false;
              this._draw();
            });
          }
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
        const currentRect = this._rects.get(id);
        const lane = currentRect ? currentRect.lane : 0;
        const others = this._placed.filter((pid) => pid !== id);
        const intervals = others
          .map((pid) => {
            const r = this._rects.get(pid);
            if (!r || r.lane !== lane) return null;
            const m = this._eventsById[pid];
            return m ? { id: pid, s: m.guessStart, e: m.guessEnd } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.s - b.s);

        let leftBound = this._axisMin;
        let rightBound = this._axisMax - this._drag.duration;

        intervals.forEach((iv) => {
          // If interval is completely to the left of proposed block
          if (iv.e <= newStart) {
            leftBound = Math.max(leftBound, iv.e);
          }
          // If interval is completely to the right of proposed block
          if (iv.s >= newEnd) {
            rightBound = Math.min(rightBound, iv.s - this._drag.duration);
          }
        });

        // Clamp start within non-overlapping corridor
        newStart = Math.min(Math.max(newStart, leftBound), rightBound);
        newEnd = newStart + this._drag.duration;

        // Update local state
        meta.guessStart = newStart;
        meta.guessEnd = newEnd;

        // Push to LV
        this.pushEvent("set_guess", {
          id,
          guess_start: newStart,
          guess_end: newEnd,
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
        const dropYear = this._xToYear(e.clientX);
        this.pushEvent("place_from_pool", { id, drop_year: dropYear });
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
      this._showTruth =
        d.showTruth === "true" ||
        d.showTruth === true ||
        d.showTruth === "True";

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
