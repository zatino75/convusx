import { useEffect, useRef } from "react";
import {
  patchMissionRuntimeState,
  setMissionRuntimePhase,
  useMissionRuntimeState,
  type MissionRuntimeDepartment,
} from "../../store/missionRuntimeStore";

type SceneMode = "idle" | "dispatch" | "working" | "meeting";

type OfficeWorldProps = {
  mode?: SceneMode;
  directive?: string;
};

type DeptDef = {
  id: string;
  kr: string;
  color: number;
  hex: string;
};

const DEPTS: DeptDef[] = [
  { id: "market",    kr: "시장조사", color: 0x3b82f6, hex: "#3b82f6" },
  { id: "marketing", kr: "마케팅",   color: 0xec4899, hex: "#ec4899" },
  { id: "finance",   kr: "재무",     color: 0x22c55e, hex: "#22c55e" },
  { id: "legal",     kr: "법무",     color: 0xa855f7, hex: "#a855f7" },
  { id: "compete",   kr: "경쟁분석", color: 0xef4444, hex: "#ef4444" },
  { id: "rnd",       kr: "R&D",      color: 0xf97316, hex: "#f97316" },
  { id: "data",      kr: "데이터",   color: 0x06b6d4, hex: "#06b6d4" },
  { id: "content",   kr: "콘텐츠",   color: 0xeab308, hex: "#eab308" },
  { id: "sns",       kr: "SNS",      color: 0x14b8a6, hex: "#14b8a6" },
];

const PHASER_CDN = "https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js";

type PhaserLike = any;

let phaserLoadPromise: Promise<PhaserLike> | null = null;

function loadPhaser(): Promise<PhaserLike> {
  if (typeof window === "undefined") return Promise.reject(new Error("no-window"));
  const globalAny = window as any;
  if (globalAny.Phaser) return Promise.resolve(globalAny.Phaser);
  if (phaserLoadPromise) return phaserLoadPromise;
  phaserLoadPromise = new Promise<PhaserLike>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-phaser-cdn="1"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).Phaser));
      existing.addEventListener("error", () => reject(new Error("phaser-load-failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = PHASER_CDN;
    s.async = true;
    s.dataset.phaserCdn = "1";
    s.onload = () => resolve((window as any).Phaser);
    s.onerror = () => reject(new Error("phaser-load-failed"));
    document.head.appendChild(s);
  });
  return phaserLoadPromise;
}

function buildOfficeScene(Phaser: PhaserLike) {
  const W = 1280, H = 420;
  const TILE_W = 56, TILE_H = 28;
  const ORIGIN_X = W / 2;
  const ORIGIN_Y = 80;
  const isoX = (tx: number, ty: number) => ORIGIN_X + (tx - ty) * (TILE_W / 2);
  const isoY = (tx: number, ty: number) => ORIGIN_Y + (tx + ty) * (TILE_H / 2);

  const CUBICLES = DEPTS.map((d, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    return { deptId: d.id, tx: 2.0 + col * 1.6, ty: 2.3 + row * 1.0 };
  });
  const MEETING_SEATS = DEPTS.map((_d, i) => ({
    tx: 0.5 + (i % 3) * 0.6,
    ty: 0.3 + Math.floor(i / 3) * 0.5,
  }));
  const SEAT_BY_ID: Record<string, { tx: number; ty: number }> = {};
  DEPTS.forEach((d, i) => { SEAT_BY_ID[d.id] = MEETING_SEATS[i]; });
  const CUB_BY_ID: Record<string, { tx: number; ty: number }> = {};
  CUBICLES.forEach((c) => { CUB_BY_ID[c.deptId] = { tx: c.tx, ty: c.ty }; });

  // Silver/cream palette for light theme
  const C = {
    floorA: 0xf0eee8,
    floorB: 0xe8e6df,
    floorEdge: 0xcccccc,
    deskTop: 0xe8d8b4,
    deskSide: 0xc9a87a,
    deskFront: 0xd8bf93,
    chairBody: 0xa8a39a,
    chairSeat: 0x7d786e,
    monitorBezel: 0x333842,
    monitorOn: 0x9fb8d4,
    keyboard: 0xf0eee8,
    plantPot: 0x8b6a44,
    plantLeaf: 0x5ea06b,
    plantLeafLt: 0x7cc08e,
    sofaPurple: 0xb29ad6,
    sofaDark: 0x8c74b8,
    bookshelf: 0x8b6a44,
    tableWood: 0xc9a87a,
    executiveGlow: 0xfbbf24,
    ceoGlow: 0xf59e0b,
  };

  class OfficeScene extends Phaser.Scene {
    private bg!: any;
    private floorLayer!: any;
    private staticFurn!: any;
    private dynamicFurn!: any;
    private charLayer!: any;
    private lightLayer!: any;
    private characters: Record<string, any> = {};
    private executiveLight: any;
    private ceoLight: any;
    private monitorG: any;

    constructor() { super("office"); }

    create() {
      this.cameras.main.setZoom(2);
      this.cameras.main.centerOn(W / 2, H / 2 + 20);
      this.bg = this.add.container(0, 0);
      this.floorLayer = this.add.container(0, 0);
      this.staticFurn = this.add.container(0, 0);
      this.dynamicFurn = this.add.container(0, 0);
      this.charLayer = this.add.container(0, 0);
      this.lightLayer = this.add.container(0, 0);
      this.drawFloor();
      this.drawRooms();
      this.drawWalls();
      this.drawFurniture();
      this.createCharacters();
      this.addRoomLabels();
      this.initLights();
      this.initMonitorFlicker();
      this.game.events.emit("scene:ready");
    }

    addRoomLabels() {
      const mk = (x: number, y: number, txt: string, c: string) =>
        this.add.text(x, y, txt, {
          fontFamily: "Inter,system-ui,sans-serif",
          fontSize: "10px",
          fontStyle: "bold",
          color: c,
        }).setOrigin(0.5, 0.5);
      this.bg.add(mk(isoX(1, 0.5),   isoY(1, 0.5)   - 46, "회의실",     "#6b6560"));
      this.bg.add(mk(isoX(3.5, 0.5), isoY(3.5, 0.5) - 46, "상무실",     "#a8801e"));
      this.bg.add(mk(isoX(6.5, 0.5), isoY(6.5, 0.5) - 46, "CEO 사장실", "#d97706"));
      this.bg.add(mk(isoX(3.5, 3.0), isoY(3.5, 3.0) - 66, "업무공간",   "#6b6560"));
      this.bg.add(mk(isoX(3.5, 5.0), isoY(3.5, 5.0) - 18, "휴게실",     "#6b6560"));
    }

    drawFloor() {
      const g = this.add.graphics();
      this.floorLayer.add(g);
      for (let tx = 0; tx < 8; tx++) {
        for (let ty = 0; ty < 6; ty++) {
          const cx = isoX(tx, ty), cy = isoY(tx, ty);
          const tint = (tx + ty) % 2 === 0 ? C.floorA : C.floorB;
          g.fillStyle(tint, 1);
          g.beginPath();
          g.moveTo(cx, cy - TILE_H / 2);
          g.lineTo(cx + TILE_W / 2, cy);
          g.lineTo(cx, cy + TILE_H / 2);
          g.lineTo(cx - TILE_W / 2, cy);
          g.closePath();
          g.fillPath();
          g.lineStyle(1, C.floorEdge, 0.5);
          g.strokePath();
        }
      }
    }

    drawRooms() {
      const g = this.add.graphics();
      this.floorLayer.add(g);
      this.fillRoomFloor(g, 0, 2, 0, 2, 0xd8dde7, 0.55);
      this.fillRoomFloor(g, 3, 5, 0, 2, 0xf0e0b0, 0.45);
      this.fillRoomFloor(g, 5, 8, 0, 2, 0xf5d898, 0.55);
      this.fillRoomFloor(g, 2, 5, 5, 6, 0xdad4e8, 0.45);
    }

    fillRoomFloor(g: any, x1: number, x2: number, y1: number, y2: number, color: number, alpha: number) {
      const pts: [number, number][] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      g.fillStyle(color, alpha);
      g.beginPath();
      g.moveTo(isoX(pts[0][0], pts[0][1]), isoY(pts[0][0], pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(isoX(pts[i][0], pts[i][1]), isoY(pts[i][0], pts[i][1]));
      g.closePath();
      g.fillPath();
    }

    drawWalls() {
      const g = this.add.graphics();
      this.floorLayer.add(g);
      const segs = [
        { a: { tx: 0, ty: 2 }, b: { tx: 2, ty: 2 }, c: 0xb8bec9 },
        { a: { tx: 2, ty: 0 }, b: { tx: 2, ty: 2 }, c: 0xb8bec9 },
        { a: { tx: 3, ty: 0 }, b: { tx: 3, ty: 2 }, c: 0xc9a87a },
        { a: { tx: 3, ty: 2 }, b: { tx: 5, ty: 2 }, c: 0xc9a87a },
        { a: { tx: 5, ty: 0 }, b: { tx: 5, ty: 2 }, c: 0xc9a87a },
        { a: { tx: 5, ty: 2 }, b: { tx: 8, ty: 2 }, c: 0xe0b070 },
        { a: { tx: 2, ty: 5 }, b: { tx: 5, ty: 5 }, c: 0xb6aec9 },
      ];
      for (const s of segs) {
        g.lineStyle(2.5, s.c, 0.9);
        g.beginPath();
        g.moveTo(isoX(s.a.tx, s.a.ty), isoY(s.a.tx, s.a.ty));
        g.lineTo(isoX(s.b.tx, s.b.ty), isoY(s.b.tx, s.b.ty));
        g.strokePath();
      }
    }

    isoBox(g: any, tx: number, ty: number, w: number, d: number, h: number, top: number, sL: number, sR: number) {
      const x1 = isoX(tx, ty), y1 = isoY(tx, ty);
      const x2 = isoX(tx + w, ty), y2 = isoY(tx + w, ty);
      const x3 = isoX(tx + w, ty + d), y3 = isoY(tx + w, ty + d);
      const x4 = isoX(tx, ty + d), y4 = isoY(tx, ty + d);
      g.fillStyle(sR, 1); g.beginPath();
      g.moveTo(x2, y2); g.lineTo(x3, y3); g.lineTo(x3, y3 - h); g.lineTo(x2, y2 - h); g.closePath(); g.fillPath();
      g.fillStyle(sL, 1); g.beginPath();
      g.moveTo(x3, y3); g.lineTo(x4, y4); g.lineTo(x4, y4 - h); g.lineTo(x3, y3 - h); g.closePath(); g.fillPath();
      g.fillStyle(top, 1); g.beginPath();
      g.moveTo(x1, y1 - h); g.lineTo(x2, y2 - h); g.lineTo(x3, y3 - h); g.lineTo(x4, y4 - h); g.closePath(); g.fillPath();
      g.lineStyle(1, 0xb0a898, 0.5); g.strokePath();
    }

    drawMonitor(g: any, cx: number, cy: number) {
      g.fillStyle(C.monitorBezel, 1); g.fillRect(cx - 9, cy - 13, 18, 12);
      g.fillStyle(0xeef2f7, 1); g.fillRect(cx - 7, cy - 11, 14, 8);
      g.fillStyle(0x8a9aa7, 1); g.fillRect(cx - 2, cy - 1, 4, 3); g.fillRect(cx - 5, cy + 2, 10, 1);
    }

    drawKeyboard(g: any, cx: number, cy: number) {
      g.fillStyle(C.keyboard, 0.9); g.fillRect(cx - 8, cy + 4, 16, 4);
    }

    drawChair(g: any, tx: number, ty: number) {
      this.isoBox(g, tx - 0.15, ty + 0.05, 0.3, 0.3, 6, C.chairSeat, 0x8a847a, 0x918b82);
      this.isoBox(g, tx - 0.15, ty + 0.05, 0.3, 0.08, 14, C.chairBody, 0x8a847a, 0x918b82);
    }

    drawPlant(g: any, cx: number, cy: number) {
      g.fillStyle(C.plantPot, 1); g.fillRect(cx - 5, cy - 2, 10, 8);
      g.fillStyle(C.plantLeaf, 1);   g.fillCircle(cx - 2, cy - 6, 5); g.fillCircle(cx + 3, cy - 7, 5);
      g.fillStyle(C.plantLeafLt, 1); g.fillCircle(cx, cy - 9, 4);     g.fillCircle(cx + 5, cy - 5, 3);
    }

    drawFurniture() {
      const g = this.add.graphics();
      this.staticFurn.add(g);
      // 회의실 원형 테이블
      const mcx = isoX(1.0, 0.9), mcy = isoY(1.0, 0.9);
      g.fillStyle(C.tableWood, 1); g.fillEllipse(mcx, mcy, 84, 42);
      g.lineStyle(1, 0x8a6030, 0.8); g.strokeEllipse(mcx, mcy, 84, 42);
      g.fillStyle(0xd8b88c, 1); g.fillEllipse(mcx, mcy - 2, 66, 32);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const cx = mcx + Math.cos(a) * 52, cy = mcy + Math.sin(a) * 24;
        g.fillStyle(C.chairBody, 1); g.fillEllipse(cx, cy + 2, 13, 8);
        g.fillStyle(0x6b655c, 1); g.fillEllipse(cx, cy, 10, 6);
      }
      this.drawPlant(g, isoX(0.2, 0.2), isoY(0.2, 0.2));
      this.drawPlant(g, isoX(1.9, 1.9), isoY(1.9, 1.9));

      // 상무실
      this.isoBox(g, 3.3, 0.7, 1.2, 0.6, 13, C.deskTop, C.deskFront, C.deskSide);
      this.drawMonitor(g, isoX(3.9, 0.85), isoY(3.9, 0.85) - 8);
      this.drawKeyboard(g, isoX(3.9, 1.0), isoY(3.9, 1.0) - 8);
      this.drawChair(g, 3.9, 1.55);
      this.isoBox(g, 3.1, 0.1, 0.25, 0.8, 26, C.bookshelf, 0x6a4e2e, 0x7a5c39);
      const bx = isoX(3.15, 0.5), by = isoY(3.15, 0.5);
      for (let i = 0; i < 4; i++) {
        g.fillStyle([0xDC2626, 0x2563EB, 0x059669, 0xD97706][i], 1);
        g.fillRect(bx - 4, by - 24 + i * 5, 8, 4);
      }
      this.drawPlant(g, isoX(4.7, 0.3), isoY(4.7, 0.3));

      // CEO
      this.isoBox(g, 5.5, 0.4, 1.8, 0.9, 14, C.deskTop, C.deskFront, C.deskSide);
      this.drawMonitor(g, isoX(6.4, 0.65), isoY(6.4, 0.65) - 9);
      this.drawKeyboard(g, isoX(6.4, 0.85), isoY(6.4, 0.85) - 9);
      this.isoBox(g, 6.3, 1.35, 0.5, 0.5, 22, 0x8a847a, 0x6b655c, 0x756f66);
      this.isoBox(g, 7.2, 0.5, 0.5, 1.3, 8, C.sofaPurple, C.sofaDark, 0xa090c6);
      this.isoBox(g, 7.2, 0.5, 0.5, 0.2, 14, 0xcab4e8, C.sofaPurple, 0xab8cde);
      this.isoBox(g, 5.1, 0.1, 0.25, 1.0, 26, C.bookshelf, 0x6a4e2e, 0x7a5c39);
      const cbx = isoX(5.15, 0.6), cby = isoY(5.15, 0.6);
      for (let i = 0; i < 5; i++) {
        g.fillStyle([0xDC2626, 0x2563EB, 0x059669, 0xD97706, 0x7C3AED][i], 1);
        g.fillRect(cbx - 4, cby - 24 + i * 5, 8, 4);
      }
      this.drawPlant(g, isoX(5.4, 1.8), isoY(5.4, 1.8));

      for (const c of CUBICLES) {
        this.isoBox(g, c.tx - 0.45, c.ty - 0.35, 0.9, 0.65, 10, C.deskTop, C.deskFront, C.deskSide);
        this.drawMonitor(g, isoX(c.tx, c.ty - 0.12), isoY(c.tx, c.ty - 0.12) - 8);
        this.drawKeyboard(g, isoX(c.tx, c.ty + 0.05), isoY(c.tx, c.ty + 0.05) - 8);
        this.drawChair(g, c.tx, c.ty + 0.35);
      }
      this.drawPlant(g, isoX(0.3, 3.5), isoY(0.3, 3.5));
      this.drawPlant(g, isoX(7.3, 3.0), isoY(7.3, 3.0));
      this.drawPlant(g, isoX(0.4, 2.0), isoY(0.4, 2.0));

      this.isoBox(g, 2.8, 5.3, 2.0, 0.4, 10, 0xb0a89c, 0x918a80, 0x9f988d);
      this.isoBox(g, 2.8, 5.15, 2.0, 0.15, 14, 0xc9c2b6, 0xb0a89c, 0xbdb5a9);
      this.isoBox(g, 3.4, 5.7, 0.8, 0.3, 6, C.tableWood, 0x8a6030, 0xa67d48);
      this.drawPlant(g, isoX(5.2, 5.8), isoY(5.2, 5.8));
    }

    initLights() {
      this.executiveLight = this.add.graphics();
      this.ceoLight = this.add.graphics();
      this.lightLayer.add(this.executiveLight);
      this.lightLayer.add(this.ceoLight);
      this.executiveLight.setVisible(false);
      this.ceoLight.setVisible(false);
    }

    lightExecutive(on: boolean) {
      const g = this.executiveLight;
      g.clear();
      if (!on) { g.setVisible(false); return; }
      g.setVisible(true);
      const pts: [number, number][] = [[3, 0], [5, 0], [5, 2], [3, 2]];
      g.fillStyle(C.executiveGlow, 0.25);
      g.beginPath();
      g.moveTo(isoX(pts[0][0], pts[0][1]), isoY(pts[0][0], pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(isoX(pts[i][0], pts[i][1]), isoY(pts[i][0], pts[i][1]));
      g.closePath(); g.fillPath();
      this.tweens.add({ targets: g, alpha: { from: 0.6, to: 1 }, duration: 900, yoyo: true, repeat: -1 });
    }

    lightCeo(on: boolean) {
      const g = this.ceoLight;
      g.clear();
      if (!on) { g.setVisible(false); return; }
      g.setVisible(true);
      const pts: [number, number][] = [[5, 0], [8, 0], [8, 2], [5, 2]];
      g.fillStyle(C.ceoGlow, 0.25);
      g.beginPath();
      g.moveTo(isoX(pts[0][0], pts[0][1]), isoY(pts[0][0], pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(isoX(pts[i][0], pts[i][1]), isoY(pts[i][0], pts[i][1]));
      g.closePath(); g.fillPath();
      this.tweens.add({ targets: g, alpha: { from: 0.6, to: 1 }, duration: 1100, yoyo: true, repeat: -1 });
    }

    initMonitorFlicker() {
      this.monitorG = this.add.graphics();
      this.dynamicFurn.add(this.monitorG);
      this.time.addEvent({
        delay: 800,
        loop: true,
        callback: () => {
          this.monitorG.clear();
          for (const c of CUBICLES) {
            const mx = isoX(c.tx, c.ty - 0.12);
            const my = isoY(c.tx, c.ty - 0.12) - 8;
            const on = Math.random() > 0.35;
            const col = on ? (Math.random() > 0.5 ? 0xa8c2e0 : 0xa4d8bb) : 0xd8dde5;
            this.monitorG.fillStyle(col, 0.9);
            this.monitorG.fillRect(mx - 7, my - 11, 14, 8);
          }
        },
      });
    }

    createCharacters() {
      this.characters = {};
      DEPTS.forEach((d) => {
        const cub = CUB_BY_ID[d.id];
        const sx = isoX(cub.tx, cub.ty + 0.3), sy = isoY(cub.tx, cub.ty + 0.3) - 4;
        const container = this.add.container(sx, sy);
        container.setDepth(Math.floor(sy));
        const hair = this.add.rectangle(0, -22, 10, 3, 0x3a2f25).setOrigin(0.5, 0.5);
        const head = this.add.rectangle(0, -18, 10, 10, 0xf6d5ad).setOrigin(0.5, 0.5);
        const eyeL = this.add.rectangle(-2, -18, 1, 1, 0x000).setOrigin(0.5, 0.5);
        const eyeR = this.add.rectangle(2, -18, 1, 1, 0x000).setOrigin(0.5, 0.5);
        const body = this.add.rectangle(0, -8, 10, 12, d.color).setOrigin(0.5, 0.5);
        const armL = this.add.rectangle(-6, -8, 2, 8, d.color).setOrigin(0.5, 0.5);
        const armR = this.add.rectangle(6, -8, 2, 8, d.color).setOrigin(0.5, 0.5);
        const legL = this.add.rectangle(-2, 1, 3, 6, 0x3a2f25).setOrigin(0.5, 0.5);
        const legR = this.add.rectangle(2, 1, 3, 6, 0x3a2f25).setOrigin(0.5, 0.5);
        container.add([hair, head, eyeL, eyeR, body, armL, armR, legL, legR]);
        const data = {
          deptId: d.id, color: d.color, hex: d.hex, container,
          head, hair, body, armL, armR, legL, legR,
          cubicle: cub, meetingSeat: SEAT_BY_ID[d.id],
          state: "idle", bubble: null as any, bubbleTimer: null as any,
          bobTween: null as any, armTweenL: null as any, armTweenR: null as any, walkTween: null as any,
        };
        this.characters[d.id] = data;
        this.charLayer.add(container);
        this.startIdleBob(data);
      });
    }

    startIdleBob(c: any) {
      this.stopTweens(c);
      c.bobTween = this.tweens.add({
        targets: c.container, y: c.container.y - 1.5,
        duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
    }

    stopTweens(c: any) {
      [c.bobTween, c.armTweenL, c.armTweenR, c.walkTween].forEach((t: any) => t && t.stop());
      c.bobTween = c.armTweenL = c.armTweenR = c.walkTween = null;
    }

    walkCharTo(c: any, tx: number, ty: number, done?: () => void) {
      this.stopTweens(c);
      const destX = isoX(tx, ty), destY = isoY(tx, ty) - 4;
      c.walkTween = this.tweens.chain({
        targets: c.container,
        tweens: [
          { x: destX, duration: 500, ease: "Linear" },
          { y: destY, duration: 500, ease: "Linear" },
        ],
        onComplete: () => {
          c.container.setDepth(Math.floor(destY));
          if (done) done();
        },
      });
      this.tweens.add({ targets: [c.legL, c.legR], y: { from: 1, to: -1 }, duration: 120, yoyo: true, repeat: 8 });
    }

    startTyping(c: any) {
      this.stopTweens(c);
      c.armTweenL = this.tweens.add({ targets: c.armL, y: { from: -8, to: -5 }, duration: 170, yoyo: true, repeat: -1 });
      c.armTweenR = this.tweens.add({ targets: c.armR, y: { from: -5, to: -8 }, duration: 170, yoyo: true, repeat: -1 });
    }

    setBubble(c: any, text: string, colorHex = "#ffffff", autoHideMs = 3000) {
      this.clearBubble(c);
      const bg = this.add.graphics();
      const t = this.add.text(0, 0, String(text).slice(0, 24), {
        fontFamily: "Inter,sans-serif", fontSize: "10px", color: "#1a1915",
      }).setOrigin(0.5, 0.5);
      const w = t.width + 10, h = 14;
      bg.fillStyle(Phaser.Display.Color.HexStringToColor(colorHex).color, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 3);
      bg.lineStyle(1, 0x7d786e, 1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 3);
      bg.fillTriangle(-3, h / 2 - 1, 3, h / 2 - 1, 0, h / 2 + 3);
      const bubble = this.add.container(0, -32, [bg, t]);
      c.container.add(bubble);
      c.bubble = bubble;
      if (c.bubbleTimer) c.bubbleTimer.remove();
      if (autoHideMs > 0) c.bubbleTimer = this.time.delayedCall(autoHideMs, () => this.clearBubble(c));
    }

    clearBubble(c: any) {
      if (c.bubble) { c.bubble.destroy(); c.bubble = null; }
      if (c.bubbleTimer) { c.bubbleTimer.remove(); c.bubbleTimer = null; }
    }

    emitStars(c: any) {
      for (let i = 0; i < 3; i++) {
        const s = this.add.text(0, -28, "★", {
          fontFamily: "Inter,system-ui", fontSize: "13px", color: "#fbbf24",
        }).setOrigin(0.5, 0.5);
        c.container.add(s);
        this.tweens.add({
          targets: s, x: (i - 1) * 10, y: -48 - Math.random() * 10,
          alpha: { from: 1, to: 0 }, duration: 900 + i * 120, ease: "Cubic.easeOut",
          onComplete: () => s.destroy(),
        });
      }
    }

    goWork(deptId: string, objective?: string) {
      const c = this.characters[deptId]; if (!c) return;
      c.state = "walking";
      const seat = c.meetingSeat;
      this.walkCharTo(c, seat.tx, seat.ty, () => {
        c.state = "working";
        this.startTyping(c);
        if (objective) this.setBubble(c, objective, "#e8f1ff", 0);
      });
    }

    progressMsg(deptId: string, msg: string) {
      const c = this.characters[deptId]; if (!c) return;
      if (c.state === "working" && msg) this.setBubble(c, msg, "#e8f1ff", 0);
    }

    goDone(deptId: string) {
      const c = this.characters[deptId]; if (!c) return;
      this.stopTweens(c); this.clearBubble(c);
      c.state = "returning";
      this.walkCharTo(c, c.cubicle.tx, c.cubicle.ty + 0.3, () => {
        c.state = "idle";
        this.setBubble(c, "✓ 완료", "#d1fae5", 1800);
        this.emitStars(c);
        this.startIdleBob(c);
      });
    }

    goError(deptId: string) {
      const c = this.characters[deptId]; if (!c) return;
      this.stopTweens(c); this.clearBubble(c);
      const homeX = isoX(c.cubicle.tx, c.cubicle.ty + 0.3);
      if (Math.abs(c.container.x - homeX) > 3) {
        c.state = "returning";
        this.walkCharTo(c, c.cubicle.tx, c.cubicle.ty + 0.3, () => {
          c.state = "idle";
          this.setBubble(c, "! 오류", "#fecaca", 3000);
          this.startIdleBob(c);
        });
      } else {
        c.state = "idle";
        this.setBubble(c, "! 오류", "#fecaca", 3000);
        this.startIdleBob(c);
      }
    }

    resetAll() {
      this.lightExecutive(false); this.lightCeo(false);
      for (const c of Object.values(this.characters) as any[]) {
        this.stopTweens(c); this.clearBubble(c);
        const home = c.cubicle;
        c.container.setPosition(isoX(home.tx, home.ty + 0.3), isoY(home.tx, home.ty + 0.3) - 4);
        c.state = "idle";
        this.startIdleBob(c);
      }
    }

    settleAll() {
      for (const c of Object.values(this.characters) as any[]) {
        if (c.state !== "working" && c.state !== "walking") continue;
        this.stopTweens(c); this.clearBubble(c);
        c.state = "returning";
        this.walkCharTo(c, c.cubicle.tx, c.cubicle.ty + 0.3, () => {
          c.state = "idle";
          this.startIdleBob(c);
        });
      }
    }

    recallToMeeting(deptId: string, reason?: string) {
      const c = this.characters[deptId]; if (!c) return;
      c.state = "walking";
      this.stopTweens(c);
      this.walkCharTo(c, c.meetingSeat.tx, c.meetingSeat.ty, () => {
        c.state = "working";
        this.startTyping(c);
        this.setBubble(c, reason || "보완 작업", "#fde7b1", 4000);
      });
    }
  }

  return { OfficeScene, W, H };
}

function patchDepartment(deptId: string, status: MissionRuntimeDepartment["status"], progress: number) {
  patchMissionRuntimeState((prev) => {
    const departments: Record<string, MissionRuntimeDepartment> = { ...prev.departments };
    departments[deptId] = { status, progress: Math.max(0, Math.min(100, Math.round(progress))) };
    return { departments };
  });
}

export default function OfficeWorld({ mode = "idle", directive: _directive = "" }: OfficeWorldProps) {
  void _directive;
  void mode;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<any>(null);
  const gameRef = useRef<any>(null);
  const esRef = useRef<EventSource | null>(null);
  const lastMissionIdRef = useRef<string | null>(null);
  const runtime = useMissionRuntimeState();

  // Boot Phaser game once on mount.
  useEffect(() => {
    let disposed = false;
    loadPhaser()
      .then((Phaser) => {
        if (disposed || !containerRef.current) return;
        const { OfficeScene, W, H } = buildOfficeScene(Phaser);
        const game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: containerRef.current,
          backgroundColor: "#f0eee8",
          scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
          scene: OfficeScene,
          pixelArt: false,
          transparent: true,
        });
        gameRef.current = game;
        game.events.once("scene:ready", () => {
          sceneRef.current = game.scene.getScene("office");
        });
      })
      .catch(() => { /* CDN blocked — graceful degrade */ });
    return () => {
      disposed = true;
      if (esRef.current) { try { esRef.current.close(); } catch { /* noop */ } esRef.current = null; }
      if (gameRef.current) { try { gameRef.current.destroy(true); } catch { /* noop */ } gameRef.current = null; }
      sceneRef.current = null;
    };
  }, []);

  // Open SSE when a new mission starts.
  useEffect(() => {
    const missionId = runtime.missionId;
    const directive = runtime.directive;
    if (!missionId || !directive) return;
    if (lastMissionIdRef.current === missionId) return;
    lastMissionIdRef.current = missionId;

    if (esRef.current) { try { esRef.current.close(); } catch { /* noop */ } esRef.current = null; }

    // Reset scene on new mission.
    if (sceneRef.current) sceneRef.current.resetAll();

    const url = new URL("/api/director/stream", window.location.href);
    url.searchParams.set("directive", directive);
    url.searchParams.set("projectName", runtime.topic || "신규 프로젝트");

    let es: EventSource;
    try {
      es = new EventSource(url.toString(), { withCredentials: true });
    } catch {
      setMissionRuntimePhase("error");
      return;
    }
    esRef.current = es;

    let deptTotal = 9;
    let deptDone = 0;

    function parse(ev: MessageEvent): any {
      try { return JSON.parse(ev.data); } catch { return null; }
    }

    function onMissionStart(ev: MessageEvent) {
      const p = parse(ev); if (!p) return;
      deptTotal = Number(p.deptCount || 9);
      deptDone = 0;
      setMissionRuntimePhase("dispatch");
    }
    function onDeptStart(ev: MessageEvent) {
      const p = parse(ev); if (!p?.deptId) return;
      sceneRef.current?.goWork(p.deptId, p.objective);
      patchDepartment(p.deptId, "working", 10);
      setMissionRuntimePhase("working");
    }
    function onDeptProgress(ev: MessageEvent) {
      const p = parse(ev); if (!p?.deptId) return;
      sceneRef.current?.progressMsg(p.deptId, p.message);
      patchDepartment(p.deptId, "working", 50);
    }
    function onDeptDone(ev: MessageEvent) {
      const p = parse(ev); if (!p?.deptId) return;
      sceneRef.current?.goDone(p.deptId);
      patchDepartment(p.deptId, "done", 100);
      deptDone++;
      if (deptDone >= deptTotal) {
        sceneRef.current?.lightExecutive(true);
        setMissionRuntimePhase("review");
      }
    }
    function onDeptError(ev: MessageEvent) {
      const p = parse(ev); if (!p?.deptId) return;
      sceneRef.current?.goError(p.deptId);
      patchDepartment(p.deptId, "error", 100);
      deptDone++;
    }
    function onCritic(ev: MessageEvent) {
      const p = parse(ev); if (!p) return;
      sceneRef.current?.lightExecutive(true);
      if (p.review?.verdict === "needs_followup" && (p.review?.targetDeptId || p.deptId)) {
        const tgt = p.review.targetDeptId || p.deptId;
        setTimeout(() => sceneRef.current?.recallToMeeting(tgt, "상무 보완 지시"), 800);
      }
      setTimeout(() => sceneRef.current?.lightExecutive(false), 5000);
      setMissionRuntimePhase("review");
      patchMissionRuntimeState((prev) => ({
        workflowNotes: { ...prev.workflowNotes, critic: String(p.review?.summary || prev.workflowNotes.critic) },
      }));
    }
    function onCeo(ev: MessageEvent) {
      const p = parse(ev); if (!p) return;
      sceneRef.current?.lightCeo(true);
      setTimeout(() => sceneRef.current?.lightCeo(false), 6000);
      setMissionRuntimePhase("meeting");
      patchMissionRuntimeState((prev) => ({
        workflowNotes: { ...prev.workflowNotes, ceo: String(p.briefing?.summary || p.briefing?.text || prev.workflowNotes.ceo) },
        summary: String(p.briefing?.summary || p.briefing?.text || prev.summary),
      }));
    }
    function onAllDone() {
      patchMissionRuntimeState({ phase: "done", decision: "approved" });
      sceneRef.current?.settleAll();
      if (esRef.current === es) { try { es.close(); } catch { /* noop */ } esRef.current = null; }
    }
    function onStreamEnd() { onAllDone(); }
    function onError(ev: MessageEvent) {
      const p = parse(ev); if (p?.message) {
        patchMissionRuntimeState({ phase: "error" });
      }
    }

    es.addEventListener("mission_start", onMissionStart as EventListener);
    es.addEventListener("dept_start", onDeptStart as EventListener);
    es.addEventListener("dept_progress", onDeptProgress as EventListener);
    es.addEventListener("dept_done", onDeptDone as EventListener);
    es.addEventListener("dept_error", onDeptError as EventListener);
    es.addEventListener("critic_review", onCritic as EventListener);
    es.addEventListener("ceo_briefing", onCeo as EventListener);
    es.addEventListener("all_done", onAllDone as EventListener);
    es.addEventListener("stream_end", onStreamEnd as EventListener);
    es.addEventListener("error", onError as EventListener);
    es.onerror = () => {
      if (esRef.current !== es) return;
      setMissionRuntimePhase("error");
      try { es.close(); } catch { /* noop */ }
      esRef.current = null;
    };

    return () => {
      try { es.close(); } catch { /* noop */ }
      if (esRef.current === es) esRef.current = null;
    };
  }, [runtime.missionId, runtime.directive, runtime.topic]);

  return (
    <div className="sim-world sim-world--phaser" aria-hidden="true">
      <div className="sim-world__phaser" ref={containerRef} />
    </div>
  );
}
