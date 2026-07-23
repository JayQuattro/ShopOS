const foundationItems = [
  {
    label: "Tenant boundaries",
    detail: "Organization and location policies are explicit and denial-tested.",
    state: "Ready",
  },
  {
    label: "Financial kernel",
    detail: "Labor, parts, fees, discounts, tax, and approval totals use minor units.",
    state: "Ready",
  },
  {
    label: "PostgreSQL model",
    detail: "The initial migration preserves tenant, estimate, and authorization history.",
    state: "Ready",
  },
  {
    label: "Identity & onboarding",
    detail: "Secure sessions and organization setup are the next implementation slice.",
    state: "Next",
  },
];

const workflow = [
  "Customer",
  "Asset",
  "Work order",
  "Estimate",
  "Authorization",
  "Invoice",
  "Payment",
];

export default function HomePage() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ShopOS home">
          <span className="brandMark" aria-hidden="true">
            SO
          </span>
          <span>
            <strong>ShopOS</strong>
            <small>Foundation workspace</small>
          </span>
        </a>
        <div className="context">
          <span className="contextDot" aria-hidden="true" />
          Bootstrap environment
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Open shop operations</p>
          <h1>Built around the work. Ready for every kind of shop.</h1>
          <p className="heroCopy">
            A trustworthy path from customer concern to completed, authorized, and paid work—without
            locking the shop into a proprietary runtime.
          </p>
          <div className="heroActions">
            <a className="primaryButton" href="#foundation">
              Review the foundation
            </a>
            <a className="textLink" href="/api/health">
              Check service health <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
        <aside className="workflowCard" aria-label="Initial repair workflow">
          <p className="cardLabel">Initial vertical workflow</p>
          <ol>
            {workflow.map((item, index) => (
              <li key={item}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item}
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="foundation" id="foundation">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Bootstrap status</p>
            <h2>The dependable pieces come first.</h2>
          </div>
          <p>
            This screen is an honest implementation marker—not a simulated shop workflow. Persisted
            operations arrive in vertical slices after identity and tenancy.
          </p>
        </div>

        <div className="foundationGrid">
          {foundationItems.map((item, index) => (
            <article key={item.label} className="foundationItem">
              <div className="itemNumber">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <div className="itemHeading">
                  <h3>{item.label}</h3>
                  <span className={item.state === "Ready" ? "status ready" : "status"}>
                    {item.state}
                  </span>
                </div>
                <p>{item.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <span>ShopOS · Bootstrap 0.1</span>
        <span>General domain, practical defaults.</span>
      </footer>
    </main>
  );
}
