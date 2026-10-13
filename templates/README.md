# Atlas

A visual atlas of the whole app, in the style of a Figma file: every screen, every state, the flows, the UI kit and the animations. **Everything is captured from the running app's real code**, not drawn, so it cannot drift without the checks below noticing.

Built and maintained with the `app-atlas` skill.

**Published (private):** _(Artifact link — filled in at first publish)_

## Commands

```bash
ATLAS=<path to app-atlas>/engine/atlas.mjs
# start the dev server first (the preview named in atlas.config.mjs), then:
node $ATLAS status  <app>        # what is stale / new / removed / not covered (exit 1 if anything)
node $ATLAS sync    <app>        # capture changed -> verify -> build -> status. Run after every UI change.
node $ATLAS capture <app> --all  # recapture everything
```

## Rules

- Add / change / remove a screen, state, flow or component ⇒ the scenario file changes in the same change, then `sync`.
- `status` must say `ATLAS CURRENT` before a change is merged.
- Routes deliberately left out (with the reason):
  - _none_
