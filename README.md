# Coordination 2026 gossip slides

Reveal/Hugo slides for **A Self-Stabilizing Min-Max Consensus via Path-loop Detection**.

## Interactive demo structure

The demo slide is split into three layers:

1. `content/_generator.md`: slide markup only.
2. `static/js/gossip-simulator.js` and `static/css/gossip-simulator.css`: browser simulator and UI knobs.
3. `src/jsMain/kotlin/.../Experiments.kt`: Kotlin/JS entry point for Collektive-backed experiments.

The simulator accepts experiment implementations through a registry:

```js
globalThis.CollektiveExperiments["experiment-name"] = function(snapshot) {
  return snapshot.nodes.map(node => ({
    id: node.id,
    value: 0,
    label: "0",
  }));
};
```

The `snapshot` object has this shape:

```js
{
  nodes: [{ id, x, y }],
  edges: [{ source, target, distance }],
  parameters: {
    communicationRange,
    mobility,
  },
}
```

The returned value must be an array of per-device outputs:

```js
[{ id, value, label }]
```

## Available knobs

The slide currently exposes:

- number of devices,
- communication range,
- mobility,
- reset.

Each playground slide selects its experiment statically through the Hugo shortcode:

```markdown
{{< gossip-playground experiment="degree" >}}
{{< gossip-playground experiment="component-min" nodes="120" range="90" mobility="0.1" >}}
```

The selected name must match either a browser fallback in `static/js/gossip-simulator.js`
or an entry installed from `src/jsMain/kotlin/.../Experiments.kt`.

For a debugging slide where the experiment remains selectable at runtime, use:

```markdown
{{< gossip-playground experiment="degree" selectable="true" >}}
```

## Build the Kotlin/JS experiment bundle

```bash
./gradlew syncCollektiveExperimentsToHugoStatic
```

This compiles the Kotlin/JS browser executable and copies:

```text
build/dist/js/productionExecutable/collektive-experiments.js
```

to:

```text
static/js/collektive-experiments.js
```

Plain Hugo/Reveal previews still work without that generated file: the simulator falls back to built-in browser implementations.
