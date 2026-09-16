import { Component, type ReactNode } from "react";

export class RootBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return <main className="panel">
        <h1>This page could not be displayed.</h1>
        <p role="alert">Reload to try again.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
        <a href="/">Back to home</a>
      </main>;
    }
    return this.props.children;
  }
}
