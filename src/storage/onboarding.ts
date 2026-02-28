/**
 * Onboarding checklist state for first-time users.
 * Steps: Create wallet → Get testnet BOING → Send a tx
 */

const STORAGE_KEY = 'boing-express-onboarding';

export interface OnboardingState {
  walletCreated: boolean;
  gotTestnetBoing: boolean;
  sentTx: boolean;
  dismissed: boolean;
}

const defaultState: OnboardingState = {
  walletCreated: false,
  gotTestnetBoing: false,
  sentTx: false,
  dismissed: false,
};

export function getOnboardingState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return defaultState;
  }
}

export function setOnboardingState(updates: Partial<OnboardingState>): void {
  try {
    const current = getOnboardingState();
    const next = { ...current, ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
}

export function markWalletCreated(): void {
  setOnboardingState({ walletCreated: true });
}

export function markGotTestnetBoing(): void {
  setOnboardingState({ gotTestnetBoing: true });
}

export function markSentTx(): void {
  setOnboardingState({ sentTx: true });
}

export function dismissOnboarding(): void {
  setOnboardingState({ dismissed: true });
}
