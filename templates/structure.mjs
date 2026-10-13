// How the atlas is organised: the pages in the left rail (in order) and the flows. Every scenario's `page` must be listed here.
export const PAGES = [
  { group: "Overview", pages: [{ name: "Flows", lede: "How a user moves between screens." }] },
  { group: "Screens", pages: [{ name: "Screens", lede: "Every screen." }] },
  // { group: "Foundations", pages: [{ name: "Foundations", lede: "Colour, type, space, shape, motion." }] },
  // { group: "UI kit", pages: [{ name: "Components", lede: "Every component in every variant." }] },
  // { group: "Moments", pages: [{ name: "Moments", lede: "Animations, recorded from the running app." }] },
];

// A flow is either `steps` (a journey: frame ids in order, with the label on the arrow INTO each step)
// or a `graph` (a sitemap: nodes placed on a grid, edges between them).
export const FLOWS = [
  // { id: "first-run", title: "First run", note: "from install to the first win", steps: [{ frame: "home", label: null }, { frame: "next", label: "Tap start" }] },
  // { id: "sitemap", title: "Sitemap", graph: { nodes: [{ frame: "home", col: 0, row: 0, label: "Home" }], edges: [{ from: "home", to: "x", label: "Open" }] } },
];
