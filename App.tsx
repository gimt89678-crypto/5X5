import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import {
  GRID_SIZE, TILE_SIZE, GAME_WIDTH, GAME_HEIGHT, PLAYER_SIZE, PLAYER_MOVE_DURATION,
  PROJECTILE_SIZE, THEMES, NORMAL_DIFFICULTY_SCORE_STEP, EXTREME_DIFFICULTY_SCORE_STEP,
  BASE_PATTERN_PARAMS, INITIAL_PATTERN_BLACKLIST, PATTERN_GENERATION_INTERVAL,
  MAX_SIMULTANEOUS_PATTERNS, LASER_WARNING_DURATION, LASER_ACTIVE_DURATION,
  TRAP_WARNING_DURATION, TRAP_ACTIVE_DURATION, PROJECTILE_WARNING_DURATION,
  WALL_SWEEP_PROJECTILE_WIDTH, WALL_SWEEP_PROJECTILE_HEIGHT, HOMING_DURATION,
  WARNING_SIZE, EXPLOSION_DEFAULT_SIZE, EXPLOSION_DEFAULT_DURATION, WALL_SWEEP_STAGGER_DELAY,
  BLACKLIST_GENERATION_INTERVAL, GIMMICK_TRIGGER_INTERVAL, GRAVITY_WELL_FORCE
} from './constants';
import type {
  Position, PlayerState, ProjectileState, GameState, DifficultyMode, PatternType,
  ActivePattern, LaserState, TrapState, PatternDefinition, WarningState,
  ProjectileSpawnData, ExplosionState, Theme, BuiltInPatternType, GimmickState, GimmickType
} from './types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to manage notifications
const NOTIFICATION_DURATION = 7000;

// --- Main App Component ---
function App() {
  // Game State
  const [gameState, setGameState] = useState<GameState>('menu');
  const [difficultyMode, setDifficultyMode] = useState<DifficultyMode>('normal');

  // Player State
  const [player, setPlayer] = useState<PlayerState>(() => ({
    gridPos: { x: 2, y: 2 },
    centerPixelPos: { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 },
    targetCenterPixelPos: { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 },
    moveStartTime: 0,
    moveDuration: PLAYER_MOVE_DURATION,
    moveStartPixelPos: { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 },
  }));

  // Entity States
  const [projectiles, setProjectiles] = useState<ProjectileState[]>([]);
  const [warnings, setWarnings] = useState<WarningState[]>([]);
  const [lasers, setLasers] = useState<LaserState[]>([]);
  const [traps, setTraps] = useState<TrapState[]>([]);
  const [explosions, setExplosions] = useState<ExplosionState[]>([]);

  // Score & Difficulty
  const [score, setScore] = useState(0);
  const [difficultyLevel, setDifficultyLevel] = useState(0);
  
  // Refs for high-frequency updates
  const playerRef = useRef(player);
  const projectilesRef = useRef(projectiles);
  const lasersRef = useRef(lasers);
  const trapsRef = useRef(traps);
  const animationFrameId = useRef<number | null>(null);
  const activePatternsRef = useRef<ActivePattern[]>([]);
  const difficultyLevelRef = useRef(difficultyLevel);
  const generatedPatternFunctionsRef = useRef<Record<string, Function>>({});

  // Notifications & Logs
  const [notifications, setNotifications] = useState<{ id: number, message: string }[]>([]);
  const [aiLogs, setAiLogs] = useState<{ id: number; message: string }[]>([]);
  const [patternJournal, setPatternJournal] = useState<Record<number, string[]>>({});
  
  // AI State
  const [isAiThinking, setIsAiThinking] = useState(false);
  const patternRegistryRef = useRef<PatternDefinition[]>(
    Object.entries(BASE_PATTERN_PARAMS).map(([key, value]) => ({ baseType: key as PatternType, params: value }))
  );
  const patternBlacklistRef = useRef<[PatternType, PatternType][]>(INITIAL_PATTERN_BLACKLIST);
  const [activeGimmick, setActiveGimmick] = useState<GimmickState>({ type: 'none', startTime: 0, duration: 0, data: {}, name: '' });
  const activeGimmickRef = useRef(activeGimmick);

  // Update refs whenever state changes
  useEffect(() => { playerRef.current = player; }, [player]);
  useEffect(() => { projectilesRef.current = projectiles; }, [projectiles]);
  useEffect(() => { lasersRef.current = lasers; }, [lasers]);
  useEffect(() => { trapsRef.current = traps; }, [traps]);
  useEffect(() => { activeGimmickRef.current = activeGimmick; }, [activeGimmick]);
  
  const theme = THEMES[difficultyLevel % THEMES.length];
  
  const addNotification = useCallback((message: string) => {
    const newId = Date.now();
    setNotifications(prev => [...prev, { id: newId, message }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== newId));
    }, NOTIFICATION_DURATION);
  }, []);
  
  const addAiLog = useCallback((message: string) => {
    const newId = Date.now() + Math.random();
    setAiLogs(prev => [{ id: newId, message }, ...prev].slice(0, 50)); // Keep a rolling log of 50 entries
  }, []);

  // --- Entity Creation ---
  const createExplosion = useCallback((pixelPos: Position, size: number, duration: number, color: string) => {
    const newExplosion: ExplosionState = {
      id: Date.now() + Math.random(),
      pixelPos,
      startTime: performance.now(),
      size,
      duration,
      color,
    };
    setExplosions(prev => [...prev, newExplosion]);
  }, []);

  const createWarning = useCallback((spawnData: ProjectileSpawnData) => {
    const newWarning: WarningState = {
      id: Date.now() + Math.random(),
      pixelPos: spawnData.pixelPos,
      startTime: performance.now(),
      projectileData: spawnData,
      projectileType: spawnData.type,
      targetDirection: spawnData.velocity,
    };
    setWarnings(prev => [...prev, newWarning]);
  }, []);

  const createProjectile = useCallback((spawnData: ProjectileSpawnData) => {
    const newProjectile: ProjectileState = {
      id: Date.now() + Math.random(),
      ...spawnData,
    };
    setProjectiles(prev => [...prev, newProjectile]);
    createExplosion(spawnData.pixelPos, EXPLOSION_DEFAULT_SIZE, EXPLOSION_DEFAULT_DURATION, theme.projectile);
  }, [theme.projectile, createExplosion]);

  const spawnPattern = useCallback((patternDef: PatternDefinition): ActivePattern => {
    const { baseType, params } = patternDef;
    const intervalId = setInterval(() => {
      const playerPos = playerRef.current.centerPixelPos;
      
      const generatedFunc = generatedPatternFunctionsRef.current[baseType];
      if (generatedFunc) {
        try {
          generatedFunc(createWarning, setLasers, setTraps, playerPos, params, GAME_WIDTH, GAME_HEIGHT, TILE_SIZE, GRID_SIZE, PROJECTILE_SIZE);
        } catch (e) { console.error(`Error executing generated pattern '${baseType}':`, e); }
        return;
      }

      switch (baseType as BuiltInPatternType) {
        case 'homing': {
          const side = Math.floor(Math.random() * 4);
          let p: Position;
          if (side === 0) p = { x: Math.random() * GAME_WIDTH, y: -PROJECTILE_SIZE };
          else if (side === 1) p = { x: GAME_WIDTH + PROJECTILE_SIZE, y: Math.random() * GAME_HEIGHT };
          else if (side === 2) p = { x: Math.random() * GAME_WIDTH, y: GAME_HEIGHT + PROJECTILE_SIZE };
          else p = { x: -PROJECTILE_SIZE, y: Math.random() * GAME_HEIGHT };
          const angle = Math.atan2(playerPos.y - p.y, playerPos.x - p.x);
          const velocity = { x: Math.cos(angle) * params.speed, y: Math.sin(angle) * params.speed };
          createWarning({ type: 'homing', pixelPos: p, velocity, homingEndTime: performance.now() + HOMING_DURATION });
          break;
        }
        case 'crossfire': {
            const side = Math.random() > 0.5 ? 'vertical' : 'horizontal';
            const targetPos = playerRef.current.centerPixelPos;
            for (let i = 0; i < 2; i++) {
                let p: Position, v: Position;
                if(side === 'vertical'){
                    p = { x: (i === 0 ? -PROJECTILE_SIZE : GAME_WIDTH + PROJECTILE_SIZE), y: targetPos.y };
                    v = { x: (i === 0 ? 1 : -1) * params.speed, y: 0 };
                } else {
                    p = { x: targetPos.x, y: (i === 0 ? -PROJECTILE_SIZE : GAME_HEIGHT + PROJECTILE_SIZE) };
                    v = { x: 0, y: (i === 0 ? 1 : -1) * params.speed };
                }
                createWarning({ type: 'standard', pixelPos: p, velocity: v });
            }
            break;
        }
        case 'wallSweep': {
          const side = Math.floor(Math.random() * 4);
          const gapIndex = Math.floor(Math.random() * GRID_SIZE);
          const isVertical = side === 1 || side === 3;
          for (let i = 0; i < GRID_SIZE; i++) {
            if (i === gapIndex) continue;
            let p: Position, v: Position;
            if (isVertical) {
                p = { x: side === 3 ? -WALL_SWEEP_PROJECTILE_WIDTH : GAME_WIDTH + WALL_SWEEP_PROJECTILE_WIDTH, y: (i + 0.5) * TILE_SIZE };
                v = { x: (side === 3 ? 1 : -1) * params.speed, y: 0 };
            } else {
                p = { x: (i + 0.5) * TILE_SIZE, y: side === 0 ? -WALL_SWEEP_PROJECTILE_HEIGHT : GAME_HEIGHT + WALL_SWEEP_PROJECTILE_HEIGHT };
                v = { x: 0, y: (side === 0 ? 1 : -1) * params.speed };
            }
            setTimeout(() => createWarning({ type: 'wallSweep', pixelPos: p, velocity: v }), i * WALL_SWEEP_STAGGER_DELAY);
          }
          break;
        }
        case 'laser': {
          const isVertical = Math.random() > 0.5;
          const index = Math.floor(Math.random() * GRID_SIZE);
          setLasers(prev => [...prev, { id: Date.now(), type: isVertical ? 'vertical' : 'horizontal', index, startTime: performance.now(), state: 'warning' }]);
          break;
        }
        case 'tileTrap': {
          const x = Math.floor(Math.random() * GRID_SIZE);
          const y = Math.floor(Math.random() * GRID_SIZE);
          setTraps(prev => [...prev, { id: Date.now(), gridPos: { x, y }, startTime: performance.now(), state: 'warning' }]);
          break;
        }
      }
    }, params.rate);
    return { id: `${baseType}_${Date.now()}`, name: patternDef.baseType, baseType, params, intervalId };
  }, [createWarning, setLasers, setTraps]);

  const updateActivePatterns = useCallback((currentPatterns: ActivePattern[]) => {
    currentPatterns.forEach(p => clearInterval(p.intervalId));
    
    const numPatterns = Math.min(MAX_SIMULTANEOUS_PATTERNS, difficultyLevelRef.current + 1);
    let availablePatterns = [...patternRegistryRef.current];
    const newActivePatterns: ActivePattern[] = [];

    const isBlacklisted = (types: PatternType[]) => {
        for (const [t1, t2] of patternBlacklistRef.current) {
            if (types.includes(t1) && types.includes(t2)) return true;
        }
        return false;
    };
    
    for (let i = 0; i < numPatterns && availablePatterns.length > 0; i++) {
        let selectionIndex = Math.floor(Math.random() * availablePatterns.length);
        let selected = availablePatterns[selectionIndex];
        const currentTypes = newActivePatterns.map(p => p.baseType);
        
        if(isBlacklisted([...currentTypes, selected.baseType])){
             availablePatterns.splice(selectionIndex, 1);
             i--; continue;
        }
        newActivePatterns.push(spawnPattern(selected));
        availablePatterns.splice(selectionIndex, 1);
    }
    return newActivePatterns;
  }, [spawnPattern]);

  // --- Game Control ---
  const startGame = useCallback((mode: DifficultyMode) => {
    setDifficultyMode(mode);
    setScore(0);
    setDifficultyLevel(0);
    difficultyLevelRef.current = 0;
    setPlayer({
      gridPos: { x: 2, y: 2 },
      centerPixelPos: { x: 2.5 * TILE_SIZE, y: 2.5 * TILE_SIZE },
      targetCenterPixelPos: { x: 2.5 * TILE_SIZE, y: 2.5 * TILE_SIZE },
      moveStartTime: 0,
      moveDuration: PLAYER_MOVE_DURATION,
      moveStartPixelPos: { x: 2.5 * TILE_SIZE, y: 2.5 * TILE_SIZE },
    });
    setProjectiles([]);
    setWarnings([]);
    setLasers([]);
    setTraps([]);
    setExplosions([]);
    setAiLogs([]);
    setPatternJournal({});
    patternRegistryRef.current = Object.entries(BASE_PATTERN_PARAMS).map(([key, value]) => ({ baseType: key as PatternType, params: value }));
    generatedPatternFunctionsRef.current = {};
    patternBlacklistRef.current = [...INITIAL_PATTERN_BLACKLIST];
    setActiveGimmick({ type: 'none', startTime: 0, duration: 0, data: {}, name: '' });
    
    activePatternsRef.current = updateActivePatterns([]);

    setGameState('playing');
  }, [updateActivePatterns]);

  const endGame = useCallback(() => {
    setGameState('gameOver');
    createExplosion(playerRef.current.centerPixelPos, 300, 500, theme.player);
    
    const finalLevel = difficultyLevelRef.current;
    setPatternJournal(prev => {
        if (prev[finalLevel]) return prev; // Avoid overwrite
        return { ...prev, [finalLevel]: activePatternsRef.current.map(p => p.name) };
    });

    activePatternsRef.current.forEach(p => clearInterval(p.intervalId));
    activePatternsRef.current = [];
  }, [theme.player, createExplosion]);

  const returnToMenu = () => {
    setGameState('menu');
  };

  // --- Player Movement & Input ---
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (gameState !== 'playing') return;
    event.preventDefault();

    setPlayer(p => {
      const gimmick = activeGimmickRef.current;
      let onSlipperyTile = false;
      if (gimmick.type === 'slipperyTiles' && Array.isArray(gimmick.data.tiles)) {
        onSlipperyTile = gimmick.data.tiles.some(tile => tile.x === p.gridPos.x && tile.y === p.gridPos.y);
      }
      
      const moveDistance = onSlipperyTile ? 2 : 1;

      let { x, y } = p.gridPos;
      switch (event.key) {
        case 'w': case 'ArrowUp': y -= moveDistance; break;
        case 's': case 'ArrowDown': y += moveDistance; break;
        case 'a': case 'ArrowLeft': x -= moveDistance; break;
        case 'd': case 'ArrowRight': x += moveDistance; break;
        default: return p;
      }

      const newGridPos = {
        x: Math.max(0, Math.min(GRID_SIZE - 1, x)),
        y: Math.max(0, Math.min(GRID_SIZE - 1, y)),
      };
      
      if (newGridPos.x === p.gridPos.x && newGridPos.y === p.gridPos.y) {
        return p;
      }

      const now = performance.now();
      createExplosion(p.centerPixelPos, PLAYER_SIZE * (onSlipperyTile ? 1.5 : 0.8), 200, theme.player);
      
      return {
        ...p,
        gridPos: newGridPos,
        targetCenterPixelPos: {
          x: (newGridPos.x + 0.5) * TILE_SIZE,
          y: (newGridPos.y + 0.5) * TILE_SIZE,
        },
        moveStartTime: now,
        moveStartPixelPos: p.centerPixelPos,
        moveDuration: PLAYER_MOVE_DURATION * (onSlipperyTile ? 1.5 : 1)
      };
    });
  }, [gameState, theme.player, createExplosion]);

  // --- AI Systems ---
  const runAI_Task = async (taskName: string, taskFn: () => Promise<void>) => {
    if (isAiThinking) return;
    setIsAiThinking(true);
    addAiLog(`TASK: ${taskName}...`);
    try {
      await taskFn();
    } catch (error) {
      console.error(`Error in AI task (${taskName}):`, error);
      addAiLog(`ERROR in ${taskName}. Check console.`);
    } finally {
      setIsAiThinking(false);
    }
  };

  const generateNewAIPattern = useCallback(async () => {
    const PROMPT = `You are a game designer AI for a ${GRID_SIZE}x${GRID_SIZE} grid dodge game. Create a new attack pattern.
Return a JSON object: { "name": "...", "code": "...", "reasoning": "..." }.
- name: A cool, descriptive name (e.g., 'Laser Cage').
- code: A single block of executable JS code.
- reasoning: A very short strategic tip (under 10 words, e.g., 'Stay mobile').
RULES:
- **MUST BE FAIR/SURVIVABLE.**
- **BE CREATIVE:** Use \`setLasers\` and \`setTraps\`, not just projectiles.
- Use provided functions: \`createWarning(spawnData)\`, \`setLasers(callback)\`, \`setTraps(callback)\`.
- Use provided variables: \`playerPos\`, \`params\`, \`GAME_WIDTH\`, \`GAME_HEIGHT\`, \`TILE_SIZE\`, \`GRID_SIZE\`.
Example (Trap): \`const x = Math.floor(Math.random() * GRID_SIZE); const y = Math.floor(Math.random() * GRID_SIZE); setTraps(prev => [...prev, { id: Date.now(), gridPos: { x, y }, startTime: performance.now(), state: 'warning' }]);\`
Example (Laser): \`const rowIndex = Math.floor(Math.random() * GRID_SIZE); setLasers(prev => [...prev, { id: Date.now(), type: 'horizontal', index: rowIndex, startTime: performance.now(), state: 'warning' }]);\``;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: PROMPT,
        config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, code: { type: Type.STRING }, reasoning: { type: Type.STRING } }, required: ['name', 'code', 'reasoning'] } }
      });
      
      const parsed = JSON.parse(response.text.trim());
      if (!parsed.name || !parsed.code || !parsed.reasoning) throw new Error("Invalid response structure from AI");
      if (patternRegistryRef.current.some(p => p.baseType === parsed.name)) { addAiLog(`INFO: AI re-generated existing pattern '${parsed.name}'.`); return; }

      // SANDBOX VALIDATION
      const compiledFunc = new Function('createWarning', 'setLasers', 'setTraps', 'playerPos', 'params', 'GAME_WIDTH', 'GAME_HEIGHT', 'TILE_SIZE', 'GRID_SIZE', 'PROJECTILE_SIZE', parsed.code);
      compiledFunc(() => {}, () => {}, () => {}, { x: 0, y: 0 }, { rate: 1, speed: 1 }, GAME_WIDTH, GAME_HEIGHT, TILE_SIZE, GRID_SIZE, PROJECTILE_SIZE);
      
      const newPatternDef: PatternDefinition = { baseType: parsed.name, params: { rate: 2000 + Math.random() * 1000, speed: 2 + Math.random() * 2 }, generatedCode: parsed.code, reasoning: parsed.reasoning };
      generatedPatternFunctionsRef.current[parsed.name] = compiledFunc;
      patternRegistryRef.current.push(newPatternDef);
      addAiLog(`SUCCESS: Created pattern '${parsed.name}'.`);
      addNotification(`New AI Pattern: ${parsed.name}. Tip: ${parsed.reasoning}`);

    } catch (error) {
      console.error("Error generating pattern:", error);
      let errorMessage = "Pattern generation failed.";
      if (error instanceof SyntaxError) {
        errorMessage = "AI's code was invalid. Discarding.";
      } else if (error instanceof Error) {
        errorMessage = `AI's code failed validation. Discarding.`;
      }
      addAiLog(`FAIL: ${errorMessage}`);
    }
  }, [addNotification, addAiLog]);

  const generateNewAIBlacklist = useCallback(async () => {
    if (patternRegistryRef.current.length < 4) return;
    const patternNames = patternRegistryRef.current.map(p => p.baseType);
    
    const PROMPT = `You are a game balance AI. Given a list of attack patterns, identify a combination of TWO patterns that would be unfair or nearly impossible to survive if active at the same time.
Available patterns: [${patternNames.join(', ')}].
Return a JSON object: { "patternsToBan": ["...", "..."], "reasoning": "..." }.
- patternsToBan: An array with exactly two pattern names from the list.
- reasoning: A short explanation of why this combo is unfair.`;
    
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: PROMPT,
        config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { patternsToBan: { type: Type.ARRAY, items: { type: Type.STRING } }, reasoning: { type: Type.STRING } }, required: ['patternsToBan', 'reasoning'] } }
      });

      const parsed = JSON.parse(response.text.trim());
      const [p1, p2] = parsed.patternsToBan;

      if (!p1 || !p2 || !patternNames.includes(p1) || !patternNames.includes(p2)) {
          throw new Error("AI suggested invalid patterns for blacklist.");
      }
      
      const alreadyExists = patternBlacklistRef.current.some(pair => (pair[0] === p1 && pair[1] === p2) || (pair[0] === p2 && pair[1] === p1));
      if (alreadyExists) {
        addAiLog("INFO: AI reconsidered an existing ban.");
        return;
      }
      
      patternBlacklistRef.current.push([p1, p2]);
      addAiLog(`SUCCESS: Banned [${p1} & ${p2}].`);
      addNotification(`AI Balance Update: Banned [${p1} & ${p2}]. Reason: ${parsed.reasoning}`);

    } catch (error) {
      console.error("Error generating blacklist:", error);
      addAiLog("FAIL: Balance analysis failed.");
    }
  }, [addNotification, addAiLog]);
  
  const triggerAIGimmick = useCallback(async () => {
      if (activeGimmick.type !== 'none') return;

      const PROMPT = `You are a game event AI. Choose a grid gimmick to activate.
Available gimmicks: 'gravityWell', 'slipperyTiles'.
Return a JSON object with your choice and parameters.
- For 'gravityWell', return: { "gimmick": "gravityWell", "name": "...", "position": {"x": ..., "y": ...} } where x and y are grid coords from 0-${GRID_SIZE-1}.
- For 'slipperyTiles', return: { "gimmick": "slipperyTiles", "name": "...", "tiles": [{"x":..., "y":...}, ...] } with 3 to 5 tile coordinates.
- 'name' should be a short, thematic event name (e.g., "Gravitational Anomaly").`;

      try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: PROMPT,
            config: { responseMimeType: "application/json" } // Schema is too complex/dynamic here
        });

        const parsed = JSON.parse(response.text.trim());
        const duration = 10000 + Math.random() * 5000;
        
        let newGimmick: GimmickState | null = null;
        if(parsed.gimmick === 'gravityWell' && parsed.position) {
            newGimmick = { type: 'gravityWell', startTime: performance.now(), duration, data: { pos: parsed.position }, name: parsed.name };
        } else if (parsed.gimmick === 'slipperyTiles' && Array.isArray(parsed.tiles)) {
            newGimmick = { type: 'slipperyTiles', startTime: performance.now(), duration, data: { tiles: parsed.tiles }, name: parsed.name };
        }

        if (newGimmick) {
            setActiveGimmick(newGimmick);
            addAiLog(`SUCCESS: Activated Gimmick '${newGimmick.name}'.`);
            addNotification(`AI Event: ${newGimmick.name}`);
        } else {
             throw new Error("Invalid gimmick structure from AI");
        }
      } catch (error) {
        console.error("Error triggering gimmick:", error);
        addAiLog("FAIL: Could not alter the grid.");
      }
  }, [activeGimmick.type, addNotification, addAiLog]);

  // --- Game Loop ---
  const gameLoop = useCallback((now: number) => {
    if (gameState !== 'playing') return;

    // Update Gimmick State
    if (activeGimmickRef.current.type !== 'none' && now - activeGimmickRef.current.startTime > activeGimmickRef.current.duration) {
      addNotification(`Grid has stabilized: ${activeGimmickRef.current.name} ended.`);
      setActiveGimmick({ type: 'none', startTime: 0, duration: 0, data: {}, name: '' });
    }

    // Update Player Position
    setPlayer(p => {
      const elapsed = now - p.moveStartTime;
      const progress = Math.min(elapsed / p.moveDuration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 4); // easeOutQuart
      
      let newPixelPos = {
        x: p.moveStartPixelPos.x + (p.targetCenterPixelPos.x - p.moveStartPixelPos.x) * easedProgress,
        y: p.moveStartPixelPos.y + (p.targetCenterPixelPos.y - p.moveStartPixelPos.y) * easedProgress,
      };

      // Apply Gravity Well Force
      if (activeGimmickRef.current.type === 'gravityWell') {
        const wellPos = {
          x: (activeGimmickRef.current.data.pos.x + 0.5) * TILE_SIZE,
          y: (activeGimmickRef.current.data.pos.y + 0.5) * TILE_SIZE,
        };
        const dx = wellPos.x - newPixelPos.x;
        const dy = wellPos.y - newPixelPos.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > 1) {
          newPixelPos.x += (dx / dist) * GRAVITY_WELL_FORCE;
          newPixelPos.y += (dy / dist) * GRAVITY_WELL_FORCE;
        }
      }
      return { ...p, centerPixelPos: newPixelPos };
    });

    // Update Projectiles
    setProjectiles(prev => prev.map(proj => {
      let newVel = proj.velocity;
      if (proj.type === 'homing' && proj.homingEndTime && now < proj.homingEndTime) {
        const angleToPlayer = Math.atan2(playerRef.current.centerPixelPos.y - proj.pixelPos.y, playerRef.current.centerPixelPos.x - proj.pixelPos.x);
        const currentAngle = Math.atan2(proj.velocity.y, proj.velocity.x);
        const speed = Math.sqrt(proj.velocity.x ** 2 + proj.velocity.y ** 2);
        let angleDiff = angleToPlayer - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        const turnRate = BASE_PATTERN_PARAMS.homing.turnRate || 0.04;
        const newAngle = currentAngle + Math.max(-turnRate, Math.min(turnRate, angleDiff));
        newVel = { x: Math.cos(newAngle) * speed, y: Math.sin(newAngle) * speed };
      }
      return { ...proj, pixelPos: { x: proj.pixelPos.x + newVel.x, y: proj.pixelPos.y + newVel.y }, velocity: newVel };
    }).filter(p => p.pixelPos.x > -50 && p.pixelPos.x < GAME_WIDTH + 50 && p.pixelPos.y > -50 && p.pixelPos.y < GAME_HEIGHT + 50));

    // Update Warnings, Lasers, Traps, Explosions
    setWarnings(prev => {
        const remaining = [];
        for (const w of prev) { if (now - w.startTime >= PROJECTILE_WARNING_DURATION) createProjectile(w.projectileData); else remaining.push(w); }
        return remaining;
    });
    setLasers(prev => prev.map(l => {
      if (l.state === 'warning' && now - l.startTime > LASER_WARNING_DURATION) {
        createExplosion(l.type === 'horizontal' ? {x: GAME_WIDTH / 2, y: (l.index + 0.5) * TILE_SIZE} : {x: (l.index + 0.5) * TILE_SIZE, y: GAME_HEIGHT / 2}, GAME_WIDTH, 500, theme.laser);
        return { ...l, state: 'active' as const, startTime: now };
      }
      return l;
    }).filter(l => l.state !== 'active' || (now - l.startTime < LASER_ACTIVE_DURATION)));
    setTraps(prev => prev.map(t => {
      if (t.state === 'warning' && now - t.startTime > TRAP_WARNING_DURATION) {
        createExplosion({x: (t.gridPos.x + 0.5) * TILE_SIZE, y: (t.gridPos.y + 0.5) * TILE_SIZE}, TILE_SIZE * 1.5, 400, theme.trap);
        return { ...t, state: 'active' as const, startTime: now };
      }
      return t;
    }).filter(t => t.state !== 'active' || (now - t.startTime < TRAP_ACTIVE_DURATION)));
    setExplosions(prev => prev.filter(e => now - e.startTime < e.duration));

    // Collision Detection
    const p = playerRef.current;
    const playerRect = { left: p.centerPixelPos.x - PLAYER_SIZE / 2, right: p.centerPixelPos.x + PLAYER_SIZE / 2, top: p.centerPixelPos.y - PLAYER_SIZE / 2, bottom: p.centerPixelPos.y + PLAYER_SIZE / 2 };
    for (const proj of projectilesRef.current) {
      const projSize = proj.type === 'wallSweep' ? {w: WALL_SWEEP_PROJECTILE_WIDTH, h: WALL_SWEEP_PROJECTILE_HEIGHT} : {w: PROJECTILE_SIZE, h: PROJECTILE_SIZE};
      const projRect = { left: proj.pixelPos.x - projSize.w / 2, right: proj.pixelPos.x + projSize.w / 2, top: proj.pixelPos.y - projSize.h / 2, bottom: proj.pixelPos.y + projSize.h / 2 };
      if (playerRect.left < projRect.right && playerRect.right > projRect.left && playerRect.top < projRect.bottom && playerRect.bottom > projRect.top) { endGame(); return; }
    }
    for (const laser of lasersRef.current) {
        if(laser.state === 'active' && ((laser.type === 'horizontal' && laser.index === p.gridPos.y) || (laser.type === 'vertical' && laser.index === p.gridPos.x))) { endGame(); return; }
    }
    for (const trap of trapsRef.current) {
      if (trap.state === 'active' && trap.gridPos.x === p.gridPos.x && trap.gridPos.y === p.gridPos.y) { endGame(); return; }
    }

    setScore(s => s + 1);
    animationFrameId.current = requestAnimationFrame(gameLoop);
  }, [gameState, theme, createExplosion, createProjectile, endGame, addNotification]);

  // --- Game Loop & Input Listeners ---
  useEffect(() => {
    if (gameState === 'playing') {
      animationFrameId.current = requestAnimationFrame(gameLoop);
      window.addEventListener('keydown', handleKeyDown);
      const intervals = [
        setInterval(() => runAI_Task('Pattern Generation', generateNewAIPattern), PATTERN_GENERATION_INTERVAL),
        setInterval(() => runAI_Task('Balance Analysis', generateNewAIBlacklist), BLACKLIST_GENERATION_INTERVAL),
        setInterval(() => runAI_Task('World Event', triggerAIGimmick), GIMMICK_TRIGGER_INTERVAL),
      ];
      return () => {
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        window.removeEventListener('keydown', handleKeyDown);
        intervals.forEach(clearInterval);
      };
    }
  }, [gameState, gameLoop, handleKeyDown, generateNewAIPattern, generateNewAIBlacklist, triggerAIGimmick]);
  
  // --- Difficulty Scaling & Pattern Updates ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    const scoreStep = difficultyMode === 'extreme' ? EXTREME_DIFFICULTY_SCORE_STEP : NORMAL_DIFFICULTY_SCORE_STEP;
    const newDifficultyLevel = Math.floor(score / scoreStep);
    if (newDifficultyLevel > difficultyLevelRef.current) {
        const oldLevel = difficultyLevelRef.current;
        setPatternJournal(prev => ({ ...prev, [oldLevel]: activePatternsRef.current.map(p => p.name) }));
        difficultyLevelRef.current = newDifficultyLevel;
        setDifficultyLevel(newDifficultyLevel);
        activePatternsRef.current = updateActivePatterns(activePatternsRef.current);
    }
  }, [score, gameState, difficultyMode, updateActivePatterns]);
  
  // --- Render Functions ---
  const renderGimmicks = () => {
    if (activeGimmick.type === 'none') return null;
    return (
        <>
            {activeGimmick.type === 'gravityWell' && (
                <div style={{
                    position: 'absolute',
                    left: `${(activeGimmick.data.pos.x + 0.5) * TILE_SIZE}px`,
                    top: `${(activeGimmick.data.pos.y + 0.5) * TILE_SIZE}px`,
                    width: TILE_SIZE, height: TILE_SIZE,
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    background: `radial-gradient(circle, transparent 0%, ${theme.player} 100%)`,
                    opacity: 0.3,
                    animation: 'spin 4s linear infinite',
                }} />
            )}
            {activeGimmick.type === 'slipperyTiles' && activeGimmick.data.tiles.map((pos: Position, i: number) => (
                <div key={i} style={{
                    position: 'absolute',
                    left: `${pos.x * TILE_SIZE}px`,
                    top: `${pos.y * TILE_SIZE}px`,
                    width: TILE_SIZE, height: TILE_SIZE,
                    backgroundColor: theme.player,
                    opacity: 0.2,
                    boxShadow: `inset 0 0 15px 5px ${theme.player}`,
                }} />
            ))}
            <style>{`
                @keyframes spin { from { transform: translate(-50%, -50%) rotate(0deg); } to { transform: translate(-50%, -50%) rotate(360deg); } }
            `}</style>
        </>
    );
  };
  
  const renderHazards = () => (
      <>
        {lasers.map(l => {
          const style: React.CSSProperties = { position: 'absolute', backgroundColor: theme.laser, boxShadow: `0 0 20px 10px ${theme.laser}`, opacity: l.state === 'warning' ? (Math.sin(performance.now() / 100) * 0.25 + 0.5) : 1 };
          if (l.type === 'horizontal') { style.left = 0; style.top = `${(l.index + 0.5) * TILE_SIZE}px`; style.width = '100%'; style.height = `${l.state === 'warning' ? 2 : TILE_SIZE}px`; style.transform = `translateY(-50%)`; } 
          else { style.top = 0; style.left = `${(l.index + 0.5) * TILE_SIZE}px`; style.height = '100%'; style.width = `${l.state === 'warning' ? 2 : TILE_SIZE}px`; style.transform = `translateX(-50%)`; }
          return <div key={l.id} style={style} />
        })}
        {traps.map(t => (
          <div key={t.id} style={{ position: 'absolute', left: `${t.gridPos.x * TILE_SIZE}px`, top: `${t.gridPos.y * TILE_SIZE}px`, width: `${TILE_SIZE}px`, height: `${TILE_SIZE}px`, backgroundColor: theme.trap, opacity: (Math.sin(performance.now() / 100) * 0.25 + (t.state === 'warning' ? 0.5 : 0.75)), boxShadow: `inset 0 0 20px 5px ${theme.trap}` }} />
        ))}
      </>
  );

  const renderProjectilesAndWarnings = () => (
      <>
        {projectiles.map(p => {
           const isWall = p.type === 'wallSweep';
           const width = isWall ? WALL_SWEEP_PROJECTILE_WIDTH : PROJECTILE_SIZE;
           const height = isWall ? WALL_SWEEP_PROJECTILE_HEIGHT : PROJECTILE_SIZE;
           const color = isWall ? theme.wallSweep : theme.projectile;
           const angle = Math.atan2(p.velocity.y, p.velocity.x) * 180 / Math.PI;
           return <div key={p.id} style={{ position: 'absolute', left: `${p.pixelPos.x}px`, top: `${p.pixelPos.y}px`, width: `${width}px`, height: `${height}px`, backgroundColor: color, transform: `translate(-50%, -50%) rotate(${isWall ? angle + 90 : 0}deg)`, boxShadow: `0 0 15px 3px ${color}` }} />
        })}
        {warnings.map(w => (
            <div key={w.id} style={{ position: 'absolute', left: `${w.pixelPos.x}px`, top: `${w.pixelPos.y}px`, width: `${WARNING_SIZE}px`, height: `${WARNING_SIZE}px`, border: `3px solid ${theme.warning}`, transform: `translate(-50%, -50%)`, opacity: (Math.sin(performance.now() / 100) * 0.25 + 0.75), boxShadow: `0 0 15px 5px ${theme.warning}`, borderRadius: w.projectileType === 'homing' ? '50%' : '0%' }}>
             {w.projectileType === 'standard' && w.targetDirection && ( <div style={{ position: 'absolute', left: '50%', top: '50%', width: '3px', height: '50px', backgroundColor: theme.warning, transformOrigin: 'top center', transform: `translate(-50%, 0) rotate(${Math.atan2(w.targetDirection.y, w.targetDirection.x) * 180 / Math.PI + 90}deg)` }} /> )}
             {w.projectileType === 'homing' && ( <> <div style={{position: 'absolute', left: '50%', top: '10%', width: '3px', height: '80%', backgroundColor: theme.player, transform: 'translateX(-50%)'}} /> <div style={{position: 'absolute', top: '50%', left: '10%', height: '3px', width: '80%', backgroundColor: theme.player, transform: 'translateY(-50%)'}} /> </> )}
            </div>
        ))}
      </>
  );

  const renderEffects = () => (
      explosions.map(e => {
          const progress = (performance.now() - e.startTime) / e.duration;
          return <div key={e.id} style={{ position: 'absolute', left: `${e.pixelPos.x}px`, top: `${e.pixelPos.y}px`, width: `${e.size * progress}px`, height: `${e.size * progress}px`, backgroundColor: e.color, borderRadius: '50%', transform: 'translate(-50%, -50%)', opacity: 1 - progress, filter: 'blur(10px)' }}/>
      })
  );
  
  const renderSidePanel = (title: string, content: React.ReactNode) => (
    <div style={{ width: '280px', height: `calc(${GAME_HEIGHT}px + 4px)`, display: 'flex', flexDirection: 'column', border: `2px solid ${theme.player}`, boxShadow: `0 0 15px -5px ${theme.player}` }}>
        <h2 style={{ padding: '0.5rem', margin: 0, backgroundColor: theme.player, color: theme.background, textAlign: 'center', fontSize: '1.2rem' }}>{title} {title === "AI LOG" && isAiThinking ? "(Thinking...)" : ""}</h2>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', display: 'flex', flexDirection: 'column-reverse', fontSize: '0.8rem', backgroundColor: 'rgba(0,0,0,0.3)'}}>
           <div style={{display:'flex', flexDirection:'column', gap: '0.5rem'}}>{content}</div>
        </div>
    </div>
  );
  
  const renderJournal = () => {
      const entries = Object.entries(patternJournal).sort((a,b) => parseInt(b[0]) - parseInt(a[0]));
      return renderSidePanel("PATTERN JOURNAL", (
          <>
              {entries.length === 0 && <div>No levels completed yet.</div>}
              {entries.map(([level, patterns]) => (
                <div key={level} style={{borderBottom: `1px solid ${theme.text}33`, paddingBottom: '0.5rem'}}>
                    <strong style={{color: theme.player}}>Level {level}:</strong>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0.25rem 0 0 0.5rem' }}>
                      {patterns.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                </div>
              ))}
          </>
      ));
  };

  const renderAiLog = () => renderSidePanel("AI LOG", aiLogs.map(log => <div key={log.id}>{log.message}</div>));

  if (gameState === 'menu') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: THEMES[0].background, color: THEMES[0].text, fontFamily: 'monospace' }}>
        <h1 style={{ fontSize: '4rem', color: THEMES[0].player, textShadow: `0 0 15px ${THEMES[0].player}` }}>Grid Dodger</h1>
        <p style={{marginTop: '0.5rem', opacity: 0.8, color: THEMES[0].player}}>The Evolving AI Edition</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem' }}>
          <button onClick={() => startGame('normal')} style={menuButtonStyle(THEMES[0])}>Normal</button>
          <button onClick={() => startGame('extreme')} style={menuButtonStyle(THEMES[0])}>Extreme</button>
        </div>
        <div style={{ marginTop: '3rem', textAlign: 'center' }}>
          <p style={{ marginBottom: '1rem', fontSize: '1.2rem' }}>Controls</p>
          <div style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(3, 45px)', gap: '0.5rem', justifyItems: 'center' }}>
            <div />
            <div style={arrowKeyStyle(THEMES[0])}>↑</div>
            <div />
            <div style={arrowKeyStyle(THEMES[0])}>←</div>
            <div style={arrowKeyStyle(THEMES[0])}>↓</div>
            <div style={arrowKeyStyle(THEMES[0])}>→</div>
          </div>
           <p style={{marginTop: '0.5rem', opacity: 0.7}}>(WASD also works)</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: theme.background, color: theme.text, fontFamily: 'monospace', transition: 'background-color 0.5s ease', gap: '2rem' }}>
      {renderJournal()}
      
      {/* Center Column */}
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <div style={{ position: 'relative', width: GAME_WIDTH, height: GAME_HEIGHT, overflow: 'hidden', border: `2px solid ${theme.player}`, boxShadow: `0 0 30px 0px ${theme.player}` }}>
          {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => (
            <div key={i} style={{ position: 'absolute', left: `${(i % GRID_SIZE) * TILE_SIZE}px`, top: `${Math.floor(i / GRID_SIZE) * TILE_SIZE}px`, width: `${TILE_SIZE}px`, height: `${TILE_SIZE}px`, border: `1px solid rgba(128, 128, 128, 0.2)`, boxSizing: 'border-box' }} />
          ))}
          {renderGimmicks()}
          {renderHazards()}
          {renderProjectilesAndWarnings()}
          <div style={{ position: 'absolute', left: `${player.centerPixelPos.x}px`, top: `${player.centerPixelPos.y}px`, width: `${PLAYER_SIZE}px`, height: `${PLAYER_SIZE}px`, backgroundColor: theme.player, transform: 'translate(-50%, -50%)', transition: 'background-color 0.2s ease', boxShadow: `0 0 20px 5px ${theme.player}` }}/>
          {renderEffects()}
          {gameState === 'gameOver' && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
              <h1 style={{ fontSize: '3rem', color: theme.laser, textShadow: `0 0 10px ${theme.laser}` }}>GAME OVER</h1>
              <p style={{ fontSize: '1.5rem', marginTop: '1rem' }}>Final Score: {score}</p>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                <button onClick={() => startGame(difficultyMode)} style={menuButtonStyle(theme)}>Play Again</button>
                <button onClick={returnToMenu} style={menuButtonStyle(theme)}>Return to Menu</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', width: GAME_WIDTH, marginTop: '1rem', fontSize: '1.2rem' }}>
          <span>Score: {score}</span>
          <span>Level: {difficultyLevel}</span>
        </div>
        <div style={{ minHeight: '4.5em', marginTop: '0.5rem', color: theme.player, maxWidth: GAME_WIDTH, textAlign: 'center', lineHeight: '1.4em', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', fontSize: '0.9em', opacity: 0.9 }}>
            {notifications.map(n => <div key={n.id}>{n.message}</div>)}
        </div>
      </div>
      
      {renderAiLog()}
    </div>
  );
}

const menuButtonStyle = (theme: Theme): React.CSSProperties => ({
  backgroundColor: 'transparent',
  border: `2px solid ${theme.player}`,
  color: theme.text,
  padding: '0.8rem 1.5rem',
  fontSize: '1.2rem',
  cursor: 'pointer',
  textTransform: 'uppercase',
  boxShadow: `0 0 10px 0px ${theme.player}`,
  transition: 'all 0.2s ease',
});

const arrowKeyStyle = (theme: Theme): React.CSSProperties => ({
  width: '40px',
  height: '40px',
  border: `2px solid ${theme.text}`,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  fontSize: '1.5rem',
  color: theme.text,
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  borderRadius: '4px',
});

export default App;
