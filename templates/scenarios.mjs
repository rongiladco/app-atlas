// Every state shown in the atlas. A scenario is ONE state of the real app:
//   id      unique, kebab-case; the prefix groups it (home-*, onb-*, kit-*)
//   page    must exist in structure.mjs
//   title   what the state is, in the words of the product ("Empty inbox"), not of the code
//   note    one or two sentences a designer would want: why it looks like this, what the rule is
//   route   where to open it                 save  the seed for storage() in atlas.config.mjs
//   vp      m | d | k                        steps (page) => {}  play the app like a user to reach the state
//   expand  grow the viewport until nothing scrolls inside (for apps with inner scrollers)
//   video   record an animation: { video: true, duration: ms, steps: (page, { mark }) => { mark(); ... } }
//   covers  extra routes this scenario stands for (for dynamic routes like "/item/:id")
export const SCENARIOS = [
  { id: "home", page: "Screens", title: "Home", route: "/", note: "The first screen." },
];
