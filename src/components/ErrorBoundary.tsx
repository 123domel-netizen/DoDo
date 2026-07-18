import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Etykieta miejsca awarii do logu (np. "hub"). */
  label?: string;
  /** Kompaktowy fallback — pasek zamiast pełnego ekranu (dla sekcji). */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Łapie błędy renderowania, żeby awaria nie kończyła się czarnym ekranem:
 * wariant pełny dla całej aplikacji, kompaktowy dla sekcji (hub) — wtedy
 * reszta aplikacji (kalendarz, panel) dalej działa.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[ErrorBoundary:${this.props.label ?? "app"}]`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || String(this.state.error);

    if (this.props.compact) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm text-ink">Ta sekcja napotkała błąd.</p>
          <p className="max-w-md truncate text-[11px] text-ink-faint" title={message}>
            {message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink transition hover:bg-surface-raised"
          >
            Spróbuj ponownie
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-overlay p-6 text-center shadow-pop">
          <h1 className="mb-1 text-lg font-semibold text-ink">Coś poszło nie tak</h1>
          <p className="mb-4 text-sm text-ink-light">
            Aplikacja napotkała nieoczekiwany błąd. Odśwież stronę — Twoje dane są
            zapisane.
          </p>
          <p className="mb-4 break-words text-[11px] text-ink-faint">{message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-lg bg-accent-grad px-3 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Odśwież
          </button>
        </div>
      </div>
    );
  }
}
