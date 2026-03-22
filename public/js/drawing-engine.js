/**
 * Outsmart.io – Shared Drawing Engine
 * Used by both host (replay) and player (interactive) canvases.
 * Pure ES module, no DOM dependencies except a passed-in canvas.
 */

export class DrawingEngine {
  constructor(canvas, gridW = 170, gridH = 170) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.GRID_W = gridW;
    this.GRID_H = gridH;

    canvas.width = gridW;
    canvas.height = gridH;
    this.ctx.imageSmoothingEnabled = false;

    // Drawing state
    this.currentTool = 'pencil';
    this.brushSize = 2;
    this.currentColor = '#000000';
    this.isDrawing = false;
    this.lastX = -1;
    this.lastY = -1;

    // Drag tool state
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragSnapshot = null;

    // Undo/Redo
    this.undoStack = [];
    this.redoStack = [];
    this.MAX_UNDO = 60;

    // Stroke recording for network sync
    this.strokeBuffer = [];
    this.onStroke = null; // callback: (strokeData) => {}

    this.clear();
  }

  clear() {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.GRID_W, this.GRID_H);
  }

  /* ─── Coordinate conversion ─────────────────────────────── */
  toGrid(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor((clientX - r.left) * this.GRID_W / r.width),
      y: Math.floor((clientY - r.top) * this.GRID_H / r.height),
    };
  }

  /* ─── Core draw primitives ──────────────────────────────── */
  stamp(x, y, size, color) {
    this.ctx.fillStyle = color;
    const h = size >> 1;
    for (let dy = -h; dy < size - h; dy++) {
      for (let dx = -h; dx < size - h; dx++) {
        const px = x + dx, py = y + dy;
        if (px >= 0 && px < this.GRID_W && py >= 0 && py < this.GRID_H) {
          this.ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }

  line(x0, y0, x1, y1, size, color) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.stamp(x0, y0, size, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  spray(x, y, radius, count, color) {
    this.ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * radius;
      const px = Math.round(x + Math.cos(a) * d);
      const py = Math.round(y + Math.sin(a) * d);
      if (px >= 0 && px < this.GRID_W && py >= 0 && py < this.GRID_H) {
        this.ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  floodFill(sx, sy, fillHex) {
    if (sx < 0 || sx >= this.GRID_W || sy < 0 || sy >= this.GRID_H) return;
    const imgData = this.ctx.getImageData(0, 0, this.GRID_W, this.GRID_H);
    const d = imgData.data;
    const ti = (sy * this.GRID_W + sx) * 4;
    const tR = d[ti], tG = d[ti + 1], tB = d[ti + 2], tA = d[ti + 3];

    const tc = document.createElement('canvas'); tc.width = tc.height = 1;
    const tx = tc.getContext('2d'); tx.fillStyle = fillHex; tx.fillRect(0, 0, 1, 1);
    const fc = tx.getImageData(0, 0, 1, 1).data;
    if (tR === fc[0] && tG === fc[1] && tB === fc[2] && tA === fc[3]) return;

    const stack = [[sx, sy]];
    const seen = new Uint8Array(this.GRID_W * this.GRID_H);
    while (stack.length) {
      const [x, y] = stack.pop();
      const k = y * this.GRID_W + x;
      if (seen[k]) continue;
      if (x < 0 || x >= this.GRID_W || y < 0 || y >= this.GRID_H) continue;
      const i = k * 4;
      if (d[i] !== tR || d[i + 1] !== tG || d[i + 2] !== tB || d[i + 3] !== tA) continue;
      seen[k] = 1;
      d[i] = fc[0]; d[i + 1] = fc[1]; d[i + 2] = fc[2]; d[i + 3] = fc[3];
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    this.ctx.putImageData(imgData, 0, 0);
  }

  /* ─── Undo / Redo ───────────────────────────────────────── */
  saveState() {
    this.undoStack.push(this.ctx.getImageData(0, 0, this.GRID_W, this.GRID_H));
    if (this.undoStack.length > this.MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.ctx.getImageData(0, 0, this.GRID_W, this.GRID_H));
    this.ctx.putImageData(this.undoStack.pop(), 0, 0);
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.ctx.getImageData(0, 0, this.GRID_W, this.GRID_H));
    this.ctx.putImageData(this.redoStack.pop(), 0, 0);
    return true;
  }

  /* ─── Tool selection ────────────────────────────────────── */
  selectTool(tool) {
    this.currentTool = tool;
  }

  setColor(color) {
    this.currentColor = color;
  }

  setBrushSize(size) {
    this.brushSize = Math.max(1, Math.min(16, size));
  }

  /* ─── Input handlers (call from mouse/touch events) ────── */
  startStroke(clientX, clientY) {
    const { x, y } = this.toGrid(clientX, clientY);
    this.isDrawing = true;
    this.lastX = x;
    this.lastY = y;

    if (this.currentTool === 'bucket') {
      this.saveState();
      this.floodFill(x, y, this.currentColor);
      this.isDrawing = false;
      this._emitStroke({ tool: 'bucket', x, y, color: this.currentColor });
      return;
    }

    if (this.currentTool === 'text') {
      this.isDrawing = false;
      return; // Text handled externally
    }

    if (this.currentTool === 'drag') {
      this.dragStartX = x;
      this.dragStartY = y;
      this.dragSnapshot = this.ctx.getImageData(0, 0, this.GRID_W, this.GRID_H);
      return;
    }

    this.saveState();
    const col = this.currentTool === 'eraser' ? '#ffffff' : this.currentColor;
    const size = this.currentTool === 'brush' ? this.brushSize + 1 : this.brushSize;

    if (this.currentTool === 'spray') {
      this.spray(x, y, this.brushSize * 3, this.brushSize * 10, col);
    } else {
      this.stamp(x, y, size, col);
    }

    this.strokeBuffer = [{ x, y }];
  }

  continueStroke(clientX, clientY) {
    if (!this.isDrawing) return;
    const { x, y } = this.toGrid(clientX, clientY);

    if (this.currentTool === 'drag') {
      this.ctx.putImageData(this.dragSnapshot, x - this.dragStartX, y - this.dragStartY);
      return;
    }

    const col = this.currentTool === 'eraser' ? '#ffffff' : this.currentColor;
    const size = this.currentTool === 'brush' ? this.brushSize + 1 : this.brushSize;

    if (this.currentTool === 'spray') {
      this.spray(x, y, this.brushSize * 3, this.brushSize * 5, col);
    } else {
      this.line(this.lastX, this.lastY, x, y, size, col);
    }

    this.lastX = x;
    this.lastY = y;
    this.strokeBuffer.push({ x, y });
  }

  endStroke() {
    if (this.isDrawing && this.currentTool === 'drag' && this.dragSnapshot) {
      this.saveState();
    }

    if (this.isDrawing && this.strokeBuffer.length > 0) {
      this._emitStroke({
        tool: this.currentTool,
        color: this.currentTool === 'eraser' ? '#ffffff' : this.currentColor,
        size: this.currentTool === 'brush' ? this.brushSize + 1 : this.brushSize,
        points: this.strokeBuffer,
      });
    }

    this.isDrawing = false;
    this.lastX = this.lastY = -1;
    this.strokeBuffer = [];
  }

  addText(clientX, clientY, text) {
    const { x, y } = this.toGrid(clientX, clientY);
    this.saveState();
    this.ctx.fillStyle = this.currentColor;
    this.ctx.font = `bold ${Math.max(6, this.brushSize * 3)}px monospace`;
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(text, x, y);
    this._emitStroke({ tool: 'text', x, y, text, color: this.currentColor, size: this.brushSize });
  }

  /* ─── Replay a stroke (received from network) ──────────── */
  replayStroke(data) {
    if (data.tool === 'bucket') {
      this.floodFill(data.x, data.y, data.color);
      return;
    }
    if (data.tool === 'text') {
      this.ctx.fillStyle = data.color;
      this.ctx.font = `bold ${Math.max(6, (data.size || 2) * 3)}px monospace`;
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(data.text, data.x, data.y);
      return;
    }
    if (!data.points || data.points.length === 0) return;

    const color = data.color || '#000000';
    const size = data.size || 2;

    if (data.tool === 'spray') {
      for (const pt of data.points) {
        this.spray(pt.x, pt.y, size * 3, size * 5, color);
      }
    } else {
      this.stamp(data.points[0].x, data.points[0].y, size, color);
      for (let i = 1; i < data.points.length; i++) {
        this.line(
          data.points[i - 1].x, data.points[i - 1].y,
          data.points[i].x, data.points[i].y,
          size, color
        );
      }
    }
  }

  /* ─── Get canvas as data URL (for snapshots) ───────────── */
  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }

  /* ─── Private ───────────────────────────────────────────── */
  _emitStroke(data) {
    if (this.onStroke) this.onStroke(data);
  }
}
