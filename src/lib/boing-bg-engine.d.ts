/** Config for one page variant (opacity, colors, layer toggles). */
export interface BoingBgConfig {
  baseBg?: string[];
  accentColor?: string;
  starCount?: number;
  starColor?: string;
  starOpacityMin?: number;
  starOpacityMax?: number;
  nebulaEnabled?: boolean;
  nebulaClouds?: Array<{ x: number; y: number; r: number; color: string; opacity: number }>;
  shootingStarEnabled?: boolean;
  shootingStarColor?: string;
  shootingStarColor2?: string | null;
  shootingStarFrequency?: number;
  shootingStarCount?: number;
  waterlineEnabled?: boolean;
  waterlineY?: number;
  waterlineOpacity?: number;
  waterlineColor?: string;
  waterlineWaveAmp?: number;
  waterlineWaveFreq?: number;
  bubblesEnabled?: boolean;
  bubbleCount?: number;
  bubbleColor?: string;
  bubbleOpacityMin?: number;
  bubbleOpacityMax?: number;
  bubbleSizeMin?: number;
  bubbleSizeMax?: number;
  jellyfishEnabled?: boolean;
  jellyfishCount?: number;
  jellyfishColors?: string[];
  jellyfishOpacity?: number;
  jellyfishSizeMin?: number;
  jellyfishSizeMax?: number;
  coralEnabled?: boolean;
  coralCount?: number;
  coralColors?: string[];
  coralOpacity?: number;
  coralHeightFraction?: number;
  fishEnabled?: boolean;
  fishCount?: number;
  fishColor?: string;
  fishOpacity?: number;
  particlesEnabled?: boolean;
  gridEnabled?: boolean;
  [key: string]: unknown;
}

export class BoingBackground {
  constructor(canvas: HTMLCanvasElement, config: BoingBgConfig);
  start(): void;
  stop(): void;
}

export const EXPRESS_BG_CONFIGS: {
  landing: BoingBgConfig;
  wallet: BoingBgConfig;
  security: BoingBgConfig;
  docs: BoingBgConfig;
  faucet: BoingBgConfig;
};

export const EXPRESS_REDUCED_MOTION_CONFIG: BoingBgConfig;
