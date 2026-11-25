/** Language catalogues, starting with a shuffled multilingual home feed. */
export interface Region {
  /** Display name, also the queue label used by the player. */
  label: string;
  /** Catalogue queries for this region (one is typically enough). */
  queries: string[];
  /** One-line mood description shown under the name. */
  hint: string;
  /** Native background utility using the same chart palette as the PWA. */
  toneClassName: string;
}

export const REGIONS: Region[] = [
  {
    label: "Mix",
    queries: ["top english hits", "hindi songs", "tamil songs", "malayalam songs"],
    hint: "",
    toneClassName: "bg-chart-1",
  },
  {
    label: "Malayalam",
    queries: ["malayalam songs"],
    hint: "Kerala melodies",
    toneClassName: "bg-chart-3",
  },
  {
    label: "Tamil",
    queries: ["tamil songs"],
    hint: "Kollywood beats",
    toneClassName: "bg-chart-4",
  },
  {
    label: "Hindi",
    queries: ["hindi songs"],
    hint: "Bollywood & classics",
    toneClassName: "bg-chart-2",
  },
  {
    label: "Telugu",
    queries: ["telugu songs"],
    hint: "Tollywood hits",
    toneClassName: "bg-chart-1",
  },
  {
    label: "Punjabi",
    queries: ["punjabi songs"],
    hint: "Bhangra energy",
    toneClassName: "bg-chart-5",
  },
  {
    label: "English",
    queries: ["top english hits"],
    hint: "Global pop & rock",
    toneClassName: "bg-chart-6",
  },
  {
    label: "Kannada",
    queries: ["kannada songs"],
    hint: "Sandalwood tunes",
    toneClassName: "bg-chart-7",
  },
  {
    label: "Bengali",
    queries: ["bengali songs"],
    hint: "adda & melody",
    toneClassName: "bg-chart-2",
  },
  {
    label: "Marathi",
    queries: ["marathi songs"],
    hint: "pavni & mass",
    toneClassName: "bg-chart-3",
  },
  {
    label: "Gujarati",
    queries: ["gujarati songs"],
    hint: "garba beats",
    toneClassName: "bg-chart-4",
  },
  {
    label: "Bhojpuri",
    queries: ["bhojpuri songs"],
    hint: "high-voltage folk",
    toneClassName: "bg-chart-8",
  },
  {
    label: "Nepali",
    queries: ["nepali songs"],
    hint: "Himalayan folk",
    toneClassName: "bg-chart-1",
  },
  {
    label: "Arabic",
    queries: ["arabic songs"],
    hint: "oud & desert pop",
    toneClassName: "bg-chart-5",
  },
  {
    label: "K-pop",
    queries: ["korean pop songs"],
    hint: "Seoul stages",
    toneClassName: "bg-chart-6",
  },
];
