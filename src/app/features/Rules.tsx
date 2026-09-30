import { Card, PageHeader } from "../components/ui";
import { loadScenarioIntoLab } from "./Lab";

const PIPELINE = [
  ["Validate", "Every field is checked on its own: currency precision, non-negative amounts, unique IDs, real dates, positive weights. Every problem is reported, not just the first."],
  ["Resolve rules", "Obligation-level constraints and request-level rules are folded into one effective constraint per obligation. Contradictions, such as a fixed amount above the balance, are rejected."],
  ["Fixed amounts", "Obligations with a fixed allocation receive exactly that amount, off the top."],
  ["Minimums", "Minimum allocations are paid next. What those obligations can still take joins the split."],
  ["Strategy", "The chosen strategy splits the remaining pool, respecting every cap and re-splitting surplus from capped obligations."],
  ["Residual", "Shares are floored to whole minor units. The leftover units go to the largest fractional remainders, with a deterministic tie-break."],
  ["Invariants", "The result is checked before it is returned. If an invariant fails, the engine throws instead of returning a wrong amount."],
] as const;

const RULES: { kind: string; effect: string; combines: string; example: string }[] = [
  { kind: "cap (maximum)", effect: "The obligation never receives more than this amount, whatever the strategy says.", combines: "Lowest cap wins, and outstanding balance is always an implicit cap.", example: "Credit policy: at most $250 applied to any one invoice." },
  { kind: "minimum", effect: "Allocated before the split. The obligation then takes part in the split for the rest of its capacity.", combines: "Highest minimum wins. The request is rejected if minimums and fixed amounts exceed the amount.", example: "Always cover at least the $25 late fee." },
  { kind: "fixed", effect: "Receives exactly this amount and is left out of the split.", combines: "Two different fixed amounts for one obligation are an error, not a silent choice.", example: "Processor fee: $30.00 off the top of a settlement." },
  { kind: "exclude", effect: "Receives nothing. Its balance is untouched.", combines: "Can't be combined with fixed or minimum on the same obligation.", example: "Invoice under dispute: hold all credits." },
  { kind: "priority", effect: "Sets payment order for the priority strategy (lower is paid first) and breaks residual-cent ties in the others.", combines: "A request rule replaces the obligation's own priority.", example: "Pay the tax invoice first." },
  { kind: "weight / percentage", effect: "Relative weight for weighted and fixed + remaining splits. Normalised, so 50/30/20 and 5/3/2 give the same result.", combines: "A request rule replaces the obligation's own weight. Weights that look like percentages but don't total 100 produce a warning.", example: "Partner A 50%, Partner B 30%, Partner C 20%." },
];

export function Rules() {
  return (
    <>
      <PageHeader eyebrow="Rules" title="Constraints and rules">
        Rules are deliberately small: six kinds that cover what real allocation policies need, combined in a fixed order that doesn't depend on which rule
        was written first.
      </PageHeader>

      <Card title="Evaluation order">
        <ol className="pipeline">
          {PIPELINE.map(([name, text], i) => (
            <li key={name}>
              <span className="pipeline-n">{i + 1}</span>
              <div>
                <strong>{name}</strong>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Rule kinds">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Effect</th>
                <th>How it combines</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((r) => (
                <tr key={r.kind}>
                  <td className="nowrap">
                    <strong>{r.kind}</strong>
                  </td>
                  <td>{r.effect}</td>
                  <td>{r.combines}</td>
                  <td className="muted">{r.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="two-col">
        <Card title="Where rules come from">
          <p>
            Constraints can sit on an obligation (its <em>max</em>, <em>min</em>, <em>fixed</em>, <em>weight</em>, <em>priority</em> and <em>excluded</em>{" "}
            fields) or be listed as request-level rules with an optional reason. Both kinds show up in the audit record with their source, so you can
            always see which policy produced which limit.
          </p>
          <p>Capping isn't a separate strategy. It is enforced by the engine for every strategy, and no strategy can opt out.</p>
        </Card>
        <Card title="Try it">
          <p>The credit allocation scenario applies a $500 credit oldest-first, with a disputed invoice excluded and a per-invoice cap.</p>
          <button type="button" onClick={() => loadScenarioIntoLab("credit-allocation")}>
            Open credit allocation
          </button>
        </Card>
      </div>
    </>
  );
}
