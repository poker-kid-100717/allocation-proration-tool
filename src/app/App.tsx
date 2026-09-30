import { useEffect } from "react";
import { ENGINE_VERSION } from "../engine";
import { Audit } from "./features/Audit";
import { Dashboard } from "./features/Dashboard";
import { Docs } from "./features/Docs";
import { History } from "./features/History";
import { Lab } from "./features/Lab";
import { Rules } from "./features/Rules";
import { Scenarios } from "./features/Scenarios";
import { href, useRoute } from "./router";

const NAV = [
  { path: "", label: "Dashboard" },
  { path: "lab", label: "Allocation Lab" },
  { path: "scenarios", label: "Scenarios" },
  { path: "history", label: "History" },
  { path: "rules", label: "Rules" },
  { path: "docs", label: "Documentation" },
] as const;

const TITLES: Record<string, string> = { "": "Dashboard", lab: "Allocation Lab", scenarios: "Scenarios", history: "History", rules: "Rules", docs: "Documentation" };

export default function App() {
  const route = useRoute();
  const [section = "", id] = route.path;

  useEffect(() => {
    document.title = `${id ?? TITLES[section] ?? "Not found"} · Prorata`;
  }, [section, id]);

  let page;
  switch (section) {
    case "":
      page = <Dashboard />;
      break;
    case "lab":
      page = <Lab route={route} />;
      break;
    case "scenarios":
      page = <Scenarios />;
      break;
    case "history":
      page = id ? <Audit id={id} /> : <History />;
      break;
    case "rules":
      page = <Rules />;
      break;
    case "docs":
      page = <Docs />;
      break;
    default:
      page = (
        <p>
          Page not found. <a href={href("/")}>Go to the dashboard</a>
        </p>
      );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href={href("/")}>
          <span className="brand-mark" aria-hidden>
            ∑
          </span>
          <span>
            <strong>Prorata</strong>
            <small>Financial Allocation &amp; Proration Engine</small>
          </span>
        </a>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <a key={n.path} href={href(`/${n.path}`)} className={section === n.path ? "active" : ""} aria-current={section === n.path ? "page" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p>Every cent accounted for.</p>
          <p className="muted">
            Engine v{ENGINE_VERSION} · Demo environment: no real money, no customer data.
          </p>
          <a href="https://github.com/poker-kid-100717/allocation-proration-tool" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
      </aside>
      <main className="content" id="main">
        {page}
      </main>
    </div>
  );
}
