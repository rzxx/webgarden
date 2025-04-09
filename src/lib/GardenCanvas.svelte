<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import * as THREE from 'three';
import { selectedAction, type SelectedAction } from './stores';
import { get } from 'svelte/store';
//import { GLTFLoader } from 'three-stdlib'; // Import GLTFLoader

// --- Plant Configuration ---
interface PlantConfig {
	growthRatePerSecond: number;
	initialScale: number;
	maxScale: number;
	thirstThresholdSeconds: number;
	size: { rows: number; cols: number }; // Default size for this plant type
	// Add other type-specific things later (e.g., model path)
}

const plantConfigs: Record<string, PlantConfig> = {
	fern: { growthRatePerSecond: 1 / (60 * 1), initialScale: 0.3, maxScale: 1.0, thirstThresholdSeconds: 60 * 1, size: { rows: 1, cols: 1 } }, // 1x1
	cactus: { growthRatePerSecond: 1 / (60 * 5), initialScale: 0.2, maxScale: 0.8, thirstThresholdSeconds: 60 * 10, size: { rows: 1, cols: 1 } }, // 1x1
	// Example of a larger plant:
	bush: { growthRatePerSecond: 1 / (60 * 3), initialScale: 0.1, maxScale: 2, thirstThresholdSeconds: 60 * 8, size: { rows: 2, cols: 2 } }, // 2x2
	default: { growthRatePerSecond: 1 / (60 * 2), initialScale: 0.4, maxScale: 1.0, thirstThresholdSeconds: 60 * 5, size: { rows: 1, cols: 1 } } // Default 1x1
};
// --- End Plant Configuration ---

// --- Decor Configuration ---
interface DecorConfig {
    size: { rows: number; cols: number };
    // How to represent the visual? Start simple, expand later.
    // Option 1: Placeholder identifier (like plants for now)
    placeholderColor?: number;
    // Option 2: Geometry/Material directly (more complex setup)
    // geometry?: THREE.BufferGeometry;
    // material?: THREE.Material | THREE.Material[];
    // Option 3: Model path (needs GLTFLoader)
    // modelPath?: string;
    defaultRotationY?: number; // Default orientation in radians
}

const decorConfigs: Record<string, DecorConfig> = {
    box: { size: { rows: 1, cols: 1 }, placeholderColor: 0x403d39, defaultRotationY: 0 },
	boxBig: { size: { rows: 2, cols: 2 }, placeholderColor: 0x403d39, defaultRotationY: 0 },
};
// --- End Decor Configuration ---

// --- Decor Instance Data Type ---
interface DecorInfo {
    decorTypeId: string; // 'fence_post', 'wooden_box', etc.
    size: { rows: number; cols: number };
    mesh?: THREE.Mesh;
    gridPos: { row: number; col: number }; // Top-left grid position
    rotationY: number; // Instance-specific rotation
}
// --- End Decor Instance Data ---

// --- Grid Cell Data Type ---
interface PlantInfo {
	plantTypeId: string;
	state: 'healthy' | 'needs_water';
	growthProgress: number;
	lastUpdateTime: number;
	lastWateredTime: number;
	size: { rows: number; cols: number }; // Size in grid cells
	mesh?: THREE.Mesh;
	// Store the top-left corner for easy reference, even though it's also the grid index
	// This can be useful if you pass PlantInfo around without grid context.
	gridPos: { row: number; col: number };
}

// Grid cell can be: empty, the main plant info, or a pointer to the main info
type GridPointer = { pointerTo: { row: number; col: number } };
type GridCell = PlantInfo | DecorInfo | GridPointer | null;
// --- End Grid Cell Data ---

// --- Grid Data ---
let gardenGrid: GridCell[][] = [];
// --- End Grid Data ---

// ... Grid System Parameters ...
let gridHelper: THREE.GridHelper | null = null;
const PLANE_SIZE = 20;
const GRID_DIVISIONS = 10;
const CELL_SIZE = PLANE_SIZE / GRID_DIVISIONS;
const HALF_PLANE_SIZE = PLANE_SIZE / 2;

const gardenVisibleSize = 30;

// --- Types ---
interface SerializableDecorInfo {
    decorTypeId: string;
    size: { rows: number; cols: number };
    rotationY: number;
    // Add 'type' field for easier loading differentiation
    type: 'decor';
}

interface SerializablePlantInfo {
	plantTypeId: string;
	state: 'healthy' | 'needs_water';
	growthProgress: number;
	lastUpdateTime: number;
	lastWateredTime: number;
	size: { rows: number; cols: number };
	type: 'plant'; // Explicit type marker
	// We don't save gridPos directly, it's derived from the save structure
}
type SerializableGridCell = SerializablePlantInfo | SerializableDecorInfo | null;
type SerializableGardenGrid = SerializableGridCell[][];
// --- End Types ---

/// --- Bounding Boxes ---
interface DraggingItem {
    objectType: 'plant' | 'decor';
    typeId: string;
}
let draggingItem: DraggingItem | null = null; // Stores the full info of the item being dragged
let previewGroup: THREE.Group | null = null; // Group to hold preview plane meshes
let previewMeshes: THREE.Mesh[] = []; // Array to hold reusable preview plane meshes
const MAX_PREVIEW_CELLS = 16; // Max anticipated size (e.g., 4x4), adjust if needed

// Materials for the preview
let validPlacementMaterial: THREE.MeshBasicMaterial;
let invalidPlacementMaterial: THREE.MeshBasicMaterial;

// --- Placeholder Object Geometry/Materials ---
const placeholderGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.5, CELL_SIZE * 0.5, CELL_SIZE * 0.5);
const healthyMaterial = new THREE.MeshStandardMaterial({ color: 0xf2cc8f });
const thirstyMaterial = new THREE.MeshStandardMaterial({ color: 0xdad7cd });
// --- End Placeholder Materials ---

// --- Placeholder Decor Materials (Example) ---
// Create materials based on placeholderColor in config, or use specific ones
const decorMaterialsCache: Record<string, THREE.MeshStandardMaterial> = {};
function getDecorMaterial(typeId: string): THREE.MeshStandardMaterial {
    const config = decorConfigs[typeId];
    if (!config) {
        return new THREE.MeshStandardMaterial({ color: 0xcccccc }); // Default grey
    }
    const color = config.placeholderColor ?? 0xcccccc;
    const cacheKey = `${color}`; // Simple cache key based on color hex
    if (!decorMaterialsCache[cacheKey]) {
        decorMaterialsCache[cacheKey] = new THREE.MeshStandardMaterial({ color: color });
    }
    return decorMaterialsCache[cacheKey];
}
// Use the existing placeholderGeometry for now for decor, or create specifics later
const decorGeometry = placeholderGeometry; // Reuse box for simplicity initially
// --- End Placeholder Decor Materials ---

// To optimize updates, track the last grid cell the preview was drawn at
let lastPreviewGridPos: { row: number; col: number } | null = null;
/// --- End Bounding Boxes ---

// --- Day/Night Cycle Configuration ---
// 1. Define Key Time Hours (0-23.99)
const SUNRISE_START_HOUR = 5.5;   // Night sky begins changing
const SUNRISE_PEAK_HOUR = 6.5;    // Sky is peak sunrise color
const SUNRISE_END_HOUR = 7.5;     // Sky finishes transition to day color
const MIDDAY_HOUR = 13.0;         // Brightest point, potentially distinct color/intensity peak
const SUNSET_START_HOUR = 18.5;   // Day sky begins changing
const SUNSET_PEAK_HOUR = 19.5;    // Sky is peak sunset color
const SUNSET_END_HOUR = 20.5;     // Sky finishes transition to night color

// 2. Convert Hours to Fractional Day Points (0.0 to 1.0)
const MIDNIGHT_POINT = 0.0;
const SUNRISE_START_POINT = SUNRISE_START_HOUR / 24;
const SUNRISE_PEAK_POINT = SUNRISE_PEAK_HOUR / 24;
const SUNRISE_END_POINT = SUNRISE_END_HOUR / 24;
const MIDDAY_POINT = MIDDAY_HOUR / 24;
const SUNSET_START_POINT = SUNSET_START_HOUR / 24;
const SUNSET_PEAK_POINT = SUNSET_PEAK_HOUR / 24;
const SUNSET_END_POINT = SUNSET_END_HOUR / 24;
const NEXT_MIDNIGHT_POINT = 1.0; // Represents the end of the day / start of the next

// --- Colors (Define as THREE.Color objects) ---
// Sky Colors
const NIGHT_SKY_COLOR = new THREE.Color(0x04080F);
const SUNRISE_SKY_COLOR = new THREE.Color(0xFFD670); // Peak sunrise
const DAY_SKY_COLOR = new THREE.Color(0xC6EAFA);  // Standard Sky
const MIDDAY_SKY_COLOR = new THREE.Color(0xA0DBF8); // Slightly bluer sky
const SUNSET_SKY_COLOR = new THREE.Color(0xED6A5A); // Peak sunset

// Ground Colors for Hemisphere Light
const NIGHT_GROUND_COLOR = new THREE.Color(0x212A24);
const SUNRISE_GROUND_COLOR = new THREE.Color(0x77945C);
const DAY_GROUND_COLOR = new THREE.Color(0x5C946E);
const MIDDAY_GROUND_COLOR = new THREE.Color(0x5C947E);
const SUNSET_GROUND_COLOR = new THREE.Color(0x94925C);

// --- Light Intensities  ---
const SUN_DISTANCE = 40;
const MAX_DIRECTIONAL_INTENSITY = 1.2;
const MIN_DIRECTIONAL_INTENSITY = 0.1;
const MAX_AMBIENT_INTENSITY = 0.6;
const MIN_AMBIENT_INTENSITY = 0.1;
const MAX_HEMISPHERE_INTENSITY = 0.8;
const MIN_HEMISPHERE_INTENSITY = 0.1;

// --- State Variables  ---
let ambientLight: THREE.AmbientLight | null = null;
let directionalLight: THREE.DirectionalLight | null = null;
let hemisphereLight: THREE.HemisphereLight | null = null;
// let shadowHelper: THREE.CameraHelper; // If you use one

// Reusable Color objects for lerping to avoid GC overhead
const currentSkyColor = new THREE.Color();
const currentGroundColor = new THREE.Color();
// --- End Day/Night Cycle ---

let container: HTMLDivElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let ground: THREE.Mesh;
let saveIntervalId: number | undefined = undefined;
const SAVE_INTERVAL_MS = 15000;

// Configuration for background updates (can be adjusted or made dynamic later)
const BACKGROUND_UPDATE_INTERVAL_MS = 500; // Check for growth/dynamics every 500ms (2fps) - adjust as needed
// Interval ID for the background check
let backgroundCheckIntervalId: number | undefined = undefined;

// Configuration for SLOW background updates (day/night only)
const IDLE_DAYNIGHT_UPDATE_INTERVAL_MS = 60 * 1000; // Check day/night every 60 seconds (1 minute) - adjust
// Interval ID for the slow day/night check
let idleDayNightCheckIntervalId: number | undefined = undefined;

let isRenderLoopActive: boolean = false; // Is the continuous loop running?
let renderRequested: boolean = false;   // Has a single frame been requested?
let animationFrameId: number | undefined = undefined; // Keep using the existing ID variable

// Flag to know if we are currently interacting (dragging, etc.)
let isInteracting: boolean = false;

// Flag to know if any plant is actively growing and needs animation
let activeGrowthOccurring: boolean = false;

const clock = new THREE.Clock(); // Add a clock for delta time

const LOCAL_STORAGE_KEY = 'gardenSaveData'; // Key for localStorage

// --- Utility Functions ---
/* function throttle<T extends (...args: any[]) => any>(func: T, limit: number): (...args: Parameters<T>) => void {
	let inThrottle: boolean;
	let lastResult: ReturnType<T>;
	return function(this: ThisParameterType<T>, ...args: Parameters<T>): void {
		if (!inThrottle) {
			inThrottle = true;
			lastResult = func.apply(this, args); // Execute immediately the first time
			setTimeout(() => inThrottle = false, limit);
		}
		// We could optionally store the last args and call again after the timeout
		// if needed, but for resize/drag, just limiting the rate is often enough.
	}
} */

function debounce<T extends (...args: any[]) => any>(func: T, delay: number): { (...args: Parameters<T>): void; flush: () => void; cancel: () => void } {
	let timeoutId: number | undefined;

	const debounced = function(this: ThisParameterType<T>, ...args: Parameters<T>): void {
		clearTimeout(timeoutId);
		timeoutId = window.setTimeout(() => {
			func.apply(this, args);
			timeoutId = undefined; // Clear after execution
		}, delay);
	};

	// Function to immediately execute the debounced function if pending
	debounced.flush = () => {
		clearTimeout(timeoutId);
		if (timeoutId !== undefined) { // Check if there was a pending call
			// Note: We don't have the 'args' here easily.
			// For saving, calling func() without args might be okay,
			// or we'd need a more complex setup to store last args.
			// Let's assume saveGardenState doesn't need args.
			func();
			timeoutId = undefined;
		}
	};

	// Function to cancel any pending execution
	debounced.cancel = () => {
		clearTimeout(timeoutId);
		timeoutId = undefined;
	};

	return debounced;
}

// --- Helper: Calculate segment progress ---
function calculateSegmentProgress(cycleProgress: number, startPoint: number, endPoint: number): number {
    if (startPoint === endPoint) return 0; // Avoid division by zero
    const segmentDuration = endPoint - startPoint;
    const progressInSegment = cycleProgress - startPoint;
    return Math.max(0, Math.min(1, progressInSegment / segmentDuration)); // Clamp between 0 and 1
}
// --- End Utility Functions ---

// --- Coordinate Mapping Functions ---

/**
 * Converts world coordinates (on the XZ plane) to grid cell coordinates.
 * Assumes the plane is centered at (0, 0, 0).
 */
function worldToGrid(worldX: number, worldZ: number): { row: number; col: number } | null {
	// Translate world coords to origin at top-left of the grid
	const gridX = worldX + HALF_PLANE_SIZE;
	const gridZ = worldZ + HALF_PLANE_SIZE;

	// Calculate column and row based on cell size
	const col = Math.floor(gridX / CELL_SIZE);
	const row = Math.floor(gridZ / CELL_SIZE);

	// Check if the calculated coordinates are within the grid bounds
	if (row >= 0 && row < GRID_DIVISIONS && col >= 0 && col < GRID_DIVISIONS) {
		return { row, col };
	} else {
		return null; // Click was outside the defined grid area
	}
}

/**
 * Converts grid cell coordinates (row, col) to world coordinates
 * representing the center of that *specific* cell.
 */
	function gridCellCenterToWorld(row: number, col: number): THREE.Vector3 {
	const worldX = col * CELL_SIZE - HALF_PLANE_SIZE + CELL_SIZE / 2;
	const worldZ = row * CELL_SIZE - HALF_PLANE_SIZE + CELL_SIZE / 2;
	return new THREE.Vector3(worldX, 0, worldZ);
}

/**
 * Calculates the world coordinate center of a multi-cell area.
 */
	function gridAreaCenterToWorld(row: number, col: number, rows: number, cols: number): THREE.Vector3 {
	// World coords of the top-left corner of the top-left cell
	const topLeftX = col * CELL_SIZE - HALF_PLANE_SIZE;
	const topLeftZ = row * CELL_SIZE - HALF_PLANE_SIZE;

	// Calculate the center based on the total size in world units
	const centerX = topLeftX + (cols * CELL_SIZE) / 2;
	const centerZ = topLeftZ + (rows * CELL_SIZE) / 2;

	return new THREE.Vector3(centerX, 0, centerZ);
}
// --- End Coordinate Mapping Functions ---

function initializeGrid() {
	gardenGrid = Array(GRID_DIVISIONS).fill(null).map(() => Array(GRID_DIVISIONS).fill(null));
	console.log("Initialized Grid:", gardenGrid);
}

// --- Function to Update Plant Visuals (Scale and Material) ---
function updatePlantVisuals(plantInfo: PlantInfo) {
	if (!plantInfo.mesh) return;

	const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
	const currentScale = config.initialScale + (config.maxScale - config.initialScale) * plantInfo.growthProgress;

	// Scale the mesh - NOTE: this scales relative to the placeholderGeometry base size
	// If you want the maxScale to exactly fill the *visual* area, you might need more complex scaling
	// based on plantInfo.size. For now, we scale the base geometry.
	plantInfo.mesh.scale.set(currentScale, currentScale, currentScale);

	// Adjust y position so base stays on the ground
	const currentHeight = (CELL_SIZE * 0.5) * currentScale; // Height of the scaled box
	plantInfo.mesh.position.y = currentHeight / 2;

	// Update Material based on State
	plantInfo.mesh.material = plantInfo.state === 'needs_water' ? thirstyMaterial : healthyMaterial;
}
// --- End Function to Update Plant Visuals ---

// --- Helper to check if area is free ---
function isAreaFree(startRow: number, startCol: number, numRows: number, numCols: number): boolean {
	for (let r = startRow; r < startRow + numRows; r++) {
		for (let c = startCol; c < startCol + numCols; c++) {
			// Check grid bounds
			if (r < 0 || r >= GRID_DIVISIONS || c < 0 || c >= GRID_DIVISIONS) {
				console.log(`Placement out of bounds at [${r}, ${c}]`);
				return false; // Outside grid
			}
			// Check if cell is occupied
			if (gardenGrid[r]?.[c] !== null) {
					console.log(`Cell [${r}, ${c}] is occupied.`);
				return false; // Cell already occupied
			}
		}
	}
	return true; // Area is free
}
// --- End Helper ---

// --- Generic Helper to Get Object Info (Resolves Pointers) ---
function getGridObjectInfoAt(row: number, col: number): PlantInfo | DecorInfo | null {
    if (row < 0 || row >= GRID_DIVISIONS || col < 0 || col >= GRID_DIVISIONS) return null;

    const cell = gardenGrid[row][col];
    if (!cell) {
        return null; // Empty
    } else if ('pointerTo' in cell) {
        // Follow pointer
        const target = cell.pointerTo;
        const targetCell = gardenGrid[target.row]?.[target.col];
        // Check if target cell actually contains PlantInfo or DecorInfo
        if (targetCell && (('plantTypeId' in targetCell) || ('decorTypeId' in targetCell))) {
            return targetCell as PlantInfo | DecorInfo;
        } else {
             console.error(`Pointer at [${row}, ${col}] points to invalid cell [${target.row}, ${target.col}]`);
            return null;
        }
    } else if (('plantTypeId' in cell) || ('decorTypeId' in cell)) {
        // It's the main PlantInfo or DecorInfo object
        return cell;
    }
    // Should not happen with defined types, but acts as safety net
    console.warn("Cell content at [${row}, ${col}] is unexpected:", cell);
    return null;
}
// --- End Generic Helper ---

/** Requests a single render frame if the loop isn't already active
 * and a frame hasn't already been requested. */
function requestRender() {
	// Only request if the loop isn't running AND a frame isn't already queued
	if (!isRenderLoopActive && !renderRequested) {
		console.log("Requesting single render frame.");
		renderRequested = true;
		animationFrameId = requestAnimationFrame(renderFrame);
	} else {
		console.log("Render skipped (loop active or frame already requested)");
	}
}
/** Starts the continuous render loop. */
function startRenderLoop() {
	if (!isRenderLoopActive) {
		console.log("Starting continuous render loop.");
		isRenderLoopActive = true;
		// Clear any pending single request, as the loop will handle it
		renderRequested = false;
		// Cancel any potentially pending single frame request ID
		if (animationFrameId) cancelAnimationFrame(animationFrameId);

		// --- Pause BOTH background intervals ---
        if (backgroundCheckIntervalId !== undefined) {
            clearInterval(backgroundCheckIntervalId);
            backgroundCheckIntervalId = undefined;
            console.log("Paused growth check interval (rAF loop active).");
        }
        if (idleDayNightCheckIntervalId !== undefined) { // Pause idle check too
            clearInterval(idleDayNightCheckIntervalId);
            idleDayNightCheckIntervalId = undefined;
            console.log("Paused idle day/night check interval (rAF loop active).");
        }
        // --- End Pause ---

		// Start the rAF loop
		animationFrameId = requestAnimationFrame(renderFrame);
	}
}

/**
 * Periodically checks if background processes (like growth) require a render frame.
 * Day/night checks are handled separately when idle.
 */
 function performBackgroundCheck() {
    // Only request render if:
    // 1. Main loop ISN'T running
    // 2. Active GROWTH is occurring
    if (!isRenderLoopActive && activeGrowthOccurring) {
        // console.log("Growth Background check: Growth detected, requesting render.");
        requestRender(); // Request a single frame to update growth visuals
    }
    // No longer checks for day/night here
}

/**
 * Periodically checks if the day/night cycle needs updating WHEN the garden is
 * otherwise completely idle (no interaction, no growth).
 */
 function performIdleBackgroundCheck() {
    // Only request render if:
    // 1. Main loop ISN'T running
    // 2. There is NO active growth occurring
    // 3. We are NOT currently interacting (safety check, though loop should handle interaction)
    if (!isRenderLoopActive && !activeGrowthOccurring && !isInteracting) {
        // console.log("Idle Day/Night check: Requesting render for time update.");
        requestRender(); // Request a single frame JUST to update day/night visuals
    }
     // else { console.log("Idle Day/Night check: Skipped (Loop Active or Growth Occurring or Interacting)"); }
}

/** Stops the continuous render loop if it's running. */
function stopRenderLoop() {
	if (isRenderLoopActive) {
		console.log("Stopping continuous render loop.");
		isRenderLoopActive = false;
		renderRequested = false; // Clear any request flag
		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = undefined;
		}

		// --- Restart BOTH background intervals (if not already running) ---
        if (backgroundCheckIntervalId === undefined) {
            backgroundCheckIntervalId = window.setInterval(performBackgroundCheck, BACKGROUND_UPDATE_INTERVAL_MS);
            console.log(`Resumed growth check interval (${BACKGROUND_UPDATE_INTERVAL_MS}ms).`);
        }
         if (idleDayNightCheckIntervalId === undefined) { // Restart idle check too
            idleDayNightCheckIntervalId = window.setInterval(performIdleBackgroundCheck, IDLE_DAYNIGHT_UPDATE_INTERVAL_MS);
            console.log(`Resumed idle day/night check interval (${IDLE_DAYNIGHT_UPDATE_INTERVAL_MS}ms).`);
        }
        // --- End Restart ---
	} else {
        // Loop wasn't active, ensure intervals ARE running if they somehow got cleared
        if (backgroundCheckIntervalId === undefined) {
            console.log("Ensuring growth check interval is running.");
            backgroundCheckIntervalId = window.setInterval(performBackgroundCheck, BACKGROUND_UPDATE_INTERVAL_MS);
        }
        if (idleDayNightCheckIntervalId === undefined) {
            console.log("Ensuring idle day/night check interval is running.");
            idleDayNightCheckIntervalId = window.setInterval(performIdleBackgroundCheck, IDLE_DAYNIGHT_UPDATE_INTERVAL_MS);
        }
    }
}

// function for Day Night cycle
// --- Main Update Function ---
function updateDayNightCycle(currentTime: Date | null = null) {
    if (!directionalLight || !ambientLight || !hemisphereLight || !scene) return;

    const now = currentTime || new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    let cycleProgress = currentHour / 24; // Normalized time (0.0 to 1.0)

    // --- Determine Segment and Lerp Colors ---
    let skyColorStart: THREE.Color;
    let skyColorEnd: THREE.Color;
    let groundColorStart: THREE.Color;
    let groundColorEnd: THREE.Color;
    let segmentProgress = 0;

    // Wrap around midnight for the night segment calculation
    if (cycleProgress >= SUNSET_END_POINT || cycleProgress < SUNRISE_START_POINT) {
        // --- Night Time (Sunset End -> Sunrise Start) ---
        skyColorStart = NIGHT_SKY_COLOR;
        skyColorEnd = NIGHT_SKY_COLOR; // Stays night color
        groundColorStart = NIGHT_GROUND_COLOR;
        groundColorEnd = NIGHT_GROUND_COLOR;
        // No lerp needed, it's constant night color. segmentProgress remains 0.
        // However, if you wanted a subtle shift during deep night, you could adjust here.
        // Handle the wrap-around correctly for calculating progress *towards* sunrise start
         if (cycleProgress >= SUNSET_END_POINT) { // Between sunset end and midnight
            const nightDurationUntilMidnight = NEXT_MIDNIGHT_POINT - SUNSET_END_POINT;
            const progressUntilMidnight = (cycleProgress - SUNSET_END_POINT) / nightDurationUntilMidnight;
            // Example: could use this progress for subtle star rotation, moon phase etc.
        } else { // Between midnight and sunrise start
             const nightDurationAfterMidnight = SUNRISE_START_POINT - MIDNIGHT_POINT;
             const progressAfterMidnight = cycleProgress / nightDurationAfterMidnight;
        }


    } else if (cycleProgress >= SUNRISE_START_POINT && cycleProgress < SUNRISE_PEAK_POINT) {
        // --- Sunrise Transition 1 (Start -> Peak) ---
        skyColorStart = NIGHT_SKY_COLOR;
        skyColorEnd = SUNRISE_SKY_COLOR;
        groundColorStart = NIGHT_GROUND_COLOR;
        groundColorEnd = SUNRISE_GROUND_COLOR;
        segmentProgress = calculateSegmentProgress(cycleProgress, SUNRISE_START_POINT, SUNRISE_PEAK_POINT);

    } else if (cycleProgress >= SUNRISE_PEAK_POINT && cycleProgress < SUNRISE_END_POINT) {
        // --- Sunrise Transition 2 (Peak -> End) ---
        skyColorStart = SUNRISE_SKY_COLOR;
        skyColorEnd = DAY_SKY_COLOR; // End of sunrise means day color
        groundColorStart = SUNRISE_GROUND_COLOR;
        groundColorEnd = DAY_GROUND_COLOR;
        segmentProgress = calculateSegmentProgress(cycleProgress, SUNRISE_PEAK_POINT, SUNRISE_END_POINT);

    } else if (cycleProgress >= SUNRISE_END_POINT && cycleProgress < MIDDAY_POINT) {
        // --- Morning (Sunrise End -> Midday) ---
        skyColorStart = DAY_SKY_COLOR;
        skyColorEnd = MIDDAY_SKY_COLOR; // Transition to peak midday color
        groundColorStart = DAY_GROUND_COLOR;
        groundColorEnd = MIDDAY_GROUND_COLOR;
        segmentProgress = calculateSegmentProgress(cycleProgress, SUNRISE_END_POINT, MIDDAY_POINT);

    } else if (cycleProgress >= MIDDAY_POINT && cycleProgress < SUNSET_START_POINT) {
        // --- Afternoon (Midday -> Sunset Start) ---
        skyColorStart = MIDDAY_SKY_COLOR;
        skyColorEnd = DAY_SKY_COLOR; // Transition back to standard day color before sunset starts
        groundColorStart = MIDDAY_GROUND_COLOR;
        groundColorEnd = DAY_GROUND_COLOR;
        segmentProgress = calculateSegmentProgress(cycleProgress, MIDDAY_POINT, SUNSET_START_POINT);

    } else if (cycleProgress >= SUNSET_START_POINT && cycleProgress < SUNSET_PEAK_POINT) {
        // --- Sunset Transition 1 (Start -> Peak) ---
        skyColorStart = DAY_SKY_COLOR;
        skyColorEnd = SUNSET_SKY_COLOR;
        groundColorStart = DAY_GROUND_COLOR;
        groundColorEnd = SUNSET_GROUND_COLOR;
        segmentProgress = calculateSegmentProgress(cycleProgress, SUNSET_START_POINT, SUNSET_PEAK_POINT);

    } else if (cycleProgress >= SUNSET_PEAK_POINT && cycleProgress < SUNSET_END_POINT) {
        // --- Sunset Transition 2 (Peak -> End) ---
        skyColorStart = SUNSET_SKY_COLOR;
        skyColorEnd = NIGHT_SKY_COLOR; // End of sunset means night color
        groundColorStart = SUNSET_GROUND_COLOR;
        groundColorEnd = NIGHT_GROUND_COLOR;
        segmentProgress = calculateSegmentProgress(cycleProgress, SUNSET_PEAK_POINT, SUNSET_END_POINT);
    }
     // Fallback/Default (shouldn't normally be reached if logic is sound)
    else {
        skyColorStart = NIGHT_SKY_COLOR;
        skyColorEnd = NIGHT_SKY_COLOR;
        groundColorStart = NIGHT_GROUND_COLOR;
        groundColorEnd = NIGHT_GROUND_COLOR;
        segmentProgress = 0;
         console.warn("Cycle progress fell outside defined segments:", cycleProgress);
    }

    // Apply the color lerp
    currentSkyColor.copy(skyColorStart).lerp(skyColorEnd, segmentProgress);
    currentGroundColor.copy(groundColorStart).lerp(groundColorEnd, segmentProgress);


    // --- Calculate Sun Position (Continuous Orbit) ---
    // Angle: 0 at ~6am (east), PI/2 at noon (high), PI at ~6pm (west), 3PI/2 at midnight (low/below)
    // Adjust offset (-0.25) so that 0.25 (6 AM) corresponds roughly to angle 0.
    const angle = (cycleProgress - 0.25) * Math.PI * 2;
    const lightX = Math.cos(angle) * SUN_DISTANCE;
    const lightY = Math.sin(angle) * SUN_DISTANCE; // Y is height
    const lightZ = SUN_DISTANCE * 0.1; // Optional slight N/S offset

    directionalLight.position.set(lightX, lightY, lightZ);
    directionalLight.target.position.set(0, 0, 0); // Ensure it points to origin
    directionalLight.target.updateMatrixWorld();

    // --- Calculate Intensities based on Sun Altitude ---
    // Use the sun's height (angle's sine component) as the primary factor for intensity.
    // `intensityFactor` will be 0 at horizon (angle 0 or PI), 1 at peak (angle PI/2)
    // and negative below horizon (we clamp it to 0).
    let intensityFactor = Math.sin(angle);
    intensityFactor = Math.max(0, intensityFactor); // Clamp intensity factor to be >= 0

    directionalLight.intensity = MIN_DIRECTIONAL_INTENSITY + intensityFactor * (MAX_DIRECTIONAL_INTENSITY - MIN_DIRECTIONAL_INTENSITY);
    ambientLight.intensity = MIN_AMBIENT_INTENSITY + intensityFactor * (MAX_AMBIENT_INTENSITY - MIN_AMBIENT_INTENSITY);
    hemisphereLight.intensity = MIN_HEMISPHERE_INTENSITY + intensityFactor * (MAX_HEMISPHERE_INTENSITY - MIN_HEMISPHERE_INTENSITY);

    // --- Apply Colors and Intensities ---
    scene.background = currentSkyColor;
    if (scene.fog) { // Update fog if it exists
         scene.fog.color.copy(currentSkyColor);
         // Optional: Adjust fog density based on time? e.g., denser at night/sunrise
         // scene.fog.near = ...
         // scene.fog.far = ...
    }

    // Lights inherit interpolated colors
    ambientLight.color.copy(currentSkyColor);
    hemisphereLight.color.copy(currentSkyColor); // Sky dome color
    hemisphereLight.groundColor.copy(currentGroundColor); // Ground color

    // Update shadow map visualization if used
    // shadowHelper?.update();
}


/**
 * Updates the position, size, and color of the preview box.
 */
function updatePreviewBox(row: number, col: number, objectType: 'plant' | 'decor', typeId: string) {
	if (!previewGroup) {
		hidePreviewBox(); // Hide if something is wrong
		return;
	}

	// Get config based on objectType
    const config = objectType === 'plant'
        ? plantConfigs[typeId]
        : decorConfigs[typeId];

    // Ensure config exists
    if (!config) {
        console.warn(`Preview: Config not found for ${objectType} ${typeId}`);
        hidePreviewBox();
        return;
    }
	const size = config.size;
    const isValid = isAreaFree(row, col, size.rows, size.cols);
    const material = isValid ? validPlacementMaterial : invalidPlacementMaterial;

	let meshIndex = 0;
	for (let rOffset = 0; rOffset < size.rows; rOffset++) {
		for (let cOffset = 0; cOffset < size.cols; cOffset++) {
			const targetRow = row + rOffset;
			const targetCol = col + cOffset;

			// Check if the current cell is within bounds *and* we have enough preview meshes in the pool
			if (meshIndex < previewMeshes.length && targetRow >= 0 && targetRow < GRID_DIVISIONS && targetCol >= 0 && targetCol < GRID_DIVISIONS) {
				const mesh = previewMeshes[meshIndex];
				const worldPos = gridCellCenterToWorld(targetRow, targetCol); // Center of *this specific cell*

				mesh.position.x = worldPos.x;
				mesh.position.z = worldPos.z;
				mesh.material = material;
				mesh.visible = true; // Make this specific plane visible
				meshIndex++;
			} else if (meshIndex >= previewMeshes.length) {
				console.warn("Need more meshes in preview pool!");
			}
			// If cell is out of bounds, don't draw a preview mesh for it
		}
	}

	// Hide any remaining unused meshes in the pool
	for (let i = meshIndex; i < previewMeshes.length; i++) {
		previewMeshes[i].visible = false;
	}

	previewGroup.visible = true; // Make the whole group visible
	lastPreviewGridPos = { row, col }; // Store the current position
}

/**
 * Hides the preview box entirely.
 */
function hidePreviewBox() {
	if (previewGroup) {
		previewGroup.visible = false;
	}
	// Optionally hide individual meshes too for robustness, though group visibility is enough
	// previewMeshes.forEach(mesh => mesh.visible = false);
	lastPreviewGridPos = null; // Reset last position
}

// --- Function to Update Plant Growth ---
function updatePlantGrowth(plantInfo: PlantInfo): boolean {
	// ... (Keep your existing updatePlantGrowth logic - no changes needed here)
	const now = Date.now();
	const elapsedSeconds = (now - plantInfo.lastUpdateTime) / 1000;
	let needsVisualUpdate = false;

	if (elapsedSeconds <= 0) {
		return false;
	}

	if (plantInfo.state === 'healthy' && plantInfo.growthProgress < 1.0) {
		const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
		const potentialGrowth = elapsedSeconds * config.growthRatePerSecond;
		const newProgress = Math.min(1.0, plantInfo.growthProgress + potentialGrowth);

		if (newProgress > plantInfo.growthProgress) {
			plantInfo.growthProgress = newProgress;
			needsVisualUpdate = true;
		}
	}
	plantInfo.lastUpdateTime = now;
	return needsVisualUpdate;
}

// --- Function to Remove Grid Object (Replaces removePlantAt) ---
function removeGridObjectAt(row: number, col: number) {
    // 1. Find the actual object info (Plant or Decor)
    const gridObjectInfo = getGridObjectInfoAt(row, col);

    if (gridObjectInfo?.mesh) {
        const objectType = 'plantTypeId' in gridObjectInfo ? 'plant' : 'decor';
        const typeId = 'plantTypeId' in gridObjectInfo ? gridObjectInfo.plantTypeId : gridObjectInfo.decorTypeId;
        console.log(`Removing ${objectType} ${typeId} originating at [${gridObjectInfo.gridPos.row}, ${gridObjectInfo.gridPos.col}]`);

        // 2. Get size and original position
        const { size, gridPos } = gridObjectInfo;

        // 3. Remove Mesh & Dispose Geometry (Material disposal handled globally if shared)
        scene.remove(gridObjectInfo.mesh);
        gridObjectInfo.mesh.geometry.dispose(); // Dispose instance geometry
        gridObjectInfo.mesh = undefined; // Clear reference

        // 4. Clear Grid Data
        for (let rOffset = 0; rOffset < size.rows; rOffset++) {
            for (let cOffset = 0; cOffset < size.cols; cOffset++) {
                const targetRow = gridPos.row + rOffset;
                const targetCol = gridPos.col + cOffset;
                if (targetRow >= 0 && targetRow < GRID_DIVISIONS && targetCol >= 0 && targetCol < GRID_DIVISIONS) {
                    gardenGrid[targetRow][targetCol] = null;
                }
            }
        }

        // 5. Save State
        saveGardenState();

    } else {
        console.log(`No grid object found at or pointed to by [${row}, ${col}] to remove.`);
    }
}

// --- Function to Place Grid Object (Replaces placeObjectAt) ---
// typeId can be plantTypeId or decorTypeId
function placeGridObjectAt(row: number, col: number, objectType: 'plant' | 'decor', typeId: string) {
    const config = objectType === 'plant'
        ? plantConfigs[typeId]
        : decorConfigs[typeId];

    if (!config) {
        console.error(`No config found for ${objectType} with id ${typeId}`);
        return;
    }

    const objectSize = config.size;

    // 1. Check Area Freedom
    if (!isAreaFree(row, col, objectSize.rows, objectSize.cols)) {
        console.log(`Cannot place ${typeId} of size ${objectSize.rows}x${objectSize.cols} at [${row}, ${col}], area not free.`);
        return;
    }

    // 2. Create Mesh
    let newMesh: THREE.Mesh;
    let newGridObject: PlantInfo | DecorInfo;
    const now = Date.now();
    const worldPos = gridAreaCenterToWorld(row, col, objectSize.rows, objectSize.cols);

    const userData = { gridPos: { row, col }, objectType: objectType, typeId: typeId }; // Add typeId for convenience

    if (objectType === 'plant') {
        newMesh = new THREE.Mesh(placeholderGeometry, healthyMaterial); // Use plant material
        newMesh.castShadow = true;
        newMesh.receiveShadow = true;
        newMesh.userData = userData;

        const newPlant: PlantInfo = {
            plantTypeId: typeId,
            state: 'healthy',
            growthProgress: 0.0,
            lastUpdateTime: now,
            lastWateredTime: now,
            size: { ...objectSize },
            gridPos: { row, col },
            mesh: newMesh
        };
        newGridObject = newPlant;
        updatePlantVisuals(newPlant); // Set initial scale, Y position for plants

    } else { // objectType === 'decor'
        const decorConfig = config as DecorConfig; // Type assertion
        const material = getDecorMaterial(typeId); // Get decor material
        newMesh = new THREE.Mesh(decorGeometry, material); // Use decor geometry/material
        newMesh.castShadow = true; // Decor can cast shadows
        newMesh.receiveShadow = true; // Decor can receive shadows
        newMesh.userData = userData;
        const rotationY = decorConfig.defaultRotationY ?? 0; // Apply default rotation

        const newDecor: DecorInfo = {
            decorTypeId: typeId,
            size: { ...objectSize },
            gridPos: { row, col },
            mesh: newMesh,
            rotationY: rotationY,
        };
        newGridObject = newDecor;
        newMesh.rotation.y = rotationY; // Set initial rotation
        // Decor likely sits flat, adjust Y based on geometry if needed
        // Assuming box geometry centered at origin:
        const decorHeight = (CELL_SIZE * 0.5); // Placeholder height
        newMesh.position.y = decorHeight / 2; // Adjust Y position for decor
    }

    // 4. Set Mesh Position (Common for both)
    newMesh.position.x = worldPos.x;
    newMesh.position.z = worldPos.z;
    // Y position set individually above based on type

    scene.add(newMesh);

    // 5. Update Grid Data (Common)
    gardenGrid[row][col] = newGridObject;
    console.log(`Placed main info for ${objectType} ${typeId} at [${row}, ${col}].`);

    // Place pointers (Common)
    for (let rOffset = 0; rOffset < objectSize.rows; rOffset++) {
        for (let cOffset = 0; cOffset < objectSize.cols; cOffset++) {
            if (rOffset === 0 && cOffset === 0) continue;
            const targetRow = row + rOffset;
            const targetCol = col + cOffset;
            if (targetRow < GRID_DIVISIONS && targetCol < GRID_DIVISIONS) {
                gardenGrid[targetRow][targetCol] = { pointerTo: { row, col } };
            }
        }
    }

    // 6. Save state
    saveGardenState();
}
// --- End Function to Place Grid Object ---

// --- Function to Water Plant (Uses Pointer Resolution) ---
function waterPlantAt(row: number, col: number) {
	// 1. Find the actual PlantInfo, resolving pointers
	const gridObjectInfo = getGridObjectInfoAt(row, col);

	// 2. Check if it's actually a PlantInfo object
	if (gridObjectInfo && 'plantTypeId' in gridObjectInfo) {
		const plantInfo = gridObjectInfo; // We know it's a plant now
		console.log(`Watering plant ${plantInfo.plantTypeId} at [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] (triggered from [${row}, ${col}])`);
		let stateChanged = false;
		let timeUpdated = false;
		const now = Date.now();

		if (plantInfo.state === 'needs_water') {
			plantInfo.state = 'healthy';
            plantInfo.lastUpdateTime = now; // Reset growth timer base
            plantInfo.lastWateredTime = now; // Update last watered time
			console.log(`   Plant is now healthy.`);
			updatePlantVisuals(plantInfo); // Update visuals
			stateChanged = true;
			timeUpdated = true;
		} else {
			plantInfo.lastWateredTime = now; // Reset thirst timer
			console.log(`   Plant was already healthy, reset thirst timer.`);
			timeUpdated = true;
			// TODO: Add feedback even if already healthy
		}

		if (stateChanged || timeUpdated) {
			saveGardenState();
		}
	} else if (gridObjectInfo) {
         console.log(`Cannot water object at [${row}, ${col}], it's other object.`);
    } else {
        console.log(`No object found at or pointed to by [${row}, ${col}] to water.`);
    }
}
// --- End Function to Water Plant ---

function handleCanvasPointerDown(event: PointerEvent) {
	const currentAction = get(selectedAction);
	if (currentAction?.type !== 'tool') {
		return; // Ignore if not a tool action
	}

	isInteracting = true; // Mark interaction start

	// --- Raycasting Logic ---
	const raycaster = new THREE.Raycaster();
	const mouse = new THREE.Vector2();
	const rect = container.getBoundingClientRect();
	mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);

	// Raycast against all objects in the scene (can be optimized later if needed)
	const intersects = raycaster.intersectObjects(scene.children, true); // `true` for recursive check

	let interactionOccurred = false;
	if (intersects.length > 0) {
		// Loop through intersected objects (sorted by distance)
		for (const intersect of intersects) {
			const intersectedObject = intersect.object;

			// Check if the intersected object is a Mesh and has our specific userData
			if (intersectedObject instanceof THREE.Mesh && intersectedObject.userData.gridPos && intersectedObject.userData.objectType) {
				const hitGridPos = intersectedObject.userData.gridPos as { row: number; col: number };
                const objectType = intersectedObject.userData.objectType as 'plant' | 'decor';

				console.log(`Raycast hit ${objectType} mesh associated with grid pos [${hitGridPos.row}, ${hitGridPos.col}]`);

				switch (currentAction.toolType) {
					case 'water':
					if (objectType === 'plant') { // Can only water plants
						console.log(`Attempting to water Plant at [${hitGridPos.row}, ${hitGridPos.col}]`);
						waterPlantAt(hitGridPos.row, hitGridPos.col);
						interactionOccurred = true;
					} else {
						console.log("Water tool clicked on decor, doing nothing.");
					}
					break;
					case 'remove':
						// Can remove both plants and decor
                        console.log(`Attempting to remove ${objectType} at [${hitGridPos.row}, ${hitGridPos.col}]`);
                        removeGridObjectAt(hitGridPos.row, hitGridPos.col); // Use generic remover
                        interactionOccurred = true;
                        break;
					default:
						console.log("Unknown tool selected on plant click:", currentAction.toolType);
			}
			if (interactionOccurred) break; // Interact with first hit object only
			}
			// Optional: Add checks here if you want to interact with other object types (like the ground)
			// else if (intersectedObject === ground) {
			//     console.log("Raycast hit ground.");
			// }
		} // End loop through intersects

	} // End if intersects.length > 0
	isInteracting = false; // Interaction ends immediately for tools
}

// --- Persistence Functions ---
function saveGardenState() {
	try {
		if (typeof localStorage === 'undefined') {
			console.warn("localStorage not available, cannot save state.");
			return;
		}
		// Create a serializable grid containing ONLY the serializable info objects
		const serializableGrid: SerializableGardenGrid = Array(GRID_DIVISIONS).fill(null).map(() => Array(GRID_DIVISIONS).fill(null));

		for (let r = 0; r < GRID_DIVISIONS; r++) {
			for (let c = 0; c < GRID_DIVISIONS; c++) {
				const cell = gardenGrid[r][c];
				// Only save if it's the main PlantInfo (not null, not a pointer)
				if (!cell || 'pointerTo' in cell) {
                    serializableGrid[r][c] = null; // Save pointers/null as null
                } else if ('plantTypeId' in cell) {
                    // It's PlantInfo
                    const { mesh, gridPos, ...rest } = cell;
                    serializableGrid[r][c] = { ...rest, type: 'plant' }; // Add type:'plant'
                } else if ('decorTypeId' in cell) {
                    // It's DecorInfo
                    const { mesh, gridPos, ...rest } = cell;
                    serializableGrid[r][c] = { ...rest, type: 'decor' }; // Add type:'decor'
                }
			}
		}

		localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializableGrid));
		// console.log("Garden state saved."); // Less verbose saving log
		requestRender(); // Request render AFTER saving state (maybe state change needs visual update)
	} catch (error) {
		console.error("Failed to save garden state:", error);
	}
}

function loadGardenState() {
	try {
		const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
		if (savedData) {
			// Explicitly type the loaded grid based on our SerializableGridCell union
            const loadedGrid: SerializableGridCell[][] = JSON.parse(savedData);
			console.log("Loading saved garden state...");

			// Initialize gardenGrid first (important!)
			initializeGrid(); // Use the function to ensure clean grid

			for (let r = 0; r < GRID_DIVISIONS; r++) {
				for (let c = 0; c < GRID_DIVISIONS; c++) {
					const savedCell = loadedGrid[r]?.[c];

					// Only process if not null
					if (savedCell) {
						// Check if this spot is already occupied (e.g., by a pointer from a previously loaded object)
						// This shouldn't happen with correct saving, but good safety check.
						if (gardenGrid[r][c] !== null) {
							console.warn(`Load conflict: Cell [${r}, ${c}] should be empty but is not. Skipping load for saved data at this position.`);
							continue;
						}

						const objectSize = savedCell.size;
                        const worldPos = gridAreaCenterToWorld(r, c, objectSize.rows, objectSize.cols);
                        let newMesh: THREE.Mesh;
                        let newGridObject: PlantInfo | DecorInfo;

                        const userData = { gridPos: { row: r, col: c }, objectType: savedCell.type, typeId: 'plantTypeId' in savedCell ? savedCell.plantTypeId : savedCell.decorTypeId };

                        // --- Differentiate based on loaded 'type' ---
                        if (savedCell.type === 'plant') {
                            const plantData = savedCell; // Now correctly typed
                            newMesh = new THREE.Mesh(placeholderGeometry, healthyMaterial);
                            newMesh.castShadow = true;
                            newMesh.receiveShadow = true;
                            newMesh.userData = userData;

                            const loadedPlant: PlantInfo = {
                                ...plantData, // Spread data (includes type:'plant', but that's okay)
                                mesh: newMesh,
                                gridPos: { row: r, col: c }
                            };
                            newGridObject = loadedPlant;

                            // Plant specific loading steps
                            updatePlantGrowth(loadedPlant); // Offline growth
                            const now = Date.now();
                            const config = plantConfigs[loadedPlant.plantTypeId] ?? plantConfigs.default;
                            if (loadedPlant.state === 'healthy' && (now - loadedPlant.lastWateredTime) > config.thirstThresholdSeconds * 1000) {
                                loadedPlant.state = 'needs_water';
                            }
                            updatePlantVisuals(loadedPlant); // Set visual state

                        } else if (savedCell.type === 'decor') {
                            const decorData = savedCell; // Now correctly typed
                            const material = getDecorMaterial(decorData.decorTypeId);
                            newMesh = new THREE.Mesh(decorGeometry, material);
                            newMesh.castShadow = true;
                            newMesh.receiveShadow = true;
                            newMesh.userData = userData;

                            const loadedDecor: DecorInfo = {
                                ...decorData, // Spread data (includes type:'decor')
                                mesh: newMesh,
                                gridPos: { row: r, col: c }
                                // rotationY is already in decorData
                            };
                            newGridObject = loadedDecor;

                            // Decor specific loading steps
                            newMesh.rotation.y = loadedDecor.rotationY;
                            const decorHeight = (CELL_SIZE * 0.5); // Placeholder height
                            newMesh.position.y = decorHeight / 2; // Set Y position

                        } else {
                             console.warn(`Unknown object type loaded at [${r},${c}]:`, savedCell);
                             continue; // Skip this cell
                        }
                        // --- End Differentiation ---

						// Common loading steps for both types
                        newMesh.position.x = worldPos.x;
                        newMesh.position.z = worldPos.z;
                        // Y position set above based on type
                        scene.add(newMesh);

						// Update Grid: Place main object AND Pointers
                        gardenGrid[r][c] = newGridObject;
                        for (let rOffset = 0; rOffset < objectSize.rows; rOffset++) {
                             for (let cOffset = 0; cOffset < objectSize.cols; cOffset++) {
                                if (rOffset === 0 && cOffset === 0) continue;
                                const targetRow = r + rOffset;
                                const targetCol = c + cOffset;
                                if (targetRow < GRID_DIVISIONS && targetCol < GRID_DIVISIONS) {
                                    if (gardenGrid[targetRow][targetCol] !== null) {
                                         console.warn(`Load conflict pointer at [${targetRow}, ${targetCol}]`);
                                    }
                                    gardenGrid[targetRow][targetCol] = { pointerTo: { row: r, col: c } };
                                } else { /* Warn out of bounds */ }
                            }
                        }
					} // End if(savedCell)
				} // End inner loop (cols)
			} // End outer loop (rows)
			console.log("Garden state loaded.", gardenGrid);
			return true;
		}
	} catch (error) {
		console.error("Failed to load or parse garden state:", error);
		localStorage.removeItem(LOCAL_STORAGE_KEY);
		initializeGrid(); // Initialize fresh grid on error
	}
	return false;
}
// --- End Persistence Functions ---

// performs render on window resize
function performResize() {
		if (!container || !renderer || !camera) return;
		const width = container.clientWidth;
		const height = container.clientHeight;
		const scaleX = width / gardenVisibleSize;
		const scaleY = height / gardenVisibleSize;
		const scale = Math.min(scaleX, scaleY);
		const frustumWidth = width / scale;
		const frustumHeight = height / scale;
		camera.left = -frustumWidth / 2;
		camera.right = frustumWidth / 2;
		camera.top = frustumHeight / 2;
		camera.bottom = -frustumHeight / 2;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height);
		requestRender(); // Request a frame to show the resized view
}
// debounced resizeHandler
const resizeHandler = debounce(performResize, 150);

// Drag n Drop
function handleDragOver(event: DragEvent) {
	event.preventDefault(); // Necessary to allow drop
	if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';

	// --- Preview Update Logic ---
	// Use the generic draggingItem state
    if (!draggingItem || !isRenderLoopActive) return; // Check if dragging anything valid

	// Raycast to find grid position (similar to handleDrop/handlePointerDown)
	const rect = container.getBoundingClientRect();
	const mouseX = event.clientX - rect.left;
	const mouseY = event.clientY - rect.top;
	const mouse = new THREE.Vector2(
		(mouseX / rect.width) * 2 - 1,
		-(mouseY / rect.height) * 2 + 1
	);
	const raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(mouse, camera);
	const intersects = raycaster.intersectObject(ground);

	if (intersects.length > 0) {
		const intersectPoint = intersects[0].point;
		const gridCoords = worldToGrid(intersectPoint.x, intersectPoint.z);

		if (gridCoords) {
			// Optimization: Only update if grid cell changed
			if (!lastPreviewGridPos || lastPreviewGridPos.row !== gridCoords.row || lastPreviewGridPos.col !== gridCoords.col) {
                // Pass the objectType and typeId to updatePreviewBox
                updatePreviewBox(gridCoords.row, gridCoords.col, draggingItem.objectType, draggingItem.typeId);
            }
		} else {
			// Mouse is over the canvas but outside the grid
			hidePreviewBox();
		}
	} else {
		// Mouse is not even over the ground plane (might be over UI elements on canvas?)
		hidePreviewBox();
	}
	// --- End Preview Update Logic ---
}

// Keep your existing handleDrop, but add preview hiding
function handleDrop(event: DragEvent) {
    event.preventDefault();
    const wasInteracting = isInteracting; // Store state BEFORE clearing

    // --- Stop interaction state and capture item info ---
    hidePreviewBox(); // Hide preview (scene state change)
    const itemToPlace = draggingItem; // CAPTURE the item info
    draggingItem = null; // CLEAR the global dragging state
    isInteracting = false; // STOP interaction state

    // Explicitly stop the loop *before* placement attempt
    if (wasInteracting) {
        stopRenderLoop(); // Ensure loop is stopped
    }
    // --- End interaction handling ---

    let placementOccurred = false;

    // --- Placement Logic ---
    if (itemToPlace) {
        const rect = container.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const mouse = new THREE.Vector2((mouseX / rect.width) * 2 - 1, -(mouseY / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(ground);

        if (intersects.length > 0) {
            const intersectPoint = intersects[0].point;
            const gridCoords = worldToGrid(intersectPoint.x, intersectPoint.z);
            if (gridCoords) {
                // Use the generic placer with info captured from itemToPlace
                console.log(`Attempting place: ${itemToPlace.objectType} - ${itemToPlace.typeId} at [${gridCoords.row}, ${gridCoords.col}]`);
                placeGridObjectAt(
                    gridCoords.row,
                    gridCoords.col,
                    itemToPlace.objectType, // Use objectType from captured item
                    itemToPlace.typeId      // Use typeId from captured item
                );
                placementOccurred = true;
            } else {
                console.log("Dropped outside grid.");
            }
        } else {
            console.log("No intersection with ground on drop.");
        }
    } else {
        // This means drag might have started improperly or state got cleared unexpectedly
        console.log("Drop occurred but no valid 'itemToPlace' was available.");
    }
    // --- End Placement Logic ---

    // Request render if placement didn't happen (to show hidden preview)
    if (!placementOccurred) {
        console.log("Placement did not occur, requesting render for hidden preview.");
        requestRender();
    }
}

// Add handleDragEnter
function handleDragEnter(event: DragEvent) {
	event.preventDefault();
	// Reset just in case
    draggingItem = null;

	// Check dataTransfer for either type
    const plantType = event.dataTransfer?.getData('plantType');
    const decorType = event.dataTransfer?.getData('decorType');

	let objectType: 'plant' | 'decor' | null = null;
    let typeId: string | null = null;

    if (plantType && plantConfigs[plantType]) {
        objectType = 'plant';
        typeId = plantType;
    } else if (decorType && decorConfigs[decorType]) {
        objectType = 'decor';
        typeId = decorType;
    }

	if (objectType && typeId) {
        draggingItem = { objectType, typeId }; // Store the item info
        isInteracting = true; // START Interaction
        startRenderLoop();   // START Loop for preview updates
        console.log(`Dragging ${draggingItem.objectType}:`, draggingItem.typeId);
    }
}

// Add handleDragLeave
function handleDragLeave(event: DragEvent) {
	if (event.relatedTarget === null || (event.relatedTarget instanceof Node && !container.contains(event.relatedTarget))) {
        console.log("Drag left container");
        hidePreviewBox();
        draggingItem = null; // Clear the dragging item
        isInteracting = false;
        stopRenderLoop();
    }
}

// Add handleBeforeUnload (Moved outside onMount)
function handleBeforeUnload(event: BeforeUnloadEvent) {
	console.log('beforeunload triggered, saving state...');
	saveGardenState();
};

function renderFrame() {
	// Reset the single frame request flag at the beginning of the frame
	renderRequested = false;
	animationFrameId = undefined; // Clear the ID for this frame

	updateDayNightCycle();

	const now = Date.now();
	let needsSave = false;
	let visualChangeOccurred = false; // Track if anything visually changed this frame
	activeGrowthOccurring = false; // Reset growth flag for this frame

	// --- Live Update Loop ---
	for (let r = 0; r < GRID_DIVISIONS; r++) {
		for (let c = 0; c < GRID_DIVISIONS; c++) {
			const cell = gardenGrid[r]?.[c];
			if (cell && 'plantTypeId' in cell) {
				const plantInfo = cell;
				let stateChangedThisFrame = false;

				// --- Check for Thirst ---
				const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
                if (plantInfo.state === 'healthy' && (now - plantInfo.lastWateredTime) > config.thirstThresholdSeconds * 1000) {
                    plantInfo.state = 'needs_water';
                    stateChangedThisFrame = true;
                    needsSave = true;
                    visualChangeOccurred = true;
                }

                // --- Growth Update ---
                const growthHappened = updatePlantGrowth(plantInfo);
                if (growthHappened) {
                    visualChangeOccurred = true;
                }

                // Track if *any* plant is still growing
                if (plantInfo.state === 'healthy' && plantInfo.growthProgress < 1.0) {
                    activeGrowthOccurring = true;
                }

                // --- Update Plant Visuals ---
                if (stateChangedThisFrame || growthHappened) {
                    updatePlantVisuals(plantInfo);
                }
			}
			// --- No updates needed for DecorInfo within this loop ---
            // (Decor is static after placement for now)
		}
	}

	// --- Save State ---
	if (needsSave) {
		// saveGardenState implicitly calls requestRender if needed
		saveGardenState();
	}

	// --- Render Scene ---
	// We always render if this function is called, either by the loop or requestRender
	renderer.render(scene, camera);

	// --- Decide whether to continue the loop ---
	// Continue if:
	// 1. The loop is *supposed* to be active (isRenderLoopActive is true)
	// AND
	// 2. EITHER the user is interacting.
	const shouldContinueLoop = isRenderLoopActive && isInteracting;

	if (shouldContinueLoop) {
		// Request the next frame for the continuous loop
		animationFrameId = requestAnimationFrame(renderFrame);
	} else if (isRenderLoopActive) {
		// The loop was active, but conditions to continue are no longer met. Stop it.
		console.log("Auto-stopping render loop (no interaction or active growth).");
		stopRenderLoop(); // This also cancels any potential pending animationFrameId
	}
	// If !isRenderLoopActive, this was a single requested frame, so we do nothing more.
}

onMount(() => {
	if (!container) return;

	scene = new THREE.Scene();
	scene.background = new THREE.Color(0xffffff);

	// Initialize or Load State BEFORE setting up camera/renderer etc.
	const loaded = loadGardenState(); // Calls placeObjectAt which calls requestRender
	if (!loaded) {
		initializeGrid();
		requestRender(); // Request render for empty initialized grid
	} else {
		// loadGardenState calls placeObjectAt -> updatePlantVisuals internally
		// We still need one final render after load is complete
		requestRender();
	}

	camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 1, 1000 );
	camera.position.set(10, 10, 10);
	camera.lookAt(0, 0, 0);
	scene.add(camera);

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setSize(container.clientWidth, container.clientHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.shadowMap.enabled = true;
	// Optional: You can choose softer shadow types (might impact performance)
	// renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Example: Softer shadows
	container.appendChild(renderer.domElement);

	ambientLight = new THREE.AmbientLight(0xffffff, MAX_AMBIENT_INTENSITY); // Start with day intensity
	scene.add(ambientLight);

	hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, MAX_HEMISPHERE_INTENSITY); // Start with day intensity
	scene.add(hemisphereLight);

	scene.fog = new THREE.Fog(0xffffff, 25, 50);

	directionalLight = new THREE.DirectionalLight(0xffffff, MAX_DIRECTIONAL_INTENSITY); // Start with day intensity
	// NOTE: We will override the position dynamically now. Setting an initial reasonable one.
    directionalLight.position.set(-SUN_DISTANCE * 0.5, SUN_DISTANCE * 0.7, SUN_DISTANCE * 0.3); // Initial position
    directionalLight.castShadow = true;
	// Configure the shadow camera properties (IMPORTANT!)
	// This defines the box area the light covers for shadows. Adjust as needed for your scene size.
	const shadowCamSize = PLANE_SIZE; // How wide/tall the shadow area is (related to PLANE_SIZE)
	directionalLight.shadow.camera.left = -shadowCamSize;
	directionalLight.shadow.camera.right = shadowCamSize;
	directionalLight.shadow.camera.top = shadowCamSize;
	directionalLight.shadow.camera.bottom = -shadowCamSize;
	directionalLight.shadow.camera.near = 0.5; // How close shadows start from the light source
	directionalLight.shadow.camera.far = 50; // How far shadows extend

	// Optional: Increase shadow map resolution for sharper shadows (more performance cost)
	// directionalLight.shadow.mapSize.width = 2048;
	// directionalLight.shadow.mapSize.height = 2048;
	scene.add(directionalLight);

	// Optional but HIGHLY recommended for debugging shadow camera bounds:
	// const shadowHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
	// scene.add(shadowHelper); // Add temporarily to see the shadow box

	const groundGeometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
	const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x5C946E, side: THREE.DoubleSide });
	ground = new THREE.Mesh(groundGeometry, groundMaterial);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.01;
	ground.receiveShadow = true; // The ground will display shadows cast onto it
	scene.add(ground);

	gridHelper = new THREE.GridHelper(PLANE_SIZE, GRID_DIVISIONS);
	scene.add(gridHelper);

	// --- Preview Bounding Box Setup ---
	validPlacementMaterial = new THREE.MeshBasicMaterial({
		color: 0x00ff00, // Green
		opacity: 0.5,
		transparent: true,
		side: THREE.DoubleSide,
	});
	invalidPlacementMaterial = new THREE.MeshBasicMaterial({
		color: 0xff0000, // Red
		opacity: 0.5,
		transparent: true,
		side: THREE.DoubleSide,
	});

	previewGroup = new THREE.Group();
	previewGroup.visible = false; // Start hidden
	scene.add(previewGroup);

	// Create a pool of preview meshes
	const previewPlaneGeom = new THREE.PlaneGeometry(CELL_SIZE * 0.95, CELL_SIZE * 0.95); // Slightly smaller than cell
	previewPlaneGeom.rotateX(-Math.PI / 2); // Rotate to lay flat

	for (let i = 0; i < MAX_PREVIEW_CELLS; i++) {
		const plane = new THREE.Mesh(previewPlaneGeom, validPlacementMaterial); // Start with valid material
		plane.visible = false; // Hide individual planes initially
		plane.position.y = 0.02; // Slightly above the ground
		previewMeshes.push(plane);
		previewGroup.add(plane);
	}
	// --- End Preview Bounding Box Setup ---

	container.addEventListener('dragenter', handleDragEnter);
	container.addEventListener('dragleave', handleDragLeave);
	container.addEventListener('dragover', handleDragOver);
	container.addEventListener('drop', handleDrop);
	container.addEventListener('pointerdown', handleCanvasPointerDown);
	// --- End Drag and Drop Setup ---

	const handleBeforeUnload = (event: BeforeUnloadEvent) => {
		console.log('beforeunload triggered, saving state...');
		saveGardenState(); // Ensure final save
	};
	// --- Other Listeners ---
	window.addEventListener('resize', resizeHandler); // Use throttled version
	if (typeof window !== 'undefined') {
		window.addEventListener('beforeunload', handleBeforeUnload);
	}

	clock.start();
	// Perform initial resize and render
	performResize(); // Calls requestRender
	// Start periodic save timer
	saveIntervalId = window.setInterval(() => saveGardenState(), SAVE_INTERVAL_MS);

	// Start background intervals (neither should be running yet)
    if (backgroundCheckIntervalId === undefined) {
         backgroundCheckIntervalId = window.setInterval(performBackgroundCheck, BACKGROUND_UPDATE_INTERVAL_MS);
         console.log(`Started growth check interval initially (${BACKGROUND_UPDATE_INTERVAL_MS}ms)`);
    }
    if (idleDayNightCheckIntervalId === undefined) {
         idleDayNightCheckIntervalId = window.setInterval(performIdleBackgroundCheck, IDLE_DAYNIGHT_UPDATE_INTERVAL_MS);
         console.log(`Started idle day/night check interval initially (${IDLE_DAYNIGHT_UPDATE_INTERVAL_MS}ms)`);
    }
	
	// --- Calculate Initial Growth State ---
	// We still need to know if growth is happening so the *first*
	// background check performs correctly. Recalculate after load/init.
	activeGrowthOccurring = false;
	for (let r = 0; r < GRID_DIVISIONS; r++) {
		for (let c = 0; c < GRID_DIVISIONS; c++) {
			const cell = gardenGrid[r]?.[c];
			if (cell && 'plantTypeId' in cell && cell.state === 'healthy' && cell.growthProgress < 1.0) {
				activeGrowthOccurring = true;
				break; // Found one, no need to check further
			}
		}
		if(activeGrowthOccurring) break;
	}
	console.log("Initial active growth status check:", activeGrowthOccurring);

	// *** Trigger initial Day/Night update ***
	updateDayNightCycle(); // Set initial state based on current time

	// onDestroy return function remains the same conceptually
	return () => {
		// The onDestroy Svelte function handles the main cleanup now
		// This returned function is mostly for things *only* added in onMount
		console.log("onMount cleanup function running");
		stopRenderLoop(); // Ensure loop is stopped here too
		// Remove listeners added *specifically* within onMount if any were left
		// (most are handled by onDestroy now)
	};
});

// ... (Keep onDestroy as is, including material/geometry disposal and listener removal) ...
onDestroy(() => {
	stopRenderLoop(); // Explicitly stop the loop on destroy
	if (typeof window !== 'undefined') {
		window.removeEventListener('beforeunload', handleBeforeUnload);
	}
	saveGardenState(); // Final save attempt

	if (animationFrameId !== undefined){
		cancelAnimationFrame(animationFrameId);
	}

	// Clear intervals
    if (saveIntervalId !== undefined) clearInterval(saveIntervalId);
    if (backgroundCheckIntervalId !== undefined) {
        clearInterval(backgroundCheckIntervalId);
        console.log("Stopped growth check interval.");
    }
     if (idleDayNightCheckIntervalId !== undefined) { // Clear idle check too
        clearInterval(idleDayNightCheckIntervalId);
        console.log("Stopped idle day/night check interval.");
    }
	
	window.removeEventListener('resize', resizeHandler); // Remove throttled version
	if (renderer) {
		renderer.dispose();
		if (renderer.domElement.parentNode) {
			renderer.domElement.parentNode.removeChild(renderer.domElement);
		}
	}
	// Enhanced Disposal
	scene.traverse(object => {
		if (object instanceof THREE.Mesh) {
			if (object.geometry) object.geometry.dispose();
			// Dispose materials if they are not shared or manage shared ones carefully
			// Since healthy/thirsty are shared, we dispose them separately below.
			// If plants had unique materials, dispose them here:
			// if (Array.isArray(object.material)) {
			// 	object.material.forEach(material => material.dispose());
			// } else if (object.material) {
			// 	object.material.dispose();
			// }
		}
	});
	// Dispose shared resources explicitly
	ground?.geometry?.dispose();
	if(ground?.material) {
		if (Array.isArray(ground.material)) ground.material.forEach(m => m.dispose());
		else ground.material.dispose();
	}
	gridHelper?.geometry?.dispose();
		if(gridHelper?.material) {
		if (Array.isArray(gridHelper.material)) gridHelper.material.forEach(m => m.dispose());
		else gridHelper.material.dispose();
	}
	placeholderGeometry.dispose();
	healthyMaterial.dispose();
	thirstyMaterial.dispose();
	// Dispose preview materials and geometry
	validPlacementMaterial?.dispose();
	invalidPlacementMaterial?.dispose();
	previewMeshes[0]?.geometry?.dispose(); // Geometry is shared, dispose once

	clock.stop();
	container.removeEventListener('dragenter', handleDragEnter);
	container.removeEventListener('dragleave', handleDragLeave);
	container.removeEventListener('dragover', handleDragOver);
	container.removeEventListener('drop', handleDrop);
	container.removeEventListener('pointerdown', handleCanvasPointerDown);
});
</script>

<div
    bind:this={container}
    style="width: 100%; height: 100%;"
    on:dragover|preventDefault
    on:drop|preventDefault
    role="application"
>
    <!-- Three.js canvas will be appended here -->
</div>

<style>
div {
  display: block;
  width: 100%;
  height: 100%; /* Make div fill container */
  overflow: hidden; /* Prevent scrollbars if canvas slightly overflows */
}
</style>