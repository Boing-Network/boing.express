/**
 * Boing Express cinematic intro — "The Wallet Awakens"
 * Story: A dormant jellyfish receives a transaction spark, awakens, and
 * illuminates the ocean world, revealing the wallet. ~4.2s, skippable.
 * Respects prefers-reduced-motion. Seamlessly hands off to live background.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import styles from './InitialAnimation.module.css';

const TEAL = '#00e8c8';
const TEAL_R = 0;
const TEAL_G = 232;
const TEAL_B = 200;
const DEEP_BG = '#06080c';

const TOTAL_MS = 4200;
const REDUCED_MOTION_MS = 1800;

const T = {
  sparkStart: 0,
  sparkImpact: 600,
  flashPeak: 750,
  flashFade: 1100,
  jellyfishShow: 900,
  jellyPulse: 1200,
  waveExpand: 1600,
  waveEnd: 2800,
  revealStart: 2600,
  textShow: 2800,
  outroStart: 3400,
  end: 4200,
};

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}
function easeIn(t: number) {
  return t * t * t;
}
function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function invLerp(a: number, b: number, v: number) {
  return clamp((v - a) / (b - a), 0, 1);
}
function range(t0: number, t1: number, t: number) {
  return easeInOut(invLerp(t0, t1, t));
}

const STARS = Array.from({ length: 90 }, () => ({
  x: Math.random(),
  y: Math.random() * 0.45,
  r: 0.5 + Math.random() * 1.2,
  base: 0.1 + Math.random() * 0.5,
  phase: Math.random() * Math.PI * 2,
}));

export function InitialAnimation({ onComplete }: { onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const sceneTextRef = useRef<HTMLDivElement>(null);
  const [exiting, setExiting] = useState(false);
  const [visible, setVisible] = useState(true);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const doneRef = useRef(false);
  const textShownRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setExiting(true);
    const t = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 1100);
    return () => clearTimeout(t);
  }, [onComplete]);

  const skip = useCallback(() => {
    finish();
  }, [finish]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ctx = context;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const total = prefersReduced ? REDUCED_MOTION_MS : TOTAL_MS;

    let W = 0;
    let H = 0;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    function drawJellyfish(
      cx: number,
      cy: number,
      size: number,
      opacity: number,
      pulseScale: number,
      glowR: number,
      t: number
    ) {
      if (opacity <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = opacity;

      const s = size * pulseScale;
      const bellH = s * 0.55;
      const bellW = s * 0.5;

      if (glowR > 0) {
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        grd.addColorStop(0, `rgba(${TEAL_R},${TEAL_G},${TEAL_B},${opacity * 0.35})`);
        grd.addColorStop(0.5, `rgba(${TEAL_R},${TEAL_G},${TEAL_B},${opacity * 0.1})`);
        grd.addColorStop(1, 'rgba(0,232,200,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      const bellGrd = ctx.createRadialGradient(
        cx,
        cy - bellH * 0.2,
        bellH * 0.1,
        cx,
        cy,
        bellH
      );
      bellGrd.addColorStop(0, `rgba(${TEAL_R},${TEAL_G},${TEAL_B},${opacity * 0.9})`);
      bellGrd.addColorStop(0.6, `rgba(${TEAL_R},${TEAL_G},${TEAL_B},${opacity * 0.55})`);
      bellGrd.addColorStop(1, `rgba(${TEAL_R},${TEAL_G},${TEAL_B},${opacity * 0.1})`);
      ctx.fillStyle = bellGrd;
      ctx.beginPath();
      ctx.ellipse(cx, cy, bellW, bellH, 0, Math.PI, 0);
      ctx.fill();

      const numT = 7;
      for (let i = 0; i < numT; i++) {
        const tx = cx + (i / (numT - 1) - 0.5) * bellW * 1.6;
        const len = s * (0.6 + 0.3 * Math.sin(i * 1.3 + t * 0.002));
        const sway = Math.sin(t * 0.0015 + i * 0.8) * s * 0.12;
        ctx.beginPath();
        ctx.moveTo(tx, cy);
        ctx.bezierCurveTo(
          tx + sway * 0.3,
          cy + len * 0.3,
          tx + sway,
          cy + len * 0.7,
          tx + sway * 1.4,
          cy + len
        );
        ctx.strokeStyle = `rgba(${TEAL_R},${TEAL_G},${TEAL_B},${opacity * 0.35})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawCoralSilhouettes(opacity: number) {
      if (opacity <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = opacity * 0.18;

      function branch(x: number, y: number, angle: number, len: number, depth: number) {
        if (depth === 0 || len < 3) return;
        const ex = x + Math.cos(angle) * len;
        const ey = y + Math.sin(angle) * len;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.lineWidth = depth * 1.2;
        ctx.strokeStyle = TEAL;
        ctx.stroke();
        const jitter = 0.15 * Math.sin(x * 0.01 + depth) * Math.cos(y * 0.01);
        branch(ex, ey, angle - 0.4 + jitter, len * 0.68, depth - 1);
        branch(ex, ey, angle + 0.4 - jitter, len * 0.68, depth - 1);
      }

      const coralPositions = [
        { x: W * 0.06, baseLen: H * 0.14 },
        { x: W * 0.16, baseLen: H * 0.1 },
        { x: W * 0.82, baseLen: H * 0.12 },
        { x: W * 0.92, baseLen: H * 0.09 },
        { x: W * 0.72, baseLen: H * 0.08 },
      ];
      coralPositions.forEach((c) => {
        branch(c.x, H, -Math.PI / 2, c.baseLen, 5);
      });
      ctx.restore();
    }

    function drawStars(opacity: number, t: number) {
      if (opacity <= 0.001) return;
      ctx.save();
      STARS.forEach((s) => {
        const twinkle = s.base + 0.15 * Math.sin(t * 0.001 + s.phase);
        ctx.globalAlpha = opacity * twinkle;
        ctx.fillStyle = '#e0f8ff';
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    function drawWaterline(opacity: number, t: number) {
      if (opacity <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = opacity;
      const wy = H * 0.38;
      ctx.beginPath();
      ctx.moveTo(0, wy);
      for (let x = 0; x <= W; x += 4) {
        const y =
          wy +
          Math.sin(x * 0.007 + t * 0.0008) * 4 +
          Math.sin(x * 0.013 - t * 0.0005) * 2;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${TEAL_R},${TEAL_G},${TEAL_B},0.55)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    const scaleT = (t: number) => (prefersReduced ? (t / TOTAL_MS) * total : t);
    const endScaled = scaleT(T.end);

    function render(ts: number) {
      if (doneRef.current) return;
      if (!startTimeRef.current) startTimeRef.current = ts;
      const t = scaleT(ts - startTimeRef.current);

      if (progressRef.current) {
        progressRef.current.style.width = Math.min(100, (t / endScaled) * 100) + '%';
      }

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = DEEP_BG;
      ctx.fillRect(0, 0, W, H);

      const tSparkImpact = scaleT(T.sparkImpact);
      const tFlashPeak = scaleT(T.flashPeak);
      const tFlashFade = scaleT(T.flashFade);
      const tJellyfishShow = scaleT(T.jellyfishShow);
      const tJellyPulse = scaleT(T.jellyPulse);
      const tWaveExpand = scaleT(T.waveExpand);
      const tWaveEnd = scaleT(T.waveEnd);
      const tRevealStart = scaleT(T.revealStart);
      const tTextShow = scaleT(T.textShow);

      if (t < tSparkImpact) {
        const p = t / tSparkImpact;
        const ep = easeIn(p);
        const sx = lerp(W * -0.05, W * 0.5, ep);
        const sy = lerp(H * -0.05, H * 0.5, ep);
        const trailLen = 60;
        for (let i = 0; i < trailLen; i++) {
          const tp = i / trailLen;
          const tx = lerp(W * -0.05, sx, tp);
          const ty = lerp(H * -0.05, sy, tp);
          const ta = (i / trailLen) * 0.7 * p;
          ctx.save();
          ctx.globalAlpha = ta;
          ctx.fillStyle = TEAL;
          ctx.shadowBlur = 12;
          ctx.shadowColor = TEAL;
          ctx.beginPath();
          ctx.arc(tx, ty, 1.5 + tp * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 24;
        ctx.shadowColor = TEAL;
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const flashP = invLerp(tSparkImpact, tFlashPeak, t);
      const flashFadeP = invLerp(tFlashPeak, tFlashFade, t);
      const flashOpacity =
        t < tFlashPeak ? easeOut(flashP) * 0.85 : (1 - easeIn(flashFadeP)) * 0.85;
      if (flashOpacity > 0.001) {
        const fr = lerp(
          0,
          W * 0.6,
          easeOut(invLerp(tSparkImpact, tFlashFade, t))
        );
        const grd = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, fr);
        grd.addColorStop(0, `rgba(255,255,255,${flashOpacity * 0.9})`);
        grd.addColorStop(0.15, `rgba(${TEAL_R},${TEAL_G},${TEAL_B},${flashOpacity * 0.7})`);
        grd.addColorStop(0.5, `rgba(${TEAL_R},${TEAL_G},${TEAL_B},${flashOpacity * 0.2})`);
        grd.addColorStop(1, 'rgba(0,232,200,0)');
        ctx.save();
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      const jellyOpacity = clamp(
        range(tJellyfishShow, tJellyfishShow + 400, t),
        0,
        1
      );
      const pulseP = range(tJellyPulse, tJellyPulse + 500, t);
      const pulseScale = 1 + Math.sin(pulseP * Math.PI) * 0.25;
      const jellyGlowR = lerp(
        30,
        120,
        easeOut(range(tJellyPulse, tJellyPulse + 600, t))
      );
      if (jellyOpacity > 0) {
        drawJellyfish(
          W / 2,
          H * 0.52,
          Math.min(W, H) * 0.18,
          jellyOpacity,
          pulseScale,
          jellyGlowR,
          t
        );
      }

      const waveP = range(tWaveExpand, tWaveEnd, t);
      if (waveP > 0) {
        const wR = easeOut(waveP) * Math.max(W, H) * 1.2;
        const wO = (1 - waveP) * 0.45;
        if (wO > 0) {
          const grd = ctx.createRadialGradient(
            W / 2,
            H / 2,
            wR * 0.85,
            W / 2,
            H / 2,
            wR
          );
          grd.addColorStop(0, 'rgba(0,232,200,0)');
          grd.addColorStop(0.7, `rgba(${TEAL_R},${TEAL_G},${TEAL_B},${wO * 0.6})`);
          grd.addColorStop(1, 'rgba(0,232,200,0)');
          ctx.save();
          ctx.fillStyle = grd;
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
      }

      const bgRevealP = clamp(range(tWaveExpand, tWaveEnd, t), 0, 1);
      drawStars(bgRevealP * 0.7, t);
      drawWaterline(bgRevealP * 0.55, t);
      drawCoralSilhouettes(bgRevealP);

      const darkFade = 1 - clamp(range(tRevealStart, endScaled, t), 0, 1);
      if (darkFade > 0.001) {
        ctx.save();
        ctx.globalAlpha = darkFade * 0.75;
        ctx.fillStyle = DEEP_BG;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      if (t >= tTextShow && !textShownRef.current && sceneTextRef.current) {
        textShownRef.current = true;
        sceneTextRef.current.innerHTML = `
          <div class="${styles.sceneLabel}">Your Wallet. Your Keys.</div>
          <div class="${styles.sceneTitle}">Boing Express</div>
          <div class="${styles.sceneSub}">Non-custodial. Secure. Yours.</div>
        `;
        sceneTextRef.current.classList.add(styles.sceneShow);
      }

      if (t >= endScaled) {
        finish();
        return;
      }

      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [finish]);

  if (!visible) return null;

  return (
    <div
      className={`${styles.wrapper} ${exiting ? styles.fadeOut : ''}`}
      role="img"
      aria-label="Boing Express — The Wallet Awakens"
    >
      <button
        type="button"
        className={styles.skipBtn}
        onClick={skip}
        aria-label="Skip intro"
      >
        Skip ›
      </button>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
      <div ref={sceneTextRef} className={styles.sceneText} />
      <div ref={progressRef} className={styles.progressBar} />
    </div>
  );
}
