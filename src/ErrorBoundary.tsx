import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Last-resort recovery UI for storage, provider, or render failures. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Finverse render failure', error, info.componentStack)
  }

  private recover = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="fatal-error" role="alert">
        <div className="fatal-error-card">
          <div className="page-eyebrow">Finverse · Recovery</div>
          <h1 className="page-title">The terminal hit an error</h1>
          <p className="hint">Your saved portfolio was not deleted. Try rendering the app again, or reload the tab if the problem persists.</p>
          <div className="fatal-error-actions">
            <button className="btn btn--primary" type="button" onClick={this.recover}>Try again</button>
            <button className="btn btn--ghost" type="button" onClick={() => window.location.reload()}>Reload tab</button>
          </div>
        </div>
      </main>
    )
  }
}
