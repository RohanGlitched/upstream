import "../case-page.css";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the investigation">
      <header className="case-head">
        <div className="wrap">
          <span className="skel" style={{ width: 120, height: 14, marginBottom: 24 }} />
          <div className="case-head__grid">
            <div>
              <span className="skel" style={{ width: 280, height: 52 }} />
              <span className="skel skel-line" style={{ width: "90%", height: 20, marginTop: 18 }} />
              <span className="skel skel-line" style={{ width: "70%", height: 20 }} />
            </div>
            <div>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="skel skel-line" style={{ width: "100%", height: 18 }} />
              ))}
            </div>
          </div>
        </div>
      </header>
      <div className="wrap">
        <div className="panel case-trace__panel">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 24 }}>
            {[0, 1, 2, 3, 4].map((col) => (
              <div key={col}>
                {[0, 1, 2].map((r) => (
                  <span key={r} className="skel" style={{ height: 110, marginBottom: 14 }} />
                ))}
              </div>
            ))}
          </div>
          <span className="skel" style={{ height: 120, marginTop: 24 }} />
        </div>
      </div>
    </div>
  );
}
