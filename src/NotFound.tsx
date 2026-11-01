import { ErrorScreen } from './ErrorScreen'

export function NotFound() {
  return <ErrorScreen code="404" title="This page is off the chart" description="This address does not lead to a page. Head back to your portfolio workspace.">
    <a className="btn btn--primary" href="/app">Back to Overview</a>
  </ErrorScreen>
}
