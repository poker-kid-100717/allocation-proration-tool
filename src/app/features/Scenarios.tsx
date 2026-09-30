import { SCENARIOS } from "../../scenarios/catalog";
import { Badge, Card, PageHeader } from "../components/ui";
import { loadScenarioIntoLab } from "./Lab";

export function Scenarios() {
  return (
    <>
      <PageHeader eyebrow="Scenarios" title="Built-in scenarios">
        Worked examples of the problems allocation has to handle in payments and billing. Each one opens in the Allocation Lab, where you can change the
        inputs, compare strategies and record the result. All names and amounts are fictional.
      </PageHeader>
      <div className="scenario-grid">
        {SCENARIOS.map((s) => (
          <Card
            key={s.id}
            title={
              <>
                {s.title} <Badge>{s.category}</Badge>
              </>
            }
          >
            <p>{s.summary}</p>
            <p className="why">
              <strong>Why it's hard:</strong> {s.whyItMatters}
            </p>
            {s.reversal && (
              <p className="muted small">
                Includes a ${s.reversal.amount} partial refund. Record the allocation, then use the Reversals panel on its audit page.
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={() => loadScenarioIntoLab(s.id)}>
                Open in Lab
              </button>
              {/* The first variant is always the scenario as built, so "Open in Lab" covers it. */}
              {s.variants.slice(1).map((v) => (
                <button key={v.id} type="button" className="secondary" title={v.note} onClick={() => loadScenarioIntoLab(s.id, v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
            {s.variants.length > 0 && (
              <ul className="variant-notes">
                {s.variants.map((v) => (
                  <li key={v.id}>
                    <strong>{v.label}:</strong> {v.note}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
