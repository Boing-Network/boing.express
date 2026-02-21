/**
 * Full-page 3D elements: extracted hero robot and environment objects
 * placed across the entire viewport with depth and motion.
 * Uses manifest from hero_objects/ (same Python extraction output).
 */
import { useEffect, useState } from 'react';
import styles from './FullPage3DElements.module.css';

const HERO_OBJECTS_BASE = '/images/hero_objects';
const MANIFEST_URL = `${HERO_OBJECTS_BASE}/manifest.json`;

type Manifest = {
  environment?: string;
  robot: string | null;
  objects: string[];
} | null;

/** Placement slots for full-page 3D (viewport % and depth) */
const PLACEMENTS: { x: string; y: string; scale: number; depth: 'far' | 'mid' | 'near'; delay: number }[] = [
  { x: '8%', y: '18%', scale: 0.12, depth: 'far', delay: 0 },
  { x: '88%', y: '22%', scale: 0.1, depth: 'far', delay: 0.8 },
  { x: '12%', y: '45%', scale: 0.14, depth: 'mid', delay: 0.3 },
  { x: '85%', y: '50%', scale: 0.11, depth: 'mid', delay: 1.2 },
  { x: '78%', y: '72%', scale: 0.13, depth: 'far', delay: 0.5 },
  { x: '15%', y: '78%', scale: 0.1, depth: 'mid', delay: 1 },
  { x: '92%', y: '88%', scale: 0.09, depth: 'far', delay: 0.2 },
  { x: '50%', y: '35%', scale: 0.08, depth: 'far', delay: 0.6 },
  { x: '72%', y: '12%', scale: 0.07, depth: 'far', delay: 1.4 },
  { x: '25%', y: '58%', scale: 0.09, depth: 'mid', delay: 0.4 },
  { x: '60%', y: '82%', scale: 0.1, depth: 'far', delay: 1.1 },
];

export function FullPage3DElements() {
  const [manifest, setManifest] = useState<Manifest>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(MANIFEST_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Manifest) => {
        setManifest(data ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded || !manifest?.robot) return null;

  const envSrc = manifest.environment ? `${HERO_OBJECTS_BASE}/${manifest.environment}` : null;
  const allAssets = [manifest.robot, ...manifest.objects];
  const assetCount = allAssets.length;

  return (
    <div className={styles.wrapper} aria-hidden>
      {envSrc && (
        <div className={styles.envLayer}>
          <img src={envSrc} alt="" className={styles.envImg} />
        </div>
      )}
      <div className={styles.scene}>
        {PLACEMENTS.map((slot, i) => {
          const file = allAssets[i % assetCount];
          const src = `${HERO_OBJECTS_BASE}/${file}`;
          const isRobot = file === manifest.robot;
          return (
            <div
              key={`${slot.x}-${slot.y}-${i}`}
              className={`${styles.elt} ${styles[slot.depth]} ${isRobot ? styles.robot : ''}`}
              style={{
                left: slot.x,
                top: slot.y,
                width: `${slot.scale * 100}vw`,
                animationDelay: `${slot.delay}s`,
              }}
            >
              <img src={src} alt="" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
