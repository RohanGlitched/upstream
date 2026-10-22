// The supply-chain graph the World Model recorded for this case, laid out in columns by depth.
import { tallMan } from "../../src/agent/util";
import "./graph.css";

interface GNode {
  id: string;
  type: string;
  key: string;
  label: string;
  attrs: Record<string, unknown>;
  depth: number;
}
interface GEdge {
  id: string;
  from: string;
  to: string;
  type: string;
}
export interface Graph {
  roots: string[];
  nodes: GNode[];
  edges: GEdge[];
  counts: Record<string, number>;
}

const TYPE_WORD: Record<string, string> = {
  HospitalItem: "hospital items",
  Package: "packages",
  Product: "products",
  Drug: "drug",
  Labeler: "labelers",
  Site: "plants",
  Shortage: "shortage",
  Inspection: "inspections",
  WarningLetter: "warning letters",
  ImportAlert: "import alerts",
  Recall: "recalls",
};

const COLS = ["Our items", "Packages", "Products", "Labelers and plants", "FDA records"];

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function nodeLabel(n: GNode): string {
  const key = n.key.replace(/^[a-z-]+:/, "");
  switch (n.type) {
    case "HospitalItem":
      return clip(tallMan(n.label.replace(/^Corvale\s+/, "")), 24);
    case "Package":
      return `NDC ${key}`;
    case "Product":
      return `Product ${key}`;
    case "Inspection":
      return `Inspection ${key}${n.attrs.classification ? `, ${n.attrs.classification}` : ""}`;
    case "WarningLetter":
      return `Warning letter ${key}`;
    case "ImportAlert":
      return `Import alert ${key}`;
    case "Shortage":
      return "FDA shortage listing";
    case "Drug":
      return n.label;
    default:
      return clip(tallMan(n.label), 34);
  }
}

function tone(n: GNode): string {
  if (n.type === "Inspection") return n.attrs.classification === "OAI" ? "signal" : n.attrs.classification === "VAI" ? "caution" : "plain";
  if (n.type === "WarningLetter" || n.type === "ImportAlert") return "signal";
  if (n.type === "Shortage") return "ink";
  if (n.type === "Site") return "site";
  return "plain";
}

export function CaseGraph({ graph }: { graph: Graph | undefined }) {
  if (!graph || !graph.nodes.length) {
    return (
      <div className="notice">
        <span className="notice__mark" aria-hidden="true">i</span>
        <h3>No graph was recorded for this case</h3>
        <p>The World Model records the chain as the investigation runs. This recording has none to draw.</p>
      </div>
    );
  }
  const maxDepth = Math.max(...graph.nodes.map((n) => n.depth));
  const cols: GNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of graph.nodes) cols[n.depth].push(n);

  // Order each column by the average position of its parents, so edges cross less.
  const index = new Map<string, number>();
  cols[0].forEach((n, i) => index.set(n.id, i));
  const parents = new Map<string, string[]>();
  for (const e of graph.edges) {
    const a = parents.get(e.to) ?? [];
    a.push(e.from);
    parents.set(e.to, a);
    const b = parents.get(e.from) ?? [];
    b.push(e.to);
    parents.set(e.from, b);
  }
  for (let d = 1; d < cols.length; d++) {
    const score = (n: GNode) => {
      const ps = (parents.get(n.id) ?? []).filter((p) => index.has(p));
      return ps.length ? ps.reduce((a, p) => a + index.get(p)!, 0) / ps.length : 1e6;
    };
    cols[d].sort((a, b) => score(a) - score(b) || a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
    cols[d].forEach((n, i) => index.set(n.id, i));
  }

  // wide enough that most node names fit whole; the full name is in each node's title on hover
  const W = 1200;
  const ROW = 27;
  const TOP = 40;
  const colW = W / cols.length;
  const nodeW = colW - 30;
  const tallest = Math.max(...cols.map((c) => c.length));
  const H = TOP + tallest * ROW + 16;
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, d) => {
    const offset = ((tallest - c.length) * ROW) / 2;
    c.forEach((n, i) => pos.set(n.id, { x: d * colW + 4, y: TOP + offset + i * ROW }));
  });

  return (
    <figure className="graph">
      <p className="graph-hint" aria-hidden="true">
        Scroll sideways to read the whole graph
      </p>
      <div className="graph-scroll" tabIndex={0} role="region" aria-label="World Model graph, scrolls sideways">
        <svg viewBox={`0 0 ${W} ${H}`} className="graph-svg" role="img" aria-label={`Supply-chain graph: ${graph.nodes.length} records and ${graph.edges.length} links`}>
          {COLS.slice(0, cols.length).map((t, d) => (
            <text key={t} x={d * colW + 4} y={16} className="g-col">
              {t}
            </text>
          ))}
          {graph.edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const [s, t] = a.x <= b.x ? [a, b] : [b, a];
            const x1 = s.x + nodeW;
            const y1 = s.y + 9;
            const x2 = t.x;
            const y2 = t.y + 9;
            const mx = (x1 + x2) / 2;
            return <path key={e.id} d={`M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} className={`g-edge g-edge--${e.type}`} />;
          })}
          {graph.nodes.map((n) => {
            const p = pos.get(n.id)!;
            return (
              <g key={n.id} className={`g-node g-node--${tone(n)}`} transform={`translate(${p.x} ${p.y})`}>
                <rect width={nodeW} height={19} rx={4} />
                <circle cx={9} cy={9.5} r={3.5} />
                <text x={18} y={13.5}>
                  {nodeLabel(n)}
                </text>
                <title>{`${n.type}: ${n.label}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="graph-cap">
        {Object.entries(graph.counts)
          .map(([k, v]) => `${v} ${TYPE_WORD[k] ?? k}`)
          .join(", ")}
        . Every link carries its source and the time it was recorded.
      </figcaption>
    </figure>
  );
}
