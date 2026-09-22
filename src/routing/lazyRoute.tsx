import { Component, Suspense, lazy, useState, type ComponentType, type ComponentProps, type JSX, type ReactNode } from "react";

class RouteError extends Component<{
  children: ReactNode;
  onRetry: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <section className="panel">
      <p role="alert">This page could not be loaded.</p>
      <button type="button" onClick={this.props.onRetry}>Try again</button>
      <button type="button" onClick={() => window.location.reload()}>Reload page</button>
    </section>;
    return this.props.children;
  }
}

/** Recreate React's cached lazy promise on retry; reload also handles stale deploy URLs. */
export function lazyRoute<T extends ComponentType<ComponentProps<T>>>(load: () => Promise<{ default: T }>) {
  let current = lazy(load);
  return function LazyRoute(props: JSX.LibraryManagedAttributes<typeof current, ComponentProps<typeof current>> & JSX.IntrinsicAttributes) {
    const [{ Page, attempt }, setAttempt] = useState(() => ({ Page: current, attempt: 0 }));
    return <RouteError key={attempt} onRetry={() => {
      current = lazy(load);
      setAttempt({ Page: current, attempt: attempt + 1 });
    }}>
      <Suspense fallback={<p className="status" role="status">Loading page…</p>}>
        <Page {...props} />
      </Suspense>
    </RouteError>;
  };
}
