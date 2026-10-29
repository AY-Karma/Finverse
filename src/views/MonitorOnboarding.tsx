import { ActionIcon } from './ActionIcon'
import { MonitorNewsIcon } from './MonitorNewsIcon'
import './monitorOnboarding.css'

export function MonitorOnboarding({ onRequestImport }: { onRequestImport: () => void }) {
  return <div className="monitor-onboarding enter">
    <header className="mp-hero"><div className="mp-hero-main">
      <div><h1>Monitor</h1><p>A first edition, before your portfolio makes the news.</p></div>
    </div></header>

    <section className="mn-panel mo-edition" aria-labelledby="monitor-onboarding-heading">
      <header className="mn-head">
        <span className="mn-heading-icon" aria-hidden="true"><MonitorNewsIcon /></span>
        <h2 id="monitor-onboarding-heading">Your first edition</h2>
        <span className="mo-edition-label">Getting started</span>
      </header>

      <article className="mn-story mo-lead">
        <div className="mn-story-meta"><span>Finverse guide</span><span className="mo-category">Start here</span></div>
        <h3>Your portfolio,<br /><span>fresh off the spreadsheet.</span></h3>
        <p>Bring in a holdings export. This feed will become a place for news and updates around the investments you own.</p>
        <div className="mo-import">
          <button className="btn btn--import" type="button" aria-haspopup="dialog" onClick={onRequestImport}><ActionIcon name="import" />Import holdings</button>
          <span>.xlsx / .xls / .csv</span>
        </div>
        <div className="mo-note"><ActionIcon name="privacy" /><span>No broker login. You review the file before saving.</span></div>
      </article>

      <article className="mn-story mo-story">
        <div className="mn-story-meta"><span>Behind the scenes</span><span className="mo-category">Before you save</span></div>
        <h3>Every good story starts with a fact-check.</h3>
        <p>Preview your holdings and check the details before adding them to your portfolio.</p>
        <details><summary>What can I review?</summary><p>Check the holdings, quantities, and costs read from your file. Confirm the account and statement date before saving.</p></details>
      </article>

      <article className="mn-story mo-story">
        <div className="mn-story-meta"><span>Coming up</span><span className="mo-category">After import</span></div>
        <h3>The stories behind your holdings.</h3>
        <p>Once your portfolio is saved, news, company updates, and announced events can join the feed.</p>
        <details><summary>Make it your own</summary><p>Save a story for later, set a price watch, or add a reminder. Market data follows your preference in Settings.</p></details>
      </article>

      <footer className="mo-edition-footer"><span className="mo-standby-dot" aria-hidden="true" />Market data starts after your first import, when enabled.</footer>
    </section>
  </div>
}
