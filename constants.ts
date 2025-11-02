import { Theme, PatternParams, PatternType, BuiltInPatternType } from './types';

// --- Game Grid ---
export const GRID_SIZE = 5;
export const TILE_SIZE = 100; // In pixels
export const GAME_WIDTH = GRID_SIZE * TILE_SIZE;
export const GAME_HEIGHT = GRID_SIZE * TILE_SIZE;

// --- Player ---
export const PLAYER_SIZE = 50;
export const PLAYER_MOVE_DURATION = 120; // ms for smooth movement

// --- Projectiles ---
export const PROJECTILE_SIZE = 20;
export const WALL_SWEEP_PROJECTILE_WIDTH = 15;
export const WALL_SWEEP_PROJECTILE_HEIGHT = TILE_SIZE * 0.9;
export const HOMING_DURATION = 2000; // 3 seconds
export const PROJECTILE_WARNING_DURATION = 600; // ms
export const WARNING_SIZE = PROJECTILE_SIZE * 4.5;

// --- Patterns & Hazards ---
export const LASER_WARNING_DURATION = 1000;
export const LASER_ACTIVE_DURATION = 500;
export const TRAP_WARNING_DURATION = 1200;
export const TRAP_ACTIVE_DURATION = 600;
export const WALL_SWEEP_STAGGER_DELAY = 50; // ms between each projectile in a wall
export const WALL_SWEEP_FAKE_GAP_DELAY = 200; // ms delay for the fake gap projectile

// --- AI & Difficulty ---
export const NORMAL_DIFFICULTY_SCORE_STEP = 2000;
export const EXTREME_DIFFICULTY_SCORE_STEP = 500;
export const SPEED_RESET_SCORE = 10000;
export const MAX_SIMULTANEOUS_PATTERNS = 3;
export const PATTERN_GENERATION_INTERVAL = 3000; // AI creates a new pattern every 3s
export const BLACKLIST_GENERATION_INTERVAL = 10000; // AI reviews balance every 10s
export const GIMMICK_TRIGGER_INTERVAL = 20000; // AI considers a world event every 20s

export const BASE_PATTERN_PARAMS: Record<BuiltInPatternType, PatternParams> = {
    homing: { rate: 2000, speed: 2, turnRate: 0.01 },
    crossfire: { rate: 1000, speed: 4 },
    wallSweep: { rate: 2500, speed: 2.5 },
    laser: { rate: 2000, speed: 0.0 },// Laser could move afterwards
    tileTrap: { rate: 950, speed: 0 },
};

// This is now the initial state, the AI can add to it.
export const INITIAL_PATTERN_BLACKLIST: [BuiltInPatternType, BuiltInPatternType][] = [
    ['homing', 'crossfire'],
];

// --- Gimmicks ---
export const GRAVITY_WELL_FORCE = 0.3;

// --- Visuals & Effects ---
export const EXPLOSION_DEFAULT_SIZE = 150;
export const EXPLOSION_DEFAULT_DURATION = 300;
export const THEMES: Theme[] = [
    { background: 'rgba(26, 26, 46, 0.8)', player: '#00e676', projectile: '#ffffff', wallSweep: '#8A2BE2', warning: '#ffd700', laser: '#ff4757', trap: '#ff6b81', text: '#e0e0e0' }, // Default Cyber
    { background: 'rgba(10, 20, 40, 0.8)', player: '#00ffff', projectile: '#ffffff', wallSweep: '#00aaff', warning: '#ffff00', laser: '#ff00ff', trap: '#ff00aa', text: '#f0f0f0' }, // Cyber Blue
    { background: 'rgba(40, 10, 30, 0.8)', player: '#ff00ff', projectile: '#ffffff', wallSweep: '#ff00aa', warning: '#ffff00', laser: '#00ffff', trap: '#00aaff', text: '#f0f0f0' }, // Synthwave Pink
    { background: 'rgba(50, 20, 10, 0.8)', player: '#ff8c00', projectile: '#ffffff', wallSweep: '#ff4500', warning: '#ffff00', laser: '#ff0000', trap: '#dc143c', text: '#f0f0f0' }, // Molten Orange
    { background: 'rgba(10, 40, 10, 0.8)', player: '#32cd32', projectile: '#ffffff', wallSweep: '#00ff7f', warning: '#ffff00', laser: '#adff2f', trap: '#7cfc00', text: '#f0f0f0' }, // Toxic Green
];
