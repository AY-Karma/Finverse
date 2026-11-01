import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorScreen } from './ErrorScreen'

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
      <ErrorScreen code="APP ERROR" title="The workspace took a dip" description="Something interrupted the app. Try again to get back to your portfolio." alert>
        <button className="btn btn--primary" type="button" onClick={this.recover}>Try again</button>
        <p className="hint">Retrying doesn't clear your saved portfolio.</p>
      </ErrorScreen>
    )
  }
}
