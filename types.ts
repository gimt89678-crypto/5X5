// --- Core Types ---
export interface Position {
  x: number;
  y: number;
}

export type GameState = 'menu' | 'playing' | 'gameOver';
export type DifficultyMode = 'normal' | 'extreme';

// --- Player ---
export interface PlayerState {
  gridPos: Position;
  centerPixelPos: Position;
  targetCenterPixelPos: Position;
  moveStartTime: number;
  moveDuration: number;
  moveStartPixelPos: Position;
}

// --- Projectiles & Hazards ---
export type ProjectileType = 'standard' | 'homing' | 'wallSweep';

export interface ProjectileSpawnData {
  type: ProjectileType;
  pixelPos: Position;
  velocity: Position;
  homingEndTime?: number;
}

export interface ProjectileState extends ProjectileSpawnData {
  id: number;
}

export interface WarningState {
  id: number;
  pixelPos: Position;
  startTime: number;
  projectileData: ProjectileSpawnData;
  projectileType: ProjectileType;
  targetDirection: Position;
}

export interface LaserState {
  id: number;
  type: 'horizontal' | 'vertical';
  index: number;
  startTime: number;
  state: 'warning' | 'active';
}

export interface TrapState {
  id: number;
  gridPos: Position;
  startTime: number;
  state: 'warning' | 'active';
}

// --- AI & Patterns ---
export type BuiltInPatternType = 'homing' | 'crossfire' | 'wallSweep' | 'laser' | 'tileTrap';
export type PatternType = BuiltInPatternType | string; // Allows for AI-generated patterns

export interface PatternParams {
  rate: number;
  speed: number;
  turnRate?: number;
}

export interface PatternDefinition {
  baseType: PatternType;
  params: PatternParams;
  generatedCode?: string;
  reasoning?: string;
}

export interface ActivePattern {
  id: string;
  name: PatternType;
  baseType: PatternType;
  params: PatternParams;
  intervalId: ReturnType<typeof setInterval>;
}

// --- Gimmicks ---
export type GimmickType = 'none' | 'gravityWell' | 'slipperyTiles';

export interface GimmickState {
  type: GimmickType;
  startTime: number;
  duration: number;
  data: {
    pos?: Position;
    tiles?: Position[];
  };
  name: string;
}

// --- Visuals & Effects ---
export interface ExplosionState {
  id: number;
  pixelPos: Position;
  startTime: number;
  size: number;
  duration: number;
  color: string;
}

export interface Theme {
  background: string;
  player: string;
  projectile: string;
  wallSweep: string;
  warning: string;
  laser: string;
  trap: string;
  text: string;
}
