import { useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  BoingBackground,
  EXPRESS_BG_CONFIGS,
  EXPRESS_REDUCED_MOTION_CONFIG,
} from '../lib/boing-bg-engine';
import styles from './AnimatedBackground.module.css';

/** Route → Express background config key */
function getConfigKey(pathname: string): keyof typeof EXPRESS_BG_CONFIGS {
  if (pathname === '/') return 'landing';
  if (pathname.startsWith('/wallet')) return 'wallet';
  if (pathname.startsWith('/docs') || pathname === '/privacy' || pathname === '/support' || pathname === '/terms')
    return 'docs';
  return 'landing';
}

/** Animated aquatic-space background (Boing Background Engine v2). Replaces static .webp. */
export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<InstanceType<typeof BoingBackground> | null>(null);
  const location = useLocation();

  const configKey = useMemo(() => getConfigKey(location.pathname), [location.pathname]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const baseConfig = EXPRESS_BG_CONFIGS[configKey];
    const config = prefersReducedMotion
      ? { ...baseConfig, ...EXPRESS_REDUCED_MOTION_CONFIG }
      : baseConfig;

    const bg = new BoingBackground(canvas, config);
    engineRef.current = bg;
    bg.start();

    return () => {
      bg.stop();
      engineRef.current = null;
    };
  }, [configKey]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden />;
}
