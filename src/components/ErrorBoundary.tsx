import React from 'react';

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * Catches render errors so a single bad RPC value or corrupt localStorage entry
 * does not leave the app as a blank dark screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Boing Express]', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-primary, #f0f9ff)',
            background: 'var(--bg, #06080c)',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
          <p style={{ maxWidth: '28rem', color: 'var(--text-secondary, #94a3b8)', marginBottom: '1.5rem' }}>
            The wallet hit an unexpected error. If this started after a transaction, try reloading. You can also clear
            site data for boing.express if the problem persists.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '0.6rem 1.25rem',
              borderRadius: '8px',
              border: '1px solid rgba(0, 232, 200, 0.35)',
              background: 'rgba(0, 232, 200, 0.12)',
              color: '#00e8c8',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
