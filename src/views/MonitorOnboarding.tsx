import { useId } from 'react'
import { ActionIcon } from './ActionIcon'
import { PortfolioWelcome } from './PortfolioWelcome'
import './monitorOnboarding.css'

export function MonitorOnboarding({ onRequestImport }: { onRequestImport: () => void }) {
  const headingId = useId()

  return <PortfolioWelcome variant="monitor" onRequestImport={onRequestImport}>
    <section className="mo-edition" aria-labelledby={headingId}>
      <header className="mo-edition-head">
        <h2 id={headingId}>Your first edition</h2>
        <span>Getting started</span>
      </header>

      <article className="mo-story">
        <span className="mo-story-icon"><ActionIcon name="import" /></span>
        <div>
          <h3>Bring in your holdings</h3>
          <p>Start with a holdings export from your broker.</p>
        </div>
      </article>

      <article className="mo-story">
        <span className="mo-story-icon"><ActionIcon name="review" /></span>
        <div>
          <h3>Check the details</h3>
          <p>Review your portfolio before anything is saved.</p>
          <details><summary>What can I review?</summary><p>Check holdings, quantities and costs. Confirm the account and statement date before saving.</p></details>
        </div>
      </article>

      <article className="mo-story">
        <span className="mo-story-icon"><ActionIcon name="bell" /></span>
        <div>
          <h3>Follow your investments</h3>
          <p>News and company updates, with your holdings in view.</p>
          <details><summary>Make it your own</summary><p>Save stories, set price watches and add reminders. You control external market data in Settings.</p></details>
        </div>
      </article>

      <footer className="mo-edition-footer"><ActionIcon name="privacy" /><span>Market data starts after import, when enabled.</span></footer>
    </section>
  </PortfolioWelcome>
}
