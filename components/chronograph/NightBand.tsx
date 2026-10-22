// The home page's night band: the chronograph, compact, linking to the plant atlas. A server component; drop it in as
// <NightBand />. It reads data/plants.json, the FDA history and the recorded cases itself.
import { Chronograph } from "./Chronograph";
import { loadChronoData } from "./data";
import { fmtIso } from "./model";
import "./nightband.css";

export async function NightBand({ title = "The world behind our shelf" }: { title?: string }) {
  const data = await loadChronoData();
  if (!data.plants.length) return null;
  const countries = data.countries.length;
  const top = data.countries.slice(0, 2);
  const share = top[0] ? Math.round((top[0].n / data.plants.length) * 100) : 0;
  return (
    <section className="nightband" aria-labelledby="nightband-title">
      <div className="nightband__in">
        <Chronograph
          data={data}
          variant="band"
          intro={
            <>
              <h2 id="nightband-title">{title}</h2>
              <p>
                {data.plants.length} plants in {countries} countries make what Corvale stocks. Each is drawn by its true
                distance and bearing from us. The bezel replays every inspection, warning letter and import alert FDA
                recorded there since 2022.
              </p>
              {top.length === 2 ? (
                <p className="nightband__fact">
                  {share}% sit in one country. Records as of {fmtIso(data.asOf)}.
                </p>
              ) : null}
            </>
          }
        />
      </div>
    </section>
  );
}
