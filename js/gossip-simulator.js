(() => {
  "use strict";

  const builtIns = {
    degree(snapshot) {
      const degree = new Map(snapshot.nodes.map((node) => [node.id, 0]));
      for (const edge of snapshot.edges) {
        degree.set(edge.source, degree.get(edge.source) + 1);
        degree.set(edge.target, degree.get(edge.target) + 1);
      }
      return snapshot.nodes.map((node) => ({ id: node.id, value: degree.get(node.id), label: String(degree.get(node.id)) }));
    },
    "min-id"(snapshot) {
      return componentFold(snapshot, Math.min);
    },
    "max-id"(snapshot) {
      return componentFold(snapshot, Math.max);
    },
  };

  function experiments() {
    return { ...builtIns, ...(globalThis.CollektiveExperiments ?? {}) };
  }

  function componentFold(snapshot, fold) {
    const adjacency = new Map(snapshot.nodes.map((node) => [node.id, []]));
    for (const edge of snapshot.edges) {
      adjacency.get(edge.source).push(edge.target);
      adjacency.get(edge.target).push(edge.source);
    }
    const seen = new Set();
    const result = new Map();
    for (const node of snapshot.nodes) {
      if (seen.has(node.id)) continue;
      const queue = [node.id];
      const component = [];
      seen.add(node.id);
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        component.push(current);
        for (const neighbor of adjacency.get(current)) {
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      const value = component.reduce(fold);
      for (const id of component) result.set(id, value);
    }
    return snapshot.nodes.map((node) => ({ id: node.id, value: result.get(node.id), label: String(result.get(node.id)) }));
  }

  class Demo {
    constructor(root) {
      this.root = root;
      this.canvas = root.querySelector(".gossip-demo__canvas");
      this.ctx = this.canvas.getContext("2d");
      this.controls = Object.fromEntries(
        ["experiment", "nodes", "range", "mobility", "reset"].map((name) => [name, root.querySelector(`[data-control="${name}"]`)]),
      );
      this.outputs = Object.fromEntries(
        ["backend", "edges", "experiment", "nodes", "range", "mobility"].map((name) => [name, root.querySelector(`[data-output="${name}"]`)]),
      );
      this.fixedExperiment = root.dataset.experiment || "degree";
      this.devices = [];
    }

    start() {
      this.refreshExperiments();
      for (const name of ["nodes", "range", "mobility"]) {
        this.controls[name].addEventListener("input", () => {
          this.updateLabels();
          if (name === "nodes") this.reset();
        });
      }
      this.controls.experiment?.addEventListener("focus", () => this.refreshExperiments());
      this.controls.reset.addEventListener("click", () => this.reset());
      addEventListener("resize", () => this.resize());
      this.updateLabels();
      this.reset();
      this.resize();
      requestAnimationFrame(() => this.loop());
    }

    refreshExperiments() {
      if (!this.controls.experiment) return;
      const current = this.controls.experiment.value || this.fixedExperiment;
      const names = Object.keys(experiments()).sort();
      this.controls.experiment.replaceChildren(
        ...names.map((name) => Object.assign(document.createElement("option"), { value: name, textContent: name })),
      );
      this.controls.experiment.value = names.includes(current) ? current : names[0];
    }

    updateLabels() {
      for (const name of ["nodes", "range", "mobility"]) this.outputs[name].textContent = this.controls[name].value;
      if (this.outputs.experiment) this.outputs.experiment.textContent = this.experimentName();
    }

    experimentName() {
      return this.controls.experiment?.value || this.fixedExperiment;
    }

    bounds() {
      const rect = this.canvas.getBoundingClientRect();
      return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    }

    resize() {
      const dpr = devicePixelRatio || 1;
      const { width, height } = this.bounds();
      this.canvas.width = Math.floor(width * dpr);
      this.canvas.height = Math.floor(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    reset() {
      const count = Number(this.controls.nodes.value);
      const { width, height } = this.bounds();
      this.devices = Array.from({ length: count }, (_, id) => {
        const angle = Math.random() * Math.PI * 2;
        return { id, x: Math.random() * width, y: Math.random() * height, vx: Math.cos(angle), vy: Math.sin(angle), value: id, label: String(id) };
      });
    }

    loop() {
      this.tick();
      requestAnimationFrame(() => this.loop());
    }

    tick() {
      this.move();
      const edges = this.edges();
      const snapshot = {
        nodes: this.devices.map(({ id, x, y, value }) => ({ id, x, y, value })),
        edges,
        parameters: { communicationRange: Number(this.controls.range.value), mobility: Number(this.controls.mobility.value) },
      };
      const name = this.experimentName();
      const registry = experiments();
      const program = registry[name] || builtIns.degree;
      let outputs;
      try {
        outputs = program(snapshot);
        this.outputs.backend.textContent = builtIns[name] === program ? "browser fallback" : "Collektive/KotlinJS";
      } catch (error) {
        console.error(`Experiment ${name} failed`, error);
        outputs = builtIns.degree(snapshot);
        this.outputs.backend.textContent = "fallback after error";
      }
      for (const output of outputs) {
        const device = this.devices[output.id];
        if (device) {
          device.value = Number(output.value ?? 0);
          device.label = String(output.label ?? output.value ?? "");
        }
      }
      this.outputs.edges.textContent = String(edges.length);
      this.draw(edges);
    }

    move() {
      const speed = Number(this.controls.mobility.value);
      const { width, height } = this.bounds();
      for (const device of this.devices) {
        device.vx += (Math.random() - 0.5) * speed * 0.12;
        device.vy += (Math.random() - 0.5) * speed * 0.12;
        const norm = Math.hypot(device.vx, device.vy) || 1;
        device.vx /= norm;
        device.vy /= norm;
        device.x = Math.max(0, Math.min(width, device.x + device.vx * speed));
        device.y = Math.max(0, Math.min(height, device.y + device.vy * speed));
        if (device.x === 0 || device.x === width) device.vx *= -1;
        if (device.y === 0 || device.y === height) device.vy *= -1;
      }
    }

    edges() {
      const range = Number(this.controls.range.value);
      const edges = [];
      for (let i = 0; i < this.devices.length; i++) {
        for (let j = i + 1; j < this.devices.length; j++) {
          const source = this.devices[i];
          const target = this.devices[j];
          const distance = Math.hypot(source.x - target.x, source.y - target.y);
          if (distance <= range) edges.push({ source: source.id, target: target.id, distance });
        }
      }
      return edges;
    }

    draw(edges) {
      const { width, height } = this.bounds();
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.lineWidth = 3;
      this.ctx.strokeStyle = "rgb(55 65 81 / 0.38)";
      for (const edge of edges) {
        const source = this.devices[edge.source];
        const target = this.devices[edge.target];
        this.ctx.beginPath();
        this.ctx.moveTo(source.x, source.y);
        this.ctx.lineTo(target.x, target.y);
        this.ctx.stroke();
      }
      for (const device of this.devices) {
        const magnitude = Number.isFinite(device.value) ? Math.abs(device.value) : 0;
        const radius = 9 + Math.min(magnitude, 30) * 0.22;
        this.ctx.beginPath();
        this.ctx.arc(device.x, device.y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = device.id === 0 ? "#d72638" : `hsl(${210 - Math.min(magnitude, 30) * 4} 75% 48%)`;
        this.ctx.fill();
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = "#111827";
        this.ctx.stroke();
        this.ctx.fillStyle = "#111827";
        this.ctx.font = "bold 20px system-ui";
        this.ctx.fillText(device.label, device.x + radius + 5, device.y - radius - 3);
      }
    }
  }

  function start() {
    document.querySelectorAll(".gossip-demo:not([data-started])").forEach((root) => {
      root.dataset.started = "true";
      new Demo(root).start();
    });
  }

  globalThis.GossipDemo = {
    registerExperiment(name, implementation) {
      globalThis.CollektiveExperiments = { ...(globalThis.CollektiveExperiments ?? {}), [name]: implementation };
    },
    listExperiments() {
      return Object.keys(experiments()).sort();
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
