// Atlas harness (example, React). The engine copies this file into the app while capturing (see `kit.files` in
// atlas.config.mjs) and deletes it afterwards, so the real app and its build never contain it.
//   /atlas-kit?sheet=<id>
// Every specimen is the app's REAL component called with different props. Nothing here is a copy.
// Set `data-kit-ready` on the root once the sheet has rendered (the engine waits for it).
import React from "react";
import { Button } from "../src/components/Button"; // <- your real components

const SHEETS: Record<string, React.ReactNode> = {
  buttons: (
    <section>
      <h2>Button</h2>
      {(["primary", "secondary", "danger"] as const).map((variant) => (
        <div key={variant} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <Button variant={variant}>Default</Button>
          <Button variant={variant} disabled>Disabled</Button>
          <Button variant={variant} loading>Loading</Button>
          <Button variant={variant}>A very long label that has to wrap or truncate gracefully</Button>
        </div>
      ))}
    </section>
  ),
  // colors: read the real tokens and print each with its value and the contrast of the pairs the UI actually uses
};

export default function AtlasKit() {
  const sheet = new URLSearchParams(location.search).get("sheet") ?? "buttons";
  return <main data-kit-ready style={{ padding: 24, width: 1052 }}>{SHEETS[sheet]}</main>;
}
