// The film's figures and its drawer scene, from one case. Pure: the home page runs it on the server and
// hands the film only this, never the case with its evidence, queries and graph.
import type { Case } from "../../src/agent/types";
import { buildFilm, type EvalFile, type FilmData, type PlantsFile } from "./model";
import { buildMicro, type MicroGeo } from "./micro";

export interface PreparedFilm {
  D: FilmData;
  micro: { svg: string; geo: MicroGeo };
}

export function prepareFilm(c: Case, plants: PlantsFile | null, ev: EvalFile | null): PreparedFilm {
  const D = buildFilm(c, plants, ev);
  return { D, micro: buildMicro(D.pockets, D.cabinet, D.totalLine) };
}
