export interface Fixture {
  fixtureId: string;
  competition: string;
  participant1: string;
  participant2: string;
  kickoffIso: string;
  status: "scheduled" | "in_play" | "finalised";
}
