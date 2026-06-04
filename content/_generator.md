
+++

title = "A Self-Stabilizing Min-Max Consensus via Path-loop Detection"
description = "Pre-initialized slides from the paper summary"
outputs = ["Reveal"]

+++


# A Self-Stabilizing Min-Max Consensus via Path-loop Detection

### [Angela Cortecchia](angela.cortecchia@unibo.it), [Danilo Pianini](danilo.pianini@unibo.it), [Mirko Viroli](mirko.viroli@unibo.it)

---

## Problem

- Gossip is scalable and decentralized
- Classical min/max gossip is **not self-stabilizing**
- Once a stale or corrupted “best” value appears, it can persist forever

---

  <div id="hud">
    <div>Devices: <span id="n"></span></div>
    <div>Edges: <span id="m"></span></div>
    <div>Backend: <span id="backend"></span></div>
  </div>

<canvas id="canvas"></canvas>

  <script type="module">
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const nLabel = document.getElementById("n");
    const mLabel = document.getElementById("m");
    const backendLabel = document.getElementById("backend");

    const DEVICE_COUNT = 80;
    const RADIO_RANGE = 120;
    const SPEED = 0.35;

    const devices = Array.from({ length: DEVICE_COUNT }, (_, id) => ({
      id,
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      vx: (Math.random() - 0.5) * SPEED,
      vy: (Math.random() - 0.5) * SPEED,
      value: 0
    }));

    function resize() {
      const dpr = devicePixelRatio || 1;
      canvas.width = Math.floor(innerWidth * dpr);
      canvas.height = Math.floor(innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    addEventListener("resize", resize);
    resize();

    function moveDevices() {
      for (const d of devices) {
        d.x += d.vx;
        d.y += d.vy;

        if (d.x < 0 || d.x > innerWidth) d.vx *= -1;
        if (d.y < 0 || d.y > innerHeight) d.vy *= -1;

        d.x = Math.max(0, Math.min(innerWidth, d.x));
        d.y = Math.max(0, Math.min(innerHeight, d.y));

        // random displacement jitter
        d.vx += (Math.random() - 0.5) * 0.03;
        d.vy += (Math.random() - 0.5) * 0.03;

        const norm = Math.hypot(d.vx, d.vy) || 1;
        d.vx = (d.vx / norm) * SPEED;
        d.vy = (d.vy / norm) * SPEED;
      }
    }

    function computeEdges() {
      const edges = [];

      for (let i = 0; i < devices.length; i++) {
        for (let j = i + 1; j < devices.length; j++) {
          const a = devices[i];
          const b = devices[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);

          if (dist <= RADIO_RANGE) {
            edges.push({
              source: a.id,
              target: b.id,
              distance: dist
            });
          }
        }
      }

      return edges;
    }

    function fallbackComputation(snapshot) {
      // Used only until the Kotlin/JS Collektive bundle is wired in.
      // Returns node degree as the displayed value.
      const degree = new Map(snapshot.nodes.map(n => [n.id, 0]));

      for (const e of snapshot.edges) {
        degree.set(e.source, degree.get(e.source) + 1);
        degree.set(e.target, degree.get(e.target) + 1);
      }

      return snapshot.nodes.map(n => ({
        id: n.id,
        value: degree.get(n.id)
      }));
    }

    function runCollektive(snapshot) {
      const api = globalThis.CollektiveDemo;

      if (api && typeof api.step === "function") {
        backendLabel.textContent = "Collektive";
        return api.step(snapshot);
      }

      backendLabel.textContent = "fallback JS";
      return fallbackComputation(snapshot);
    }

    function draw(edges) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);

      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgb(120 120 120 / 0.35)";

      for (const e of edges) {
        const a = devices[e.source];
        const b = devices[e.target];

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (const d of devices) {
        const radius = 4 + Math.min(d.value, 20) * 0.25;

        ctx.beginPath();
        ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${220 - Math.min(d.value, 20) * 8} 80% 60%)`;
        ctx.fill();

        ctx.fillStyle = "#ddd";
        ctx.font = "10px system-ui";
        ctx.fillText(String(d.value), d.x + 7, d.y - 7);
      }
    }

    function frame() {
      moveDevices();

      const edges = computeEdges();

      const snapshot = {
        nodes: devices.map(d => ({
          id: d.id,
          x: d.x,
          y: d.y
        })),
        edges
      };

      const outputs = runCollektive(snapshot);

      for (const output of outputs) {
        devices[output.id].value = output.value;
      }

      nLabel.textContent = devices.length;
      mLabel.textContent = edges.length;

      draw(edges);
      requestAnimationFrame(frame);
    }

    frame();
  </script>

---

## Goal

Build a selector-based gossip protocol that:

- converges to the best value in each connected component
- retracts unsupported stale values
- remains local, asynchronous, and decentralized

---

## Core idea

Each message carries:

1. `best`: current selected value
1. `path`: ordered list of node IDs that validated/forwarded that value

Nodes reject candidates whose path already contains themselves (**loop detection**).

---

## Local update rule

At each round, a node:

1. receives neighbor candidates `(best, path)`
1. removes looped candidates
1. compares remaining candidates plus its local one
1. tie-breaks by:
   1. comparator value (min/max/custom selector)
   1. shortest path
   1. deterministic ID-based rule
1. forwards selected candidate with its own ID appended

---

## Why stale values disappear

- Unsupported values are not regenerated by any local source
- Propagation in finite components eventually causes loops or loss against valid candidates
- Loop detection + deterministic selection prunes obsolete information

---

## Properties

- Fully decentralized
- No global clocks
- No periodic global reset
- No leader election or collection tree
- Asynchronous and local interactions only

---

## Formal result

Under standard assumptions (finite components, stabilized inputs/topology, ordered IDs):

- loop-freedom holds
- stale unsupported information is eventually removed
- convergence to best available value is guaranteed in each connected component

---

## Aggregate Computing view

- Implemented in **Collektive** (Kotlin MPP DSL)
- Modeled through `share`
- Fits the minimizing-share self-stabilizing pattern
- Returned projected value remains self-stabilizing

---

## Evaluation setup

- Simulated in **Alchemist**
- Random 2D deployments, asynchronous rounds (1 Hz), repeated seeds
- Metrics:
  - RMSE from oracle expected value
  - weighted communication data rate

---

## Compared approaches

1. Non-self-stabilizing gossip
1. Time-replicated self-stabilizing gossip
1. Proposed path-loop detection gossip

---

## Main findings

- Non-self-stabilizing gossip fails after perturbations
- Time-replicated gossip recovers but with delayed, step-like behavior
- Proposed approach starts correcting immediately and converges smoothly
- Communication cost is much lower than time-replicated gossip

---

## Trade-off

- Time replication can reach exact final values faster when well tuned
- Path-loop method gives lower average transient error and lighter overhead
- Useful in adaptive systems where continuous partial improvement matters

---

## Scope and limitations

- Designed for selector-based consensus (min/max/custom comparator)
- Not a direct solution for sum/avg/count-style aggregates
- Proof assumes eventual stabilization of topology and inputs
- Future work: persistent churn, losses, heterogeneous delays

---

## Takeaway

Path validation is a lightweight “certificate of support”:

- strong enough to retract stale gossip state
- lightweight compared with full provenance or replica-heavy methods
- practical building block for resilient coordination in dynamic systems

---
