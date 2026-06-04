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
        ["experiment", "nodes", "range", "mobility", "reset", "delete"].map((name) => [name, root.querySelector(`[data-control="${name}"]`)]),
      );
      this.outputs = Object.fromEntries(
        ["backend", "edges", "experiment", "nodes", "range", "mobility"].map((name) => [name, root.querySelector(`[data-output="${name}"]`)]),
      );
      this.fixedExperiment = root.dataset.experiment || "degree";
      this.devices = [];
      this.selectedIds = new Set();
      this.drag = null;
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
      this.controls.delete?.addEventListener("click", () => this.deleteSelected());
      this.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
      this.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
      this.canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
      this.canvas.addEventListener("pointerleave", (event) => this.pointerUp(event));
      addEventListener("keydown", (event) => {
        if ((event.key === "Delete" || event.key === "Backspace") && this.selectedIds.size > 0) this.deleteSelected();
      });
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
        return { id, x: Math.random() * width, y: Math.random() * height, vx: Math.cos(angle), vy: Math.sin(angle), value: id, resultLabel: String(id) };
      });
      this.selectedIds.clear();
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
      const byId = this.devicesById();
      for (const output of outputs) {
        const device = byId.get(output.id);
        if (device) {
          device.value = Number(output.value ?? 0);
          device.resultLabel = String(output.label ?? output.value ?? "");
        }
      }
      this.outputs.edges.textContent = String(edges.length);
      this.draw(edges);
    }

    move() {
      const speed = Number(this.controls.mobility.value);
      const { width, height } = this.bounds();
      for (const device of this.devices) {
        if (this.selectedIds.has(device.id)) continue;
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

    devicesById() {
      return new Map(this.devices.map((device) => [device.id, device]));
    }

    pointerPosition(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    hitTest(point) {
      for (let index = this.devices.length - 1; index >= 0; index--) {
        const device = this.devices[index];
        const radius = this.nodeRadius(device);
        if (Math.hypot(device.x - point.x, device.y - point.y) <= radius + 8) return device;
      }
      return null;
    }

    pointerDown(event) {
      const point = this.pointerPosition(event);
      const device = this.hitTest(point);
      if (!device) {
        if (!event.shiftKey) this.selectedIds.clear();
        return;
      }
      if (event.shiftKey) {
        if (this.selectedIds.has(device.id)) this.selectedIds.delete(device.id);
        else this.selectedIds.add(device.id);
      } else if (!this.selectedIds.has(device.id)) {
        this.selectedIds.clear();
        this.selectedIds.add(device.id);
      }
      this.drag = { x: point.x, y: point.y };
      this.canvas.setPointerCapture(event.pointerId);
    }

    pointerMove(event) {
      if (!this.drag) return;
      const point = this.pointerPosition(event);
      const dx = point.x - this.drag.x;
      const dy = point.y - this.drag.y;
      const { width, height } = this.bounds();
      for (const device of this.devices) {
        if (this.selectedIds.has(device.id)) {
          device.x = Math.max(0, Math.min(width, device.x + dx));
          device.y = Math.max(0, Math.min(height, device.y + dy));
        }
      }
      this.drag = point;
    }

    pointerUp(event) {
      this.drag = null;
      if (this.canvas.hasPointerCapture?.(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    }

    deleteSelected() {
      if (this.selectedIds.size === 0) return;
      this.devices = this.devices.filter((device) => !this.selectedIds.has(device.id));
      this.selectedIds.clear();
      this.controls.nodes.value = String(this.devices.length);
      this.updateLabels();
    }

    nodeRadius(device) {
      const magnitude = Number.isFinite(device.value) ? Math.abs(device.value) : 0;
      return 18 + Math.min(magnitude, 30) * 0.44;
    }

    draw(edges) {
      const { width, height } = this.bounds();
      const byId = this.devicesById();
      const finiteValues = this.devices.map((device) => device.value).filter((value) => Number.isFinite(value));
      const minValue = finiteValues.length > 0 ? Math.min(...finiteValues) : 0;
      const maxValue = finiteValues.length > 0 ? Math.max(...finiteValues) : 0;
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.lineWidth = 6;
      this.ctx.strokeStyle = "rgb(55 65 81 / 0.38)";
      for (const edge of edges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) continue;
        this.ctx.beginPath();
        this.ctx.moveTo(source.x, source.y);
        this.ctx.lineTo(target.x, target.y);
        this.ctx.stroke();
      }
      for (const device of this.devices) {
        const radius = this.nodeRadius(device);
        this.ctx.beginPath();
        this.ctx.arc(device.x, device.y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = this.nodeColor(device.value, minValue, maxValue);
        this.ctx.fill();
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = this.selectedIds.has(device.id) ? "#f59e0b" : "#111827";
        this.ctx.stroke();
        this.ctx.font = "bold 21px system-ui";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillStyle = "#fff";
        this.ctx.fillText(String(device.id), device.x, device.y);
        this.ctx.textAlign = "left";
        this.ctx.font = "bold 30px system-ui";
        this.ctx.fillStyle = "#111827";
        this.ctx.fillText(device.resultLabel, device.x + radius + 6, device.y - radius - 4);
      }
    }

    nodeColor(value, minValue, maxValue) {
      if (!Number.isFinite(value)) return "#fff";
      const normalized = maxValue === minValue ? 0.5 : (value - minValue) / (maxValue - minValue);
      return this.viridis(Math.max(0, Math.min(1, normalized)));
    }

    viridis(t) {
      const stops = [
        [0, 68, 1, 84],
        [0.13, 71, 44, 122],
        [0.25, 59, 81, 139],
        [0.38, 44, 113, 142],
        [0.5, 33, 144, 141],
        [0.63, 39, 173, 129],
        [0.75, 92, 200, 99],
        [0.88, 170, 220, 50],
        [1, 253, 231, 37],
      ];
      const upper = stops.findIndex(([position]) => position >= t);
      if (upper <= 0) return `rgb(${stops[0][1]} ${stops[0][2]} ${stops[0][3]})`;
      const lowerStop = stops[upper - 1];
      const upperStop = stops[upper];
      const localT = (t - lowerStop[0]) / (upperStop[0] - lowerStop[0]);
      const channel = (index) => Math.round(lowerStop[index] + (upperStop[index] - lowerStop[index]) * localT);
      return `rgb(${channel(1)} ${channel(2)} ${channel(3)})`;
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
