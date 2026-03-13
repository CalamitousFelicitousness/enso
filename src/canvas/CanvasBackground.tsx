import { useRef, useEffect, useCallback } from "react";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { useUiStore } from "@/stores/uiStore";
import type { ViewportBus } from "./viewportBus";

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface CanvasBackgroundProps {
  width: number;
  height: number;
  viewport: Viewport;
  bus?: ViewportBus;
}

// --- Colors ---

const BG = { dark: "#0a0a0f", light: "#fafafc" };
const DOT = { dark: "rgba(30, 30, 46, 0.4)", light: "rgba(221, 221, 232, 0.35)" };

// --- Draw: Dot Field ---

function drawDotField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  vp: Viewport,
  mode: "dark" | "light",
) {
  ctx.fillStyle = BG[mode];
  ctx.fillRect(0, 0, w, h);

  const spacing = 24;
  const ss = spacing * vp.scale;
  if (ss < 4 || ss > 200) return;

  const ox = ((vp.x % ss) + ss) % ss;
  const oy = ((vp.y % ss) + ss) % ss;
  const r = Math.max(0.5, 1.5 * vp.scale);

  ctx.fillStyle = DOT[mode];
  ctx.beginPath();
  for (let x = ox; x < w; x += ss) {
    for (let y = oy; y < h; y += ss) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

// --- Draw: Woven Noise ---

// mulberry32 PRNG
function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateNoiseData(w: number, h: number, mode: "dark" | "light"): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Fill background
  ctx.fillStyle = BG[mode];
  ctx.fillRect(0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Apply seeded noise
  const rand = mulberry32(42);
  const amplitude = 3;
  for (let i = 0; i < data.length; i += 4) {
    const noise = Math.floor((rand() - 0.5) * 2 * amplitude);
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }

  // Radial vignette
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxR;
      // Fade noise toward edges
      const fade = 1 - dist * dist * 0.3;
      const idx = (y * w + x) * 4;
      const bg = mode === "dark" ? [10, 10, 15] : [250, 250, 252];
      data[idx] = Math.round(bg[0] + (data[idx] - bg[0]) * fade);
      data[idx + 1] = Math.round(bg[1] + (data[idx + 1] - bg[1]) * fade);
      data[idx + 2] = Math.round(bg[2] + (data[idx + 2] - bg[2]) * fade);
    }
  }

  return imageData;
}

function drawWovenNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mode: "dark" | "light",
  cachedNoise: React.RefObject<{ data: ImageData; w: number; h: number; mode: string } | null>,
) {
  const cache = cachedNoise.current;
  if (cache && cache.w === w && cache.h === h && cache.mode === mode) {
    ctx.putImageData(cache.data, 0, 0);
    return;
  }

  const imageData = generateNoiseData(w, h, mode);
  ctx.putImageData(imageData, 0, 0);
  cachedNoise.current = { data: imageData, w, h, mode };
}

// --- Draw: Isometric Blueprint ---

function drawIsometric(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  vp: Viewport,
  mode: "dark" | "light",
) {
  ctx.fillStyle = BG[mode];
  ctx.fillRect(0, 0, w, h);

  const accent = mode === "dark" ? "rgba(0, 188, 212," : "rgba(0, 120, 150,";

  // Minor orthogonal grid (12px)
  const minorSpacing = 12;
  const minorSS = minorSpacing * vp.scale;
  if (minorSS >= 4) {
    ctx.strokeStyle = `${accent} 0.015)`;
    ctx.lineWidth = 1;
    ctx.beginPath();

    const ox = ((vp.x % minorSS) + minorSS) % minorSS;
    const oy = ((vp.y % minorSS) + minorSS) % minorSS;

    for (let x = ox; x < w; x += minorSS) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = oy; y < h; y += minorSS) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }

  // Major horizontal lines (48px)
  const majorSpacing = 48;
  const majorSS = majorSpacing * vp.scale;
  if (majorSS >= 8) {
    ctx.strokeStyle = `${accent} 0.025)`;
    ctx.lineWidth = 1;
    ctx.beginPath();

    const oy = ((vp.y % majorSS) + majorSS) % majorSS;
    for (let y = oy; y < h; y += majorSS) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }

  // Major isometric lines (48px spacing at 30°)
  if (majorSS >= 8) {
    ctx.strokeStyle = `${accent} 0.03)`;
    ctx.lineWidth = 1;
    const tan30 = Math.tan(Math.PI / 6); // ~0.577

    // Lines going bottom-left to top-right (30° from horizontal)
    const ox = ((vp.x % majorSS) + majorSS) % majorSS;
    const rise = h;
    const run = rise / tan30;
    const count = Math.ceil((w + run) / majorSS) + 1;

    ctx.beginPath();
    for (let i = -Math.ceil(run / majorSS); i < count; i++) {
      const startX = ox + i * majorSS;
      ctx.moveTo(startX, h);
      ctx.lineTo(startX + run, 0);
    }

    // Lines going top-left to bottom-right (mirrored)
    for (let i = -Math.ceil(run / majorSS); i < count; i++) {
      const startX = ox + i * majorSS;
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX + run, h);
    }
    ctx.stroke();
  }
}

// --- Component ---

export function CanvasBackground({ width, height, viewport, bus }: CanvasBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const noiseCache = useRef<{ data: ImageData; w: number; h: number; mode: string } | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const mode = useResolvedTheme();
  const pattern = useUiStore((s) => s.canvasBackground);

  // Get canvas context, only reallocating the buffer when dimensions change
  const getCtx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return null;

    const dpr = window.devicePixelRatio || 1;

    if (canvasSizeRef.current.w !== width || canvasSizeRef.current.h !== height) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvasSizeRef.current = { w: width, h: height };
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.scale(dpr, dpr);
      ctxRef.current = ctx;
    }

    const ctx = ctxRef.current;
    if (!ctx) return null;
    // Reset transform to DPR scale (draw functions assume clean state)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }, [width, height]);

  // Viewport-aware patterns: redraw on store-driven changes (auto-fit, mode switch)
  useEffect(() => {
    if (pattern === "noise") return;
    const ctx = getCtx();
    if (!ctx) return;

    if (pattern === "dots") drawDotField(ctx, width, height, viewport, mode);
    else drawIsometric(ctx, width, height, viewport, mode);
  }, [getCtx, width, height, viewport, mode, pattern]);

  // Bus-driven imperative redraw during pan/zoom gesture (rAF-coalesced)
  useEffect(() => {
    if (!bus) return;
    let pendingVp: Viewport | null = null;
    let rafId: number | null = null;

    const unsub = bus.subscribe((vp) => {
      pendingVp = vp;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!pendingVp || pattern === "noise") return;
        const ctx = getCtx();
        if (!ctx) return;
        if (pattern === "dots") drawDotField(ctx, width, height, pendingVp, mode);
        else drawIsometric(ctx, width, height, pendingVp, mode);
        pendingVp = null;
      });
    });

    return () => {
      unsub();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [bus, pattern, getCtx, width, height, mode]);

  // Static noise: only redraw on resize or mode change
  useEffect(() => {
    if (pattern !== "noise") return;
    const ctx = getCtx();
    if (!ctx) return;

    drawWovenNoise(ctx, width, height, mode, noiseCache);
  }, [getCtx, width, height, mode, pattern]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: "none",
      }}
    />
  );
}
