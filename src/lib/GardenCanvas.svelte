<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import * as THREE from 'three';
import { MathUtils } from 'three'; // For mapLinear and lerp
import { selectedAction, type SelectedAction, heldItem, isDraggingItem, type HeldItemInfo } from './stores';
import { get } from 'svelte/store';
import { GLTFLoader } from 'three-stdlib'; // Import GLTFLoader

// --- Plant Configuration ---
interface PlantConfig {
	growthRatePerSecond: number;
	initialScale: number;
	maxScale: number;
	thirstThresholdSeconds: number;
	size: { rows: number; cols: number }; // Default size for this plant type
    modelPath: string;
	// Add other type-specific things later (e.g., model path)
}

const plantConfigs: Record<string, PlantConfig> = {
	fern: { growthRatePerSecond: 1 / (60 * 1), initialScale: 0.3, maxScale: 1.0, thirstThresholdSeconds: 60 * 1, size: { rows: 1, cols: 1 }, modelPath: '/models/fern.glb' }, // 1x1
	cactus: { growthRatePerSecond: 1 / (60 * 5), initialScale: 0.2, maxScale: 0.8, thirstThresholdSeconds: 60 * 10, size: { rows: 1, cols: 1 }, modelPath: '/models/cactus.glb' }, // 1x1
	// Example of a larger plant:
	bush: { growthRatePerSecond: 1 / (60 * 3), initialScale: 0.1, maxScale: 2, thirstThresholdSeconds: 60 * 8, size: { rows: 2, cols: 2 }, modelPath: '/models/bush.glb' }, // 2x2
	default: { growthRatePerSecond: 1 / (60 * 2), initialScale: 0.4, maxScale: 1.0, thirstThresholdSeconds: 60 * 5, size: { rows: 1, cols: 1 }, modelPath: '' } // Default 1x1
};
// --- End Plant Configuration ---

// --- Decor Configuration ---
interface DecorConfig {
    size: { rows: number; cols: number };
    modelPath?: string;
    defaultRotationY?: number; // Default orientation in radians
}

const decorConfigs: Record<string, DecorConfig> = {
    box: { size: { rows: 1, cols: 1 }, modelPath: '/models/box.glb', defaultRotationY: 0 },
	boxBig: { size: { rows: 2, cols: 2 }, modelPath: '/models/box_big.glb', defaultRotationY: 0 },
};
// --- End Decor Configuration ---

// --- Decor Instance Data Type ---
interface DecorInfo {
    decorTypeId: string; // 'fence_post', 'wooden_box', etc.
    size: { rows: number; cols: number };
    instanceId: number | null;
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
	instanceId: number | null;
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

// --- Asset Loading ---
const loadingManager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(loadingManager);

// Cache for loaded GLTF scenes/models and derived data
interface CachedGltfData {
    scene: THREE.Group; // The full loaded scene
    geometry: THREE.BufferGeometry | null; // Extracted geometry for instancing
    material: THREE.Material | THREE.Material[] | null; // Extracted material(s)
    baseScale: number; // Scale factor to normalize model size
    centerOffsetY: number; // Offset to place model base at y=0
}
const gltfCache: Record<string, CachedGltfData> = {};
let assetsLoaded = false; // Flag to track loading status
let assetsLoadingPromise: Promise<void> | null = null; // To track the loading process
// --- End Asset Loading ---


// --- Grid Objects tracking ---
// Set to hold only PlantInfo objects that currently require
// checks for growth or thirst in the render/update loop.
let updatablePlants: Set<PlantInfo> = new Set();
// Set to hold references to ALL PlantInfo objects currently placed in the garden.
let allPlants: Set<PlantInfo> = new Set();
// Set to hold references to ALL DecorInfo objects currently placed in the garden.
let allDecor: Set<DecorInfo> = new Set();
// --- Grid Objects tracking ---

/// --- Bounding Boxes ---
let previewGroup: THREE.Group | null = null; // Group to hold preview plane meshes
let previewMeshes: THREE.Mesh[] = []; // Array to hold reusable preview plane meshes
const MAX_PREVIEW_CELLS = 16; // Max anticipated size (e.g., 4x4), adjust if needed

// Materials for the preview
let validPlacementMaterial: THREE.MeshBasicMaterial;
let invalidPlacementMaterial: THREE.MeshBasicMaterial;

// --- Placeholder Object Geometry/Materials ---
const healthyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const thirstyMaterial = new THREE.MeshStandardMaterial({ color: 0xa0a0a0 });
const healthyColor = new THREE.Color(healthyMaterial.color); // Get base colors
const thirstyColor = new THREE.Color(thirstyMaterial.color);
// --- End Placeholder Materials ---

// To optimize updates, track the last grid cell the preview was drawn at
let lastPreviewGridPos: { row: number; col: number } | null = null;
const THROTTLE_DRAGOVER_MS = 75;

// --- NEW: State variables to track pointer drag ---
let currentHeldItem: HeldItemInfo | null = null;
let isPointerDragging = false; // Local state reflecting the store
/// --- End Bounding Boxes ---

// --- Instancing (Setup moved to after asset loading) ---
const MAX_INSTANCES_PER_TYPE = 1024;
let instancedMeshes: Record<string, THREE.InstancedMesh> = {};
let instanceIdToDataMap: Map<string, Map<number, PlantInfo | DecorInfo>> = new Map();
const tempMatrix = new THREE.Matrix4();
const tempObject = new THREE.Object3D();
const tempColor = new THREE.Color();
// Base scale factors for models (calculated after loading)
const modelBaseScales: Record<string, number> = {};
const modelYOffsets: Record<string, number> = {};
// --- End Instancing ---


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
const MIDDAY_SKY_COLOR = new THREE.Color(0xB3E2F9); // Slightly bluer sky
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

// To check how long since background update
let lastDayNightUpdateMinute: number = -1;
// --- End Day/Night Cycle ---

let container: HTMLDivElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let ground: THREE.Mesh;

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

const clock = new THREE.Clock(); // Add a clock for delta time

const LOCAL_STORAGE_KEY = 'gardenSaveData'; // Key for localStorage

// --- Day Night Cycle Utility ---
// --- Define Color Segments Data Structure ---
interface ColorSegment {
    startPoint: number;
    endPoint: number;
    skyStart: THREE.Color;
    skyEnd: THREE.Color;
    groundStart: THREE.Color;
    groundEnd: THREE.Color;
    isNight?: boolean; // Optional flag for the constant night segment
}

// Define the segments in chronological order
const colorSegments: ColorSegment[] = [
    // Night before sunrise
    { startPoint: MIDNIGHT_POINT, endPoint: SUNRISE_START_POINT, skyStart: NIGHT_SKY_COLOR, skyEnd: NIGHT_SKY_COLOR, groundStart: NIGHT_GROUND_COLOR, groundEnd: NIGHT_GROUND_COLOR, isNight: true },
    // Sunrise Start -> Peak
    { startPoint: SUNRISE_START_POINT, endPoint: SUNRISE_PEAK_POINT, skyStart: NIGHT_SKY_COLOR, skyEnd: SUNRISE_SKY_COLOR, groundStart: NIGHT_GROUND_COLOR, groundEnd: SUNRISE_GROUND_COLOR },
    // Sunrise Peak -> End (Day Color)
    { startPoint: SUNRISE_PEAK_POINT, endPoint: SUNRISE_END_POINT, skyStart: SUNRISE_SKY_COLOR, skyEnd: DAY_SKY_COLOR, groundStart: SUNRISE_GROUND_COLOR, groundEnd: DAY_GROUND_COLOR },
    // Morning -> Midday
    { startPoint: SUNRISE_END_POINT, endPoint: MIDDAY_POINT, skyStart: DAY_SKY_COLOR, skyEnd: MIDDAY_SKY_COLOR, groundStart: DAY_GROUND_COLOR, groundEnd: MIDDAY_GROUND_COLOR },
    // Midday -> Afternoon (before Sunset Start)
    { startPoint: MIDDAY_POINT, endPoint: SUNSET_START_POINT, skyStart: MIDDAY_SKY_COLOR, skyEnd: DAY_SKY_COLOR, groundStart: MIDDAY_GROUND_COLOR, groundEnd: DAY_GROUND_COLOR },
    // Sunset Start -> Peak
    { startPoint: SUNSET_START_POINT, endPoint: SUNSET_PEAK_POINT, skyStart: DAY_SKY_COLOR, skyEnd: SUNSET_SKY_COLOR, groundStart: DAY_GROUND_COLOR, groundEnd: SUNSET_GROUND_COLOR },
    // Sunset Peak -> End (Night Color)
    { startPoint: SUNSET_PEAK_POINT, endPoint: SUNSET_END_POINT, skyStart: SUNSET_SKY_COLOR, skyEnd: NIGHT_SKY_COLOR, groundStart: SUNSET_GROUND_COLOR, groundEnd: NIGHT_GROUND_COLOR },
    // Night after sunset
    { startPoint: SUNSET_END_POINT, endPoint: NEXT_MIDNIGHT_POINT, skyStart: NIGHT_SKY_COLOR, skyEnd: NIGHT_SKY_COLOR, groundStart: NIGHT_GROUND_COLOR, groundEnd: NIGHT_GROUND_COLOR, isNight: true },
];
// --- End Day Night Cycle Utility ---

// --- Utility Functions ---
function throttle<T extends (...args: any[]) => any>(func: T, limit: number): (...args: Parameters<T>) => void {
    let inThrottle: boolean = false;
    return function(this: ThisParameterType<T>, ...args: Parameters<T>): void {
        if (!inThrottle) {
            func.apply(this, args); // Execute immediately
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
        // Note: This version doesn't queue the last call if it was throttled.
        // For dragover, this is usually acceptable.
    }
}

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
    const segmentDuration = endPoint - startPoint;
    if (segmentDuration <= 0) return 0; // Avoid division by zero or negative duration
    const progressInSegment = cycleProgress - startPoint;
    return Math.max(0, Math.min(1, progressInSegment / segmentDuration));
}

// --- Helper: Extract Geometry/Material and Calculate Scale from GLTF ---
function extractAndPrepareGltfData(gltfScene: THREE.Group, targetSize: number = CELL_SIZE): CachedGltfData | null {
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.Material | THREE.Material[] | null = null;
    let baseScale = 1.0;
    let centerOffsetY = 0;

    gltfScene.traverse((child) => {
        // Find the first Mesh with geometry and material
        if (!geometry && child instanceof THREE.Mesh && child.geometry && child.material) {
            geometry = child.geometry.clone(); // Clone to avoid modifying original
            material = child.material; // Use the original material reference initially
            if (Array.isArray(material)) {
                console.warn("GLTF Mesh has multiple materials. Instancing might look incorrect. Using first material only for base.");
                material = material[0]; // Simplification: Use only the first material for instancing base
            }
            // Ensure material can be tinted if needed (optional, might override model colors)
            // if (material instanceof THREE.MeshStandardMaterial) {
            //     material.vertexColors = true; // Force enable vertex colors if we plan to use the color attribute
            // }

            // --- Calculate Bounding Box and Scaling ---
            if (geometry && !geometry.boundingBox) {
                geometry.computeBoundingBox();
            }
            if (geometry && geometry.boundingBox) {
                const size = new THREE.Vector3();
                geometry.boundingBox.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z); // Find the largest dimension

                if (maxDim > 0) {
                    baseScale = targetSize / maxDim; // Scale factor to make largest dimension = targetSize (e.g., CELL_SIZE)
                }

                // Calculate offset to place bottom of bounding box at y=0
                centerOffsetY = -geometry.boundingBox.min.y * baseScale;

                console.log(`GLTF Prep: Size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}), MaxDim=${maxDim.toFixed(2)}, BaseScale=${baseScale.toFixed(2)}, OffsetY=${centerOffsetY.toFixed(2)}`);
            } else {
                console.warn("Could not compute bounding box for GLTF geometry.");
            }
        }
    });

    if (!geometry || !material) {
        console.error("Could not find suitable Mesh in GLTF scene:", gltfScene);
        return null;
    }

    return { scene: gltfScene, geometry, material, baseScale, centerOffsetY };
}
// --- End Helper ---

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

// --- Function to Update Plant Visuals (MODIFIED for GLTF) ---
/**
 * Updates the Matrix and potentially Color for a specific plant instance.
 */
 function updatePlantVisuals(plantInfo: PlantInfo) {
	if (plantInfo.instanceId === null) return;

	const instancedMesh = instancedMeshes[plantInfo.plantTypeId];
    const cachedGltf = gltfCache[plantConfigs[plantInfo.plantTypeId]?.modelPath]; // Get cached data

	if (!instancedMesh || !cachedGltf) {
		console.error(`InstancedMesh or Cached GLTF not found for plant type: ${plantInfo.plantTypeId}`);
		return;
	}

	const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;

	// --- 1. Calculate Transformation Matrix ---
    // Interpolate scale based on growthProgress (using config's scale targets)
	const growthScaleFactor = MathUtils.lerp(config.initialScale, config.maxScale, plantInfo.growthProgress);
    // Combine base scale (to normalize size) and growth scale
    const finalScale = cachedGltf.baseScale * growthScaleFactor;

	const worldPos = gridAreaCenterToWorld(plantInfo.gridPos.row, plantInfo.gridPos.col, plantInfo.size.rows, plantInfo.size.cols);
    // Adjust Y position based on the model's calculated offset and final scale
    const worldY = cachedGltf.centerOffsetY * growthScaleFactor;

	tempObject.position.set(worldPos.x, worldY, worldPos.z);
	tempObject.scale.set(finalScale, finalScale, finalScale);
	tempObject.rotation.set(0, 0, 0); // Reset rotation (add plant-specific rotation later if needed)
	tempObject.updateMatrix();

	instancedMesh.setMatrixAt(plantInfo.instanceId, tempObject.matrix);
	instancedMesh.instanceMatrix.needsUpdate = true;

	// --- 2. Update Instance Color (Tinting) ---
	if (instancedMesh.instanceColor) {
		const targetColor = plantInfo.state === 'needs_water' ? thirstyColor : healthyColor;
        // Optimization: Check if color changed (optional)
		tempColor.fromArray(instancedMesh.instanceColor.array, plantInfo.instanceId * 3);
		if (!tempColor.equals(targetColor)) {
			instancedMesh.instanceColor.setXYZ(plantInfo.instanceId, targetColor.r, targetColor.g, targetColor.b);
			instancedMesh.instanceColor.needsUpdate = true;
		}
	} else {
        // If the material doesn't support instanceColor, this won't do anything.
        // Consider swapping materials or using uniforms for more complex visual state changes.
    }
     // --- TODO: Future Growth Stage Model Swapping ---
    // Here, you would check plantInfo.growthProgress and potentially:
    // 1. Get the InstancedMesh corresponding to the *correct* growth stage model.
    // 2. Update the matrix/color on *that* mesh instead of a single mesh.
    // This requires having multiple InstancedMesh objects per plant type.
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
 * Periodically checks if background plant processes require a render frame.
 * Checks active growers AND checks idle plants for thirst.
 */
 function performBackgroundCheck() {
    const now = Date.now();
    let needsRender = false;
    let needsSaveFromBackground = false;

    // --- Check 1: Are there plants actively growing? ---
    // If this set has items, they need processing in renderFrame (for growth).
    if (updatablePlants.size > 0) {
        needsRender = true; // Request render for growth updates
        // console.log(`Background Check: ${updatablePlants.size} growing plants require render.`);
    }

    // --- Check 2: Check ALL plants for becoming thirsty (if they aren't already thirsty) ---
    for (const plantInfo of allPlants) {
        // Only check healthy plants
        if (plantInfo.state === 'healthy') {
            const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
            if ((now - plantInfo.lastWateredTime) > config.thirstThresholdSeconds * 1000) {
                // --- This healthy plant has become thirsty! ---
                plantInfo.state = 'needs_water';
                plantInfo.lastUpdateTime = now; // Update time
                needsSaveFromBackground = true; // State changed, need to save
                console.log(`Background Check: Plant [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] became thirsty.`);

                // Update visuals IMMEDIATELY
                updatePlantVisuals(plantInfo);

                // Request render to SHOW the visual change
                needsRender = true;
            }
        }
    }

    // --- Trigger Actions ---
    if (needsSaveFromBackground) {
        debouncedSaveGardenState(); // Use debounced version
    }

    // Request render ONLY if the loop isn't running AND we determined a render is needed
    if (!isRenderLoopActive && needsRender) {
        // console.log("Background Check: Requesting single render frame.");
        requestRender();
    }
     // else { console.log(`Background check: Skipped render (Loop Active or no render needed)`); }
}

/**
 * Periodically checks if the day/night cycle needs updating WHEN the garden is
 * otherwise completely idle (no interaction, no plant updates needed).
 */
 function performIdleBackgroundCheck() {
    // Request render ONLY if loop isn't running AND NO plants need updates AND not interacting
    if (!isRenderLoopActive && updatablePlants.size === 0 && !isInteracting) {
        // console.log("Idle Day/Night check: Requesting render for time update.");
        requestRender(); // Request a single frame JUST to update day/night visuals
    }
     // else { console.log(`Idle Day/Night check: Skipped (Loop Active or Plants Need Update [${updatablePlants.size}] or Interacting)`); }
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
function updateDayNightCycle(currentTime: Date) {
    if (!directionalLight || !ambientLight || !hemisphereLight || !scene) return;

    const now = currentTime || new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const cycleProgress = currentHour / 24;

    // --- Find Active Color Segment ---
    // Find the *first* segment where the current time is less than the end point.
    const activeSegment = colorSegments.find(segment => cycleProgress < segment.endPoint);

    // Default to the last segment (night after sunset) if something goes wrong or cycleProgress is exactly 1.0
    const currentSegment = activeSegment ?? colorSegments[colorSegments.length - 1];

    // --- Lerp Colors ---
    let colorSegmentProgress = 0;
    if (!currentSegment.isNight) { // Only calculate progress if it's not a constant night segment
        colorSegmentProgress = calculateSegmentProgress(
            cycleProgress,
            currentSegment.startPoint,
            currentSegment.endPoint
        );
    }
    currentSkyColor.copy(currentSegment.skyStart).lerp(currentSegment.skyEnd, colorSegmentProgress);
    currentGroundColor.copy(currentSegment.groundStart).lerp(currentSegment.groundEnd, colorSegmentProgress);

    // --- Calculate Sun Angle (Derived from major time points) ---
    // This logic remains separate as it uses different key points than the detailed color segments
    let currentAngle: number;
    if (cycleProgress >= SUNRISE_START_POINT && cycleProgress < SUNSET_END_POINT) { // Daytime
        currentAngle = (cycleProgress < MIDDAY_POINT)
            ? MathUtils.mapLinear(cycleProgress, SUNRISE_START_POINT, MIDDAY_POINT, 0, Math.PI / 2) // Morning
            : MathUtils.mapLinear(cycleProgress, MIDDAY_POINT, SUNSET_END_POINT, Math.PI / 2, Math.PI); // Afternoon
    } else { // Night time
        const nightDuration = (NEXT_MIDNIGHT_POINT - SUNSET_END_POINT) + SUNRISE_START_POINT;
        const progressThroughNight = (cycleProgress >= SUNSET_END_POINT)
            ? (cycleProgress - SUNSET_END_POINT) / nightDuration
            : ((NEXT_MIDNIGHT_POINT - SUNSET_END_POINT) + cycleProgress) / nightDuration;
        currentAngle = MathUtils.lerp(Math.PI, 2 * Math.PI, progressThroughNight);
    }

    // --- Calculate Sun Position ---
    const lightY = Math.sin(currentAngle) * SUN_DISTANCE; // Altitude
    directionalLight.position.set(
        Math.cos(currentAngle) * SUN_DISTANCE, // X position (East/West)
        lightY,
        SUN_DISTANCE * 0.1 // Z offset (optional constant)
    );
    directionalLight.target.position.set(0, 0, 0);
    directionalLight.target.updateMatrixWorld();

    // --- Calculate Intensities ---
    const intensityFactor = Math.max(0, lightY / SUN_DISTANCE); // Use normalized height (0 to 1)
    directionalLight.intensity = MathUtils.lerp(MIN_DIRECTIONAL_INTENSITY, MAX_DIRECTIONAL_INTENSITY, intensityFactor);
    ambientLight.intensity = MathUtils.lerp(MIN_AMBIENT_INTENSITY, MAX_AMBIENT_INTENSITY, intensityFactor);
    hemisphereLight.intensity = MathUtils.lerp(MIN_HEMISPHERE_INTENSITY, MAX_HEMISPHERE_INTENSITY, intensityFactor);
    
    // --- Apply Colors and Intensities ---
    scene.background = currentSkyColor;
    ambientLight.color.copy(currentSkyColor);
    hemisphereLight.color.copy(currentSkyColor);
    hemisphereLight.groundColor.copy(currentGroundColor);
    if (scene.fog) { // Check if fog exists
         scene.fog.color.copy(currentSkyColor);
    }

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
    const gridObjectInfo = getGridObjectInfoAt(row, col); // Get the main info object

    if (!gridObjectInfo || gridObjectInfo.instanceId === null) {
        console.log(`No valid object with instanceId found at or pointed to by [${row}, ${col}] to remove.`);
        return;
    }

    const objectType = 'plantTypeId' in gridObjectInfo ? 'plant' : 'decor';
    const typeId = objectType === 'plant' ? (gridObjectInfo as PlantInfo).plantTypeId : (gridObjectInfo as DecorInfo).decorTypeId;
    const instanceIdToRemove = gridObjectInfo.instanceId;
    const objectToRemove = gridObjectInfo; // Keep a reference

    console.log(`Removing ${objectType} ${typeId} at [${objectToRemove.gridPos.row}, ${objectToRemove.gridPos.col}], instanceId ${instanceIdToRemove}`);

    // --- 1. Find InstancedMesh & Instance Map ---
    const instancedMesh = instancedMeshes[typeId];
    if (!instancedMesh) {
        console.error(`Removal Error: InstancedMesh not found for type ${typeId}. Cannot remove.`);
        // Clear Grid Data as fallback
        const { size, gridPos } = objectToRemove;
        for (let rOffset = 0; rOffset < size.rows; rOffset++) {
            for (let cOffset = 0; cOffset < size.cols; cOffset++) {
                const targetRow = gridPos.row + rOffset;
                const targetCol = gridPos.col + cOffset;
                if (targetRow >= 0 && targetRow < GRID_DIVISIONS && targetCol >= 0 && targetCol < GRID_DIVISIONS) {
                    // Double check we are clearing the right thing, especially if a pointer exists
                    const cell = gardenGrid[targetRow]?.[targetCol];
                    if (cell === objectToRemove || (cell && 'pointerTo' in cell && cell.pointerTo.row === gridPos.row && cell.pointerTo.col === gridPos.col)) {
                        gardenGrid[targetRow][targetCol] = null;
                    } else if(cell !== null){
                        // This might happen if grid somehow became inconsistent, log a warning
                        console.warn(`   Grid cell [${targetRow}, ${targetCol}] did not contain the expected object or pointer during removal cleanup. Cell content:`, cell);
                    }
                } else {
                    console.warn(`   Attempted to clear grid cell out of bounds: [${targetRow}, ${targetCol}]`);
                }
            }
        }
        // Remove from sets
        if (objectType === 'plant') {
            allPlants.delete(objectToRemove as PlantInfo);
            updatablePlants.delete(objectToRemove as PlantInfo);
        } else {
            allDecor.delete(objectToRemove as DecorInfo);
        }
        debouncedSaveGardenState(); // Save the grid clearing
        return; // Exit function
    }

    const instanceMap = instanceIdToDataMap.get(instancedMesh.uuid);
    if (!instanceMap) {
        console.error(`Removal Error: Instance Map not found for mesh UUID ${instancedMesh.uuid}`);
        return; // Should not happen if mesh exists
    }

    // --- Sanity Check ---
    if (instanceIdToRemove >= instancedMesh.count) {
         console.error(`Removal Error: instanceId ${instanceIdToRemove} is out of bounds for mesh count ${instancedMesh.count}`);
         return;
    }

    // --- 2. Get Last Instance Info ---
    const lastInstanceId = instancedMesh.count - 1;
    const lastInstanceInfo = instanceMap.get(lastInstanceId); // Can be undefined if count is 0 or map inconsistent

    // --- 3. Perform Swap (if necessary) ---
    let swapOccurred = false;
    if (instanceIdToRemove !== lastInstanceId && lastInstanceInfo) {
        swapOccurred = true;
        console.log(`   Swapping instance ${instanceIdToRemove} with last instance ${lastInstanceId}`);
        // Copy Matrix from last instance to removed instance's slot
        instancedMesh.getMatrixAt(lastInstanceId, tempMatrix);
        instancedMesh.setMatrixAt(instanceIdToRemove, tempMatrix);
        instancedMesh.instanceMatrix.needsUpdate = true;

        // Copy Color from last instance to removed instance's slot (if applicable)
        if (instancedMesh.instanceColor) {
            tempColor.fromArray(instancedMesh.instanceColor.array, lastInstanceId * 3);
            instancedMesh.instanceColor.setXYZ(instanceIdToRemove, tempColor.r, tempColor.g, tempColor.b);
            instancedMesh.instanceColor.needsUpdate = true;
        }

        // Update the 'last' info object's instanceId to point to the freed slot
        lastInstanceInfo.instanceId = instanceIdToRemove;

        // Update the map: map the *new* ID (instanceIdToRemove) to the *last* info object
        // This must happen AFTER deleting the old entries
        // instanceMap.set(instanceIdToRemove, lastInstanceInfo); // Moved down

    } else {
         console.log(`   Removing the last instance (${instanceIdToRemove}), no swap needed.`);
         // Optional: Could explicitly zero out matrix/color for the removed slot, but reducing count is key.
    }

    // --- 4. Update Instance Map (CRITICAL ORDER) ---
    instanceMap.delete(instanceIdToRemove);
    if (swapOccurred && lastInstanceInfo) {
        instanceMap.delete(lastInstanceId); // Remove old mapping for the swapped item
        instanceMap.set(instanceIdToRemove, lastInstanceInfo); // Add new mapping for the swapped item
    }

    // --- 5. Clean Up Original Object's Data ---
    if (objectType === 'plant') {
        allPlants.delete(objectToRemove as PlantInfo);
        updatablePlants.delete(objectToRemove as PlantInfo);
    } else {
        allDecor.delete(objectToRemove as DecorInfo);
    }
    objectToRemove.instanceId = null;

    // --- 6. Decrement Count & Clear Grid ---
    instancedMesh.count--;
    // console.log(`   Mesh ${instancedMesh.uuid.substring(0, 4)}... count is now ${instancedMesh.count}`);

    // Clear Grid Data (as before)
    const { size, gridPos } = objectToRemove;
    for (let rOffset = 0; rOffset < size.rows; rOffset++) {
		for (let cOffset = 0; cOffset < size.cols; cOffset++) {
			const targetRow = gridPos.row + rOffset;
			const targetCol = gridPos.col + cOffset;
			if (targetRow >= 0 && targetRow < GRID_DIVISIONS && targetCol >= 0 && targetCol < GRID_DIVISIONS) {
                const cell = gardenGrid[targetRow]?.[targetCol];
                if (cell === objectToRemove || (cell && 'pointerTo' in cell && cell.pointerTo.row === gridPos.row && cell.pointerTo.col === gridPos.col)) {
                    gardenGrid[targetRow][targetCol] = null;
                }
                // else if(cell !== null){ console.warn(...); } // Keep warning
            }
            // else { console.warn(...); } // Keep warning
        }
	}

    // --- 7. Save and Render ---
    debouncedSaveGardenState();
    if (!isRenderLoopActive) {
        requestRender();
    }
}

// --- Function to Place Grid Object ---
// typeId can be plantTypeId or decorTypeId
function placeGridObjectAt(row: number, col: number, objectType: 'plant' | 'decor', typeId: string, initialState?: Partial<PlantInfo | DecorInfo>) {
    // --- Asset Check ---
    if (!assetsLoaded) {
        console.warn(`Assets not loaded yet. Cannot place ${typeId}.`);
        // TODO: Queue placement? Or just fail? For now, fail.
        return;
    }

    const config = objectType === 'plant'
        ? plantConfigs[typeId]
        : decorConfigs[typeId];

    if (!config || !config.modelPath) {
        console.error(`No config or modelPath found for ${objectType} with id ${typeId}`);
        return;
    }
    const cachedGltf = gltfCache[config.modelPath];
    if (!cachedGltf || !cachedGltf.geometry || !cachedGltf.material) {
        console.error(`Cached GLTF data missing or invalid for ${typeId} (${config.modelPath}). Cannot place.`);
        return;
    }

    const objectSize = config.size;

	// --- Free Space for Placement Check ---
    if (!isAreaFree(row, col, objectSize.rows, objectSize.cols)) {
        console.log(`Cannot place ${typeId} of size ${objectSize.rows}x${objectSize.cols} at [${row}, ${col}], area not free.`);
		if (!isRenderLoopActive) {
			// Request render to hide preview box
			requestRender();
		}
        return;
    }
    // --- Free Space for Placement Check ---


    // --- 1. Find Target InstancedMesh ---
    const instancedMesh = instancedMeshes[typeId];
    if (!instancedMesh) {
        console.error(`Placement Error: InstancedMesh not found for type: ${typeId}`);
        return;
    }

	// --- 2. Get Next Instance ID & Check Limit ---
    const instanceId = instancedMesh.count; // Next available slot is the current count
    if (instanceId >= MAX_INSTANCES_PER_TYPE) {
        console.error(`Cannot place ${typeId}: Maximum instances (${MAX_INSTANCES_PER_TYPE}) reached for this type.`);
        // TODO: Maybe provide user feedback here?
        return;
    }

    // --- 3. Create PlantInfo / DecorInfo ---
    const now = Date.now();
    let newGridObject: PlantInfo | DecorInfo;

    if (objectType === 'plant') {
        const newPlant: PlantInfo = {
            plantTypeId: typeId,
            state: 'healthy',
            growthProgress: 0.0,
            lastUpdateTime: now,
            lastWateredTime: now,
            size: { /* from config */ ...objectSize },
            gridPos: { row, col },
            instanceId: instanceId,
            // --- Apply Initial State (mainly for loading) ---
            ...(initialState as Partial<PlantInfo>) // Spread overrides
        };
        
        // Recalculate lastUpdateTime based on loaded progress if needed (complex offline growth)
        // Or ensure loaded data has correct lastUpdateTime/lastWateredTime
        if (initialState && 'lastUpdateTime' in initialState && initialState.lastUpdateTime) {
            newPlant.lastUpdateTime = initialState.lastUpdateTime;
        }
        if (initialState && 'lastWateredTime' in initialState && initialState.lastWateredTime) {
            newPlant.lastWateredTime = initialState.lastWateredTime;
        }

        newGridObject = newPlant;
        allPlants.add(newPlant);
         // Check state AFTER applying initial state
        if (newPlant.state === 'healthy' && newPlant.growthProgress < 1.0) {
             updatablePlants.add(newPlant);
        }
    } else { // objectType === 'decor'
        const decorConfig = config as DecorConfig;
        const rotationY = (initialState as DecorInfo)?.rotationY ?? decorConfig.defaultRotationY ?? 0; // Use loaded rotation if available
        const newDecor: DecorInfo = {
            decorTypeId: typeId,
            size: { ...objectSize },
            gridPos: { row, col },
            instanceId: instanceId,
            rotationY: rotationY,
             // Apply other initial state if needed
             ...(initialState as Partial<DecorInfo>)
        };
        newGridObject = newDecor;
        allDecor.add(newDecor);
    }

    // --- 4. Update Grid & Mapping ---
    gardenGrid[row][col] = newGridObject;
    // Place pointers in grid
    for (let rOffset = 0; rOffset < objectSize.rows; rOffset++){
		for (let cOffset = 0; cOffset < objectSize.cols; cOffset++) {
            if (rOffset === 0 && cOffset === 0) continue;
            const targetRow = row + rOffset;
            const targetCol = col + cOffset;
            if (targetRow < GRID_DIVISIONS && targetCol < GRID_DIVISIONS) {
                gardenGrid[targetRow][targetCol] = { pointerTo: { row, col } };
            }
        }
	}

	// Add to reverse lookup map
    const instanceMap = instanceIdToDataMap.get(instancedMesh.uuid);
    if (instanceMap) {
        instanceMap.set(instanceId, newGridObject);
    } else {
         console.error(`Placement Error: Instance map not found for mesh UUID: ${instancedMesh.uuid}`);
         // Attempt cleanup? This shouldn't happen if setup is correct.
         // Maybe remove object from allPlants/allDecor here?
         return;
    }
    console.log(`Placed ${objectType} ${typeId} at [${row}, ${col}], assigned instanceId ${instanceId} to mesh ${instancedMesh.uuid.substring(0, 4)}...`);

    // --- 5. Set Initial Instance Transform & Color (using GLTF data) ---
    const worldPos = gridAreaCenterToWorld(row, col, objectSize.rows, objectSize.cols);
    let initialScaleFactor = 1.0; // Base scale factor
    let finalScale = 1.0;         // Scale including growth/decor scaling
    let objectRotationY = 0;
    let initialColor = healthyColor; // Default

    if (objectType === 'plant') {
		const plantInfo = newGridObject as PlantInfo;
		const plantConfig = config as PlantConfig;
        // Scale factor based on initial growth state
        initialScaleFactor = MathUtils.lerp(plantConfig.initialScale, plantConfig.maxScale, plantInfo.growthProgress);
        finalScale = cachedGltf.baseScale * initialScaleFactor;
        initialColor = plantInfo.state === 'needs_water' ? thirstyColor : healthyColor;
        // plant rotation is 0 for now
    } else { // objectType === 'decor'
        const decorInfo = newGridObject as DecorInfo;
        // Decor scale is fixed (unless config changes)
        initialScaleFactor = 1.0; // Or read from config if decor can scale?
        finalScale = cachedGltf.baseScale * initialScaleFactor;
        objectRotationY = decorInfo.rotationY;
        // Decor color is typically from its own material, but we can tint if needed
        // initialColor = ...;
    }

    // Apply transform
    const worldY = cachedGltf.centerOffsetY * initialScaleFactor; // Adjust Y based on normalized offset and current scale factor
    tempObject.position.set(worldPos.x, worldY, worldPos.z);
	tempObject.scale.set(finalScale, finalScale, finalScale);
	tempObject.rotation.set(0, objectRotationY, 0);
	tempObject.updateMatrix();
	instancedMesh.setMatrixAt(instanceId, tempObject.matrix);
    instancedMesh.instanceMatrix.needsUpdate = true;

    // Apply initial color tinting
    if (instancedMesh.instanceColor) {
        instancedMesh.instanceColor.setXYZ(instanceId, initialColor.r, initialColor.g, initialColor.b);
        instancedMesh.instanceColor.needsUpdate = true;
    }

    // --- 6. Increment Instance Count ---
    instancedMesh.count = instanceId + 1;
    console.log(`   Mesh ${instancedMesh.uuid.substring(0, 4)}... count is now ${instancedMesh.count}`);


    // --- 7. Save and Render ---
    // DO NOT trigger save when called from loadGardenState
	if (!initialState) { // Only save/render if NOT loading
		debouncedSaveGardenState();
		if (!isRenderLoopActive) {
			requestRender();
		}
	}
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
		let visualStateChanged = false;
		let timeUpdated = false;
		const now = Date.now();

		if (plantInfo.state === 'needs_water') {
			plantInfo.state = 'healthy';
            plantInfo.lastUpdateTime = now; // Reset growth timer base
            plantInfo.lastWateredTime = now; // Update last watered time
			console.log(`   Plant is now healthy.`);
			updatePlantVisuals(plantInfo); // Update visuals
			visualStateChanged = true;
			timeUpdated = true;

			// Add back to updatable list ONLY if it can now grow
            // const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default; // NOTE: don't know why AI thinks config is needed here?
            if (plantInfo.growthProgress < 1.0) {
                 // Only add if not fully grown
                 updatablePlants.add(plantInfo);
                 console.log(`   Plant [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] added back to updatable list (can grow). Size: ${updatablePlants.size}`);
                 // Request a render if the loop isn't active, as growth might start now
                 if (!isRenderLoopActive) requestRender();
            } else {
                 console.log(`   Plant [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] is healthy but fully grown, not added to updatable list.`);
            }
		} else {
			plantInfo.lastWateredTime = now; // Reset thirst timer
			console.log(`   Plant was already healthy, reset thirst timer.`);
			timeUpdated = true;
			// No change needed to updatablePlants list if already healthy
			// TODO: Add feedback even if already healthy
		}

		// Trigger Save and Render
		if (visualStateChanged || timeUpdated) { // If state OR timer changed
            if(visualStateChanged && !isRenderLoopActive){
                 // If the visuals actually changed (went from thirsty to healthy)
                 // and the loop isn't already running, request a single frame.
                 console.log("Requesting render due to visual state change on watering.");
                 requestRender();
            }
			debouncedSaveGardenState(); // Save state (debounced)
		}
	} else if (gridObjectInfo) {
         console.log(`Cannot water object at [${row}, ${col}], it's other object.`);
    } else {
        console.log(`No object found at or pointed to by [${row}, ${col}] to water.`);
    }
}
// --- End Function to Water Plant ---

function handleCanvasPointerDown(event: PointerEvent) {
	// --- Prevent tool action if currently dragging an item ---
	if (isPointerDragging) {
        console.log("Canvas pointer down ignored (dragging item).");
        return;
    }
    // --- End Prevent ---

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

	// --- Target ONLY the Instanced Meshes and the Ground ---
    // Create a list of objects to intersect
    const objectsToIntersect: THREE.Object3D[] = [ground];
    for (const typeId in instancedMeshes) {
        // Only intersect if the mesh has active instances
        if (instancedMeshes[typeId].count > 0) {
             objectsToIntersect.push(instancedMeshes[typeId]);
        }
    }

	// Raycast against the specific list
	const intersects = raycaster.intersectObjects(objectsToIntersect, false); // `false` because InstancedMesh is not recursive container

	let interactionOccurred = false;
    let hitInfo: { info: PlantInfo | DecorInfo, type: 'plant' | 'decor' } | null = null;
    let groundHitPoint: THREE.Vector3 | null = null;

	// --- Phase 1: Check for direct hit on Plant/Decor ---
    if (intersects.length > 0) {
        for (const intersect of intersects) {
            const intersectedObject = intersect.object;

            if (intersect.object instanceof THREE.InstancedMesh && intersect.instanceId !== undefined) {
				const hitMesh = intersect.object;
                const hitInstanceId = intersect.instanceId;

				// Look up the data using the map
				const instanceMap = instanceIdToDataMap.get(hitMesh.uuid);
                const objectInfo = instanceMap?.get(hitInstanceId);

                if (objectInfo) {
                    const objectType = 'plantTypeId' in objectInfo ? 'plant' : 'decor';
                    hitInfo = { info: objectInfo, type: objectType };
                    console.log(`Raycast direct hit on InstancedMesh ${hitMesh.userData.typeId}, instance ${hitInstanceId}, found ${objectType} [${objectInfo.gridPos.row}, ${objectInfo.gridPos.col}]`);
                    break; // Found the target instance, stop searching
                }
				else{
					console.warn(`Raycast hit instance ${hitInstanceId} on mesh ${hitMesh.userData.typeId}, but no data found in map.`);
					// This might happen if map is out of sync or instanceId is beyond count somehow
				}
            } else if (intersect.object === ground && !groundHitPoint) {
                 // Record the first ground hit point
				groundHitPoint = intersect.point;
				// Don't break here, an InstancedMesh hit might be closer
            }
        }
    }

    // --- Phase 2: Perform Action based on Tool and Hit Result ---
    if (currentAction.toolType === 'water') {
        if (hitInfo?.type === 'plant') {
            // Direct hit on a plant - water it
            console.log(`Watering plant directly at [${hitInfo.info.gridPos.row}, ${hitInfo.info.gridPos.col}]`);
            waterPlantAt(hitInfo.info.gridPos.row, hitInfo.info.gridPos.col);
            interactionOccurred = true;
        } else if (groundHitPoint) {
            // No direct instance hit, but hit the ground. Check the grid cell.
            const gridCoords = worldToGrid(groundHitPoint.x, groundHitPoint.z);
            if (gridCoords) {
                const objectInCell = getGridObjectInfoAt(gridCoords.row, gridCoords.col);
                if (objectInCell && 'plantTypeId' in objectInCell) {
                    // Found a plant in the grid cell clicked - water it
                    console.log(`Watering plant via ground click at grid [${gridCoords.row}, ${gridCoords.col}], target: [${objectInCell.gridPos.row}, ${objectInCell.gridPos.col}]`);
                    waterPlantAt(gridCoords.row, gridCoords.col); // Use clicked coords, waterPlantAt resolves pointer
                    interactionOccurred = true;
                } else {
                     console.log(`Ground click at [${gridCoords.row}, ${gridCoords.col}], but no plant found.`);
                }
            }
        } else {
             console.log("Water tool clicked, but missed plant and ground?");
        }

    } else if (currentAction.toolType === 'remove') {
        if (hitInfo) {
            // Direct hit on plant or decor - remove it
            const info = hitInfo.info;
            console.log(`Removing ${hitInfo.type} directly at [${info.gridPos.row}, ${info.gridPos.col}]`);
            removeGridObjectAt(info.gridPos.row, info.gridPos.col);
            interactionOccurred = true;
        } else if (groundHitPoint) {
            // No direct hit, but hit the ground. Check the grid cell.
            const gridCoords = worldToGrid(groundHitPoint.x, groundHitPoint.z);
            if (gridCoords) {
                const objectInCell = getGridObjectInfoAt(gridCoords.row, gridCoords.col);
                if (objectInCell) {
                    // Found *something* (plant or decor) in the grid cell - remove it
                    const objectType = 'plantTypeId' in objectInCell ? 'plant' : 'decor';
                    console.log(`Removing ${objectType} via ground click at grid [${gridCoords.row}, ${gridCoords.col}], target: [${objectInCell.gridPos.row}, ${objectInCell.gridPos.col}]`);
                    removeGridObjectAt(gridCoords.row, gridCoords.col); // Use clicked coords, removeGridObjectAt resolves pointer
                    interactionOccurred = true;
                } else {
                     console.log(`Ground click at [${gridCoords.row}, ${gridCoords.col}], but no object found to remove.`);
                }
            }
        } else {
             console.log("Remove tool clicked, but missed object and ground?");
        }
    }
    // Add other tool handlers here if needed ('place' tool doesn't use click, it uses drag/drop)
	// End if intersects.length > 0
	// --- Finalization ---
    isInteracting = false; // Interaction ends immediately for tools

    // Request render if an action occurred *while idle*
    // Note: place/remove/water functions already handle their own render requests now.
    // This check might be redundant, but safe to keep.
    // if (interactionOccurred && !isRenderLoopActive) {
        // console.log("Tool interaction completed while idle, ensuring render request.");
        // requestRender(); // The action functions should cover this
    // }
}

// --- NEW: Pointer Move Handler (for dragging items) ---
// Use throttle settings from the old dragover logic
const THROTTLE_POINTER_MOVE_MS = 50; // Reduced slightly for responsiveness? Or keep 75ms.

const throttledPointerMoveLogic = throttle((event: PointerEvent) => {
    if (!isPointerDragging || !currentHeldItem || !container || !camera || !ground) {
        // console.log("throttledPointerMoveLogic skipped: not dragging or missing refs");
        return;
    }

    // Calculate pointer position relative to the canvas container
    const rect = container.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    // Check if pointer is within canvas bounds (optional, but can prevent unnecessary raycasts)
    if (pointerX < 0 || pointerX > rect.width || pointerY < 0 || pointerY > rect.height) {
         // Pointer is outside the canvas, hide preview
         hidePreviewBox();
         lastPreviewGridPos = null; // Reset last position
         // requestRender(); // Hide preview - render loop should be active
         return;
    }


    // Convert pointer coordinates to normalized device coordinates (NDC)
    const mouse = new THREE.Vector2(
        (pointerX / rect.width) * 2 - 1,
        -(pointerY / rect.height) * 2 + 1
    );

    // Raycast to find grid position (similar to old dragOver)
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(ground);

    if (intersects.length > 0) {
        const intersectPoint = intersects[0].point;
        const gridCoords = worldToGrid(intersectPoint.x, intersectPoint.z);

        if (gridCoords) {
            // Optimization: Only update preview if grid cell changed
            if (!lastPreviewGridPos || lastPreviewGridPos.row !== gridCoords.row || lastPreviewGridPos.col !== gridCoords.col) {
                // console.log("Pointer move update preview:", gridCoords);
                updatePreviewBox(gridCoords.row, gridCoords.col, currentHeldItem.objectType, currentHeldItem.typeId);
                 // Render loop should be running, no explicit request needed here normally
                 // if (!isRenderLoopActive) requestRender();
            }
        } else {
            // Pointer is over the canvas but outside the defined grid area
            // console.log("Pointer move hide preview: outside grid");
            hidePreviewBox();
            // if (!isRenderLoopActive) requestRender();
        }
    } else {
        // Pointer is not over the ground plane (e.g., maybe over UI elements temporarily if they overlay)
         // console.log("Pointer move hide preview: missed ground");
         hidePreviewBox();
         // if (!isRenderLoopActive) requestRender();
    }
}, THROTTLE_POINTER_MOVE_MS);

function handlePointerMove(event: PointerEvent) {
    // Only process if dragging an item
    if (!isPointerDragging || !currentHeldItem) {
        return;
    }
    // Call the throttled logic
    throttledPointerMoveLogic(event);
}
// --- End Pointer Move Handler ---


// --- NEW: Pointer Up/Cancel Handler (for placing items) ---
function handlePointerUpOrCancel(event: PointerEvent) {
    // Only process if we were actively dragging an item with this pointer
     if (!isPointerDragging || !currentHeldItem) {
        // console.log("Pointer up/cancel ignored: not dragging.");
        return;
    }
    // Check if the event's pointerId matches the one that started the drag
    // (This requires storing the initial pointerId in heldItem store, which we omitted for simplicity)
    // For now, assume any pointer up/cancel while dragging ends the drag.

    console.log("Pointer up/cancel detected, attempting placement...");

    const itemToPlace = { ...currentHeldItem }; // Capture item info before clearing state

    // --- Clean up drag state ---
    hidePreviewBox(); // Hide preview immediately
    heldItem.set(null); // Clear the store
    isDraggingItem.set(false); // Clear the store
    // isPointerDragging = false; // Local flag updated via store subscription
    isInteracting = false; // Stop interaction state
    stopRenderLoop();   // Stop the render loop explicitly
    // Note: Pointer capture release is handled by the UI element's own listeners now.

    let placementOccurred = false;

    // --- Placement Logic (similar to old handleDrop) ---
    // Calculate pointer position relative to the canvas container *at the moment of release*
    const rect = container.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

     // Check if pointer is within canvas bounds for placement
    if (pointerX >= 0 && pointerX <= rect.width && pointerY >= 0 && pointerY <= rect.height) {
        const mouse = new THREE.Vector2(
            (pointerX / rect.width) * 2 - 1,
            -(pointerY / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(ground);

        if (intersects.length > 0) {
            const intersectPoint = intersects[0].point;
            const gridCoords = worldToGrid(intersectPoint.x, intersectPoint.z);
            if (gridCoords) {
                console.log(`Attempting pointer place: ${itemToPlace.objectType} - ${itemToPlace.typeId} at [${gridCoords.row}, ${gridCoords.col}]`);
                placeGridObjectAt(
                    gridCoords.row,
                    gridCoords.col,
                    itemToPlace.objectType,
                    itemToPlace.typeId
                );
                // placeGridObjectAt requests render if needed and saves state
                placementOccurred = true;
            } else {
                console.log("Pointer released over canvas, but outside grid.");
            }
        } else {
            console.log("Pointer released over canvas, but missed ground intersection.");
        }
    } else {
         console.log("Pointer released outside canvas bounds.");
    }
    // --- End Placement Logic ---

    // If placement didn't happen, we still need to render the hidden preview state
    if (!placementOccurred) {
         console.log("Placement did not occur on pointer up/cancel.");
         // No render needed here, as stopRenderLoop() was called, and hidePreviewBox() doesn't require a render itself.
         // The scene is now static until the next interaction or background update.
    }
}
// --- End Pointer Up/Cancel Handler ---

// --- NEW: Asset Loading Function ---
async function loadAssets() {
    console.log("Starting asset loading...");
    const loadPromises: Promise<void>[] = [];
    const allConfigs = { ...plantConfigs, ...decorConfigs };

    // --- Collect all unique model paths ---
    const modelPathsToLoad = new Set<string>();
    for (const typeId in allConfigs) {
        if (typeId === 'default' && !plantConfigs.default.modelPath) continue;
        const config = allConfigs[typeId];
        if (config.modelPath) {
            modelPathsToLoad.add(config.modelPath);
        } else {
            console.warn(`No model path specified for typeId: ${typeId}`);
        }
    }

    // --- Load each unique path ---
    for (const modelPath of modelPathsToLoad) {
        if (!gltfCache[modelPath]) { // Only load if not already cached (might be redundant check)
             const loadPromise = new Promise<void>((resolve, reject) => {
                console.log(`Loading model: ${modelPath}`);
                gltfLoader.load(
                    modelPath,
                    (gltf) => {
                        console.log(`Successfully loaded: ${modelPath}`);
                        const preparedData = extractAndPrepareGltfData(gltf.scene);
                        if (preparedData) {
                            gltfCache[modelPath] = preparedData;
                            resolve();
                        } else {
                             console.error(`Failed to extract data from GLTF: ${modelPath}`);
                             resolve(); // Resolve anyway so Promise.all doesn't fail? Or reject?
                             // reject(new Error(`Failed processing ${modelPath}`)); // Option to reject
                        }
                    },
                    undefined, // Optional progress callback
                    (error) => {
                        console.error(`Error loading GLTF: ${modelPath}`, error);
                        resolve(); // Resolve even on error? Or reject?
                         // reject(error); // Option to reject
                    }
                );
            });
            loadPromises.push(loadPromise);
        } else {
             console.log(`Model already cached: ${modelPath}`);
        }
    }


    try {
        await Promise.all(loadPromises);
        assetsLoaded = true; // Set flag on success
        console.log("All assets loaded successfully (or errors handled).");
    } catch (error) {
        console.error("Error during asset loading:", error);
        assetsLoaded = false; // Ensure flag is false on critical failure
        // Rethrow or handle as needed
        throw error; // Optional: rethrow if caller needs to know about failure
    }
}

// --- NEW: Instanced Mesh Setup Function ---
function setupInstancedMeshes() {
    console.log("Setting up Instanced Meshes...");
    instancedMeshes = {}; // Clear existing refs
    instanceIdToDataMap.clear(); // Clear existing maps

    // --- Plants ---
    for (const typeId in plantConfigs) {
        if (typeId === 'default' && !plantConfigs.default.modelPath) continue;

        const config = plantConfigs[typeId];
        if (!config || !config.modelPath) {
            console.error(`Plant config or modelPath missing for typeId: ${typeId}`);
            continue;
        }
        const cachedData = gltfCache[config.modelPath];

        if (!cachedData || !cachedData.geometry || !cachedData.material) {
            console.error(`Cannot create InstancedMesh for plant ${typeId}: Missing cached GLTF data.`);
            continue;
        }

        // Clone the material to allow instance-specific modifications (like vertexColors)
        // without affecting other meshes that might share the original material.
        let instanceMaterial = cachedData.material;
         if (Array.isArray(instanceMaterial)) {
             console.warn(`Plant ${typeId} material is array, using first element cloned.`);
             instanceMaterial = instanceMaterial[0].clone();
         } else {
             instanceMaterial = instanceMaterial.clone();
         }

        // IMPORTANT: Enable vertex colors on the cloned material if we intend to use the color attribute for tinting
        if (instanceMaterial instanceof THREE.MeshStandardMaterial || instanceMaterial instanceof THREE.MeshBasicMaterial) {
             instanceMaterial.vertexColors = true;
             instanceMaterial.needsUpdate = true; // Required after changing properties
        }

        const mesh = new THREE.InstancedMesh(cachedData.geometry, instanceMaterial, MAX_INSTANCES_PER_TYPE);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.objectType = 'plant';
        mesh.userData.typeId = typeId;

        // Add Instanced Color Attribute (for tinting: healthy/thirsty)
        const colors = new Float32Array(MAX_INSTANCES_PER_TYPE * 3);
        const colorAttribute = new THREE.InstancedBufferAttribute(colors, 3);
        for (let i = 0; i < MAX_INSTANCES_PER_TYPE; i++) {
             healthyColor.toArray(colors, i * 3); // Initialize tint to healthy (white)
        }
        // Attach attribute ONLY to the geometry INSTANCE used by THIS mesh
        mesh.geometry.setAttribute('color', colorAttribute);
        mesh.instanceColor = colorAttribute; // Keep reference for updates

        mesh.count = 0;
        scene.add(mesh);
        instancedMeshes[typeId] = mesh;
        instanceIdToDataMap.set(mesh.uuid, new Map());
        console.log(`Created InstancedMesh for plant: ${typeId}`);
    }

    // --- Decor ---
    for (const typeId in decorConfigs) {
		const config = decorConfigs[typeId];
        // Check if config and its modelPath exist before using them
        if (!config || !config.modelPath) {
            console.error(`Decor config or modelPath missing for typeId: ${typeId}`);
            continue; // Skip this iteration if config or path is missing
        }
        const cachedData = gltfCache[config.modelPath];

		if (!cachedData || !cachedData.geometry || !cachedData.material) {
            console.error(`Cannot create InstancedMesh for decor ${typeId}: Missing cached GLTF data.`);
            continue;
        }

        // Decor usually doesn't need tinting, use the shared material directly (or clone if needed later)
        let instanceMaterial = cachedData.material; // Could be shared or cloned
        // Example: Clone if you plan unique changes per decor type instance later
        // instanceMaterial = cachedData.material.clone();

		const mesh = new THREE.InstancedMesh(cachedData.geometry, instanceMaterial, MAX_INSTANCES_PER_TYPE);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.userData.objectType = 'decor';
		mesh.userData.typeId = typeId;
		// No instanceColor needed for decor *yet*
		mesh.count = 0;
		scene.add(mesh);
		instancedMeshes[typeId] = mesh;
		instanceIdToDataMap.set(mesh.uuid, new Map());
		console.log(`Created InstancedMesh for decor: ${typeId}`);
    }
}

// --- Persistence Functions ---
// Debounce saveGardenState with a delay (e.g., 1.5 seconds)
const DEBOUNCED_SAVE_DELAY_MS = 1500;
const debouncedSaveGardenState = debounce(saveGardenState, DEBOUNCED_SAVE_DELAY_MS);

// Original save function
function saveGardenState() {
	try {
		if (typeof localStorage === 'undefined') {
			console.warn("localStorage not available, cannot save state.");
			return;
		}
		console.log(`Attempting save at ${new Date().toLocaleTimeString()} using Set iteration.`); // Log method

        // 1. Initialize the target structure (still a grid for loading compatibility)
		const serializableGrid: SerializableGardenGrid = Array(GRID_DIVISIONS).fill(null).map(() => Array(GRID_DIVISIONS).fill(null));

        // 2. Populate the grid from the 'allPlants' set
        for (const plantInfo of allPlants) {
            const { row, col } = plantInfo.gridPos;
            if (row >= 0 && row < GRID_DIVISIONS && col >= 0 && col < GRID_DIVISIONS) {
                 // Create the serializable version - explicitly exclude instanceId
                 // Spread operator copies all own enumerable properties
                 const { instanceId, ...serializableData } = plantInfo; // Destructure to exclude instanceId
                 serializableGrid[row][col] = { ...serializableData, type: 'plant' };
            } else {
                console.warn(`Plant with id ${plantInfo.plantTypeId} has invalid gridPos [${row}, ${col}] during save.`);
            }
        }

        // 3. Populate the grid from the 'allDecor' set
        for (const decorInfo of allDecor) {
            const { row, col } = decorInfo.gridPos;
             if (row >= 0 && row < GRID_DIVISIONS && col >= 0 && col < GRID_DIVISIONS) {
                // Create the serializable version - explicitly exclude instanceId
                 const { instanceId, ...serializableData } = decorInfo; // Destructure to exclude instanceId
                 serializableGrid[row][col] = { ...serializableData, type: 'decor' };
            } else {
                console.warn(`Decor with id ${decorInfo.decorTypeId} has invalid gridPos [${row}, ${col}] during save.`);
            }
        }

        // 4. Serialize and save the constructed grid
		localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializableGrid));
		console.log(`Garden state saved. Saved ${allPlants.size} plants and ${allDecor.size} decor items.`);

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

			// Reset tracking sets (important if loading without page refresh)
            allPlants.clear();
            allDecor.clear();
            updatablePlants.clear();

			// Reset instance counts and maps (assuming meshes exist from onMount)
            for(const typeId in instancedMeshes) {
                 instancedMeshes[typeId].count = 0;
                 instanceIdToDataMap.get(instancedMeshes[typeId].uuid)?.clear();
            }

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

						// Extract type and data (excluding 'type')
                        const { type, ...loadedData } = savedCell;

                        // Call the modified placeGridObjectAt, passing loadedData as initialState
                        placeGridObjectAt(
                            r, c,
                            type, // 'plant' or 'decor'
                            type === 'plant' ? (loadedData as SerializablePlantInfo).plantTypeId : (loadedData as SerializableDecorInfo).decorTypeId,
                            loadedData // Pass the rest of the data as initial state
                        );
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

// Add handleBeforeUnload (Moved outside onMount)
function handleBeforeUnload(event: BeforeUnloadEvent) {
	console.log('beforeunload triggered, saving state...');
	debouncedSaveGardenState.flush(); // Force immediate execution if pending
    // We might call the original function too as a final guarantee,
    // although flush() should handle it if a change was pending.
    // Let's rely on flush for now. If issues arise, we can add:
    // saveGardenState();
};

function renderFrame() {
	// Reset the single frame request flag at the beginning of the frame
	renderRequested = false;
	animationFrameId = undefined; // Clear the ID for this frame

	// --- Conditional Day/Night Update ---
    const now = new Date(); // Get current time once per frame
    const currentMinute = now.getMinutes();

    if (currentMinute !== lastDayNightUpdateMinute) {
        // console.log(`Updating Day/Night Cycle: Minute changed from ${lastDayNightUpdateMinute} to ${currentMinute}`);
        updateDayNightCycle(now); // Pass the 'now' Date object to avoid getting time again
        lastDayNightUpdateMinute = currentMinute; // Update the cache
    }
    // --- End Conditional Day/Night Update -

    let needsSave = false;
	const nowTimestamp = now.getTime();

	// --- List to track plants that become idle this frame ---
    const plantsToRemoveFromUpdateList: PlantInfo[] = [];

	// --- Iterate ONLY over plants potentially needing updates ---
    for (const plantInfo of updatablePlants) {
        let shouldBeRemoved = false;
        let needsVisualUpdate = false; // Track if *this* plant needs visuals updated

        // --- Check for Thirst ---
        const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
        if (plantInfo.state === 'healthy' && (nowTimestamp - plantInfo.lastWateredTime) > config.thirstThresholdSeconds * 1000) {
            // --- Became Thirsty ---
            plantInfo.state = 'needs_water';
            plantInfo.lastUpdateTime = nowTimestamp; // Update timestamp
            needsSave = true;
            console.log(`RenderFrame: Plant [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] became thirsty.`);
            // Update visuals IMMEDIATELY
            updatePlantVisuals(plantInfo);
            // Mark for removal from the *growth* update list because it stopped growing
            shouldBeRemoved = true;
        } else if (plantInfo.state === 'healthy') {
            // --- Growth Update ---
            // Only grow if healthy
            const growthHappened = updatePlantGrowth(plantInfo);
            if (growthHappened) {
                needsVisualUpdate = true;
            }

            // Check if growth finished *this frame*
            if (plantInfo.growthProgress >= 1.0) {
                console.log(`RenderFrame: Plant [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] finished growing.`);
                shouldBeRemoved = true; // Mark for removal, growth is complete
            }
        } else {
            // If it was already thirsty when entering the loop (shouldn't happen with new logic, but safe)
             plantInfo.lastUpdateTime = nowTimestamp; // Keep timestamp fresh
             shouldBeRemoved = true; // Ensure it's marked for removal if somehow still in the list
        }

        // --- Update Plant Visuals (if needed for growth) ---
        if (needsVisualUpdate && !shouldBeRemoved) { // Only update if still healthy/growing
             updatePlantVisuals(plantInfo);
        }

        // --- Mark for removal if needed ---
		if (shouldBeRemoved) {
			plantsToRemoveFromUpdateList.push(plantInfo);
			// console.log(`Plant [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] marked for removal from update list (became thirsty or finished growing).`);
        }
    } // --- End loop over updatablePlants ---

	// --- Remove plants that became idle/thirsty this frame ---
    if (plantsToRemoveFromUpdateList.length > 0) {
        for (const plantToRemove of plantsToRemoveFromUpdateList) {
            updatablePlants.delete(plantToRemove);
        }
        console.log(`Removed ${plantsToRemoveFromUpdateList.length} plants from update list. New size: ${updatablePlants.size}`);
    }

	// --- Save State (if needed) ---
    if (needsSave) {
        debouncedSaveGardenState(); // Use debounced version
    }

	// --- Render Scene ---
    // We always render if this function is called, either by the loop or requestRender
    renderer.render(scene, camera);

    // --- Adjust loop continuation logic ---
    // Loop continues if EITHER a pointer drag is active OR a tool interaction is marked (though tool interaction is very brief)
    // Let's simplify: loop continues if isInteracting is true.
    // isInteracting is set true by pointer down (drag start) and by tool click start.
    // It's set false by pointer up/cancel (drag end) and tool click end.
    const shouldContinueLoop = isInteracting; // Keep loop running as long as interaction flag is set

    if (shouldContinueLoop) {
        // Request the next frame for the continuous loop (during interaction)
        animationFrameId = requestAnimationFrame(renderFrame);
    } else if (isRenderLoopActive) {
        // Loop was active, but interaction stopped. Stop the loop.
        // Background interval will take over if non-interacting updates are needed.
        console.log("Interaction stopped. Stopping continuous render loop.");
        stopRenderLoop(); // This also cancels any potential pending animationFrameId and restarts background checks
    }
    // If !isRenderLoopActive, this was a single requested frame (e.g., from background check),
    // so we do nothing more. The background check *might* request another frame later if needed.
}

// --- Core Component Logic ---
let initComplete = false; // New flag to track if synchronous init is done
onMount(() => {
	if (!container) return;

	// --- Subscribe to Pointer Drag Stores ---
    const unsubHeldItem = heldItem.subscribe(value => { currentHeldItem = value; });
    const unsubIsDragging = isDraggingItem.subscribe(value => {
        isPointerDragging = value;
        if (isPointerDragging && !isInteracting && initComplete) {
            // Pointer drag started, ensure interaction state and loop are active
            console.log("Pointer drag detected, starting interaction loop.");
            isInteracting = true;
            startRenderLoop();
             // Hide tool selection when dragging starts
            selectedAction.set(null);
        }
        // Note: The 'stop' logic is handled within handlePointerUpOrCancel now.
    });
    // --- End Subscription ---

	scene = new THREE.Scene();
	scene.background = new THREE.Color(0xffffff);

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

	container.addEventListener('pointerdown', handleCanvasPointerDown);
	// --- Window-Level Pointer Listeners for Dragging ---
    window.addEventListener('pointermove', handlePointerMove, { passive: false }); // passive: false if preventDefault might be needed
    window.addEventListener('pointerup', handlePointerUpOrCancel);
    window.addEventListener('pointercancel', handlePointerUpOrCancel);
    // Optional: handle lostpointercapture similarly to pointercancel
    window.addEventListener('lostpointercapture', handlePointerUpOrCancel);
	// --- End Drag and Drop Setup ---

	const handleBeforeUnload = (event: BeforeUnloadEvent) => {
		console.log('beforeunload triggered, saving state...');
		saveGardenState(); // Ensure final save
	};
	// --- Other Listeners ---
	window.addEventListener('resize', resizeHandler); // Use debounced version
	if (typeof window !== 'undefined') {
		window.addEventListener('beforeunload', handleBeforeUnload);
	}

	// --- Call the async function to load assets and finish setup ---
    // We don't await it here, but chain the rest of the setup using .then()
    assetsLoadingPromise = loadAssets().then(() => {
        if (!assetsLoaded) {
             console.error("Asset loading failed. Garden initialization incomplete.");
             // Display error to user?
             return; // Stop further setup in this chain
        }

        console.log("Assets loaded, proceeding with post-load setup...");

        // --- Setup dependent on loaded assets ---
        setupInstancedMeshes();

        // --- Load saved state (which places objects using instanced meshes) ---
        const loaded = loadGardenState();
        if (!loaded) {
            initializeGrid();
        }

        // --- Final initializations ---
        initComplete = true; // Mark initialization as complete
        clock.start();
        performResize(); // Initial resize
        const initialTime = new Date();
        updateDayNightCycle(initialTime); // Set initial time visuals
        lastDayNightUpdateMinute = initialTime.getMinutes();

        // Start background intervals AFTER everything is ready
        if (backgroundCheckIntervalId === undefined) {
             backgroundCheckIntervalId = window.setInterval(performBackgroundCheck, BACKGROUND_UPDATE_INTERVAL_MS);
             console.log(`Started growth check interval initially (${BACKGROUND_UPDATE_INTERVAL_MS}ms)`);
        }
        if (idleDayNightCheckIntervalId === undefined) {
             idleDayNightCheckIntervalId = window.setInterval(performIdleBackgroundCheck, IDLE_DAYNIGHT_UPDATE_INTERVAL_MS);
             console.log(`Started idle day/night check interval initially (${IDLE_DAYNIGHT_UPDATE_INTERVAL_MS}ms)`);
        }

        // --- Initial Render ---
        requestRender(); // Request first frame
        console.log("Post-load setup complete.");

    }).catch(error => {
        console.error("Error in async setup chain:", error);
        // Handle error state in UI?
    });

	// --- Return the SYNCHRONOUS cleanup function ---
    // This function is returned immediately by onMount
	return () => {
		// The onDestroy Svelte function handles the main cleanup now
		// This returned function is mostly for things *only* added in onMount
		console.log("onMount cleanup function running");
		stopRenderLoop(); // Ensure loop is stopped here too
		// Remove listeners added *specifically* within onMount if any were left
		// (most are handled by onDestroy now)
		// Unsubscribe from stores
        unsubHeldItem();
        unsubIsDragging();

        // Remove listeners added in onMount
        window.removeEventListener('resize', resizeHandler);
        if (container) { // Check container exists before removing listeners
            container.removeEventListener('pointerdown', handleCanvasPointerDown);
        }
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUpOrCancel);
        window.removeEventListener('pointercancel', handlePointerUpOrCancel);
        window.removeEventListener('lostpointercapture', handlePointerUpOrCancel);
	};
});

// ... (Keep onDestroy as is, including material/geometry disposal and listener removal) ...
onDestroy(() => {
    // --- Ensure async loading/setup doesn't cause issues on destroy ---
    // (Optional: Add cancellation logic to loadAssets if possible/needed)
    initComplete = false; // Mark as not initialized
    assetsLoaded = false; // Reset flags

	stopRenderLoop(); // Explicitly stop the loop on destroy
	if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleBeforeUnload);
    }
    console.log('onDestroy triggered, flushing pending save...');
    debouncedSaveGardenState.flush(); // Force immediate execution

	// Clear intervals
    if (backgroundCheckIntervalId !== undefined) {
        clearInterval(backgroundCheckIntervalId);
        console.log("Stopped growth check interval.");
    }
     if (idleDayNightCheckIntervalId !== undefined) { // Clear idle check too
        clearInterval(idleDayNightCheckIntervalId);
        console.log("Stopped idle day/night check interval.");
    }

	if (animationFrameId !== undefined){
		cancelAnimationFrame(animationFrameId);
	}
	if(clock.running) clock.stop();

	if (renderer) {
		renderer.dispose();
		if (renderer.domElement.parentNode) {
			renderer.domElement.parentNode.removeChild(renderer.domElement);
		}
	}

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
	healthyMaterial.dispose(); // Dispose tinting materials
	thirstyMaterial.dispose();
	validPlacementMaterial?.dispose(); // Preview material
	invalidPlacementMaterial?.dispose(); // Preview material
	previewMeshes[0]?.geometry?.dispose(); // Preview geometry

	// *** Dispose Instanced Meshes and their UNIQUE Geometries/Materials ***
    console.log("Disposing Instanced Meshes and associated assets...");
    for (const typeId in instancedMeshes) {
        const mesh = instancedMeshes[typeId];
        if (mesh) {
            // Dispose the UNIQUE geometry CLONE used by this InstancedMesh
            // Check if it has the instance color attribute we added - means it's the unique clone
            if (mesh.geometry && mesh.geometry.getAttribute('color')) {
                 console.log(`Disposing unique geometry clone for InstancedMesh: ${typeId}`);
                 mesh.geometry.dispose();
            } else if (mesh.geometry) {
                 // If geometry doesn't have 'color', it might be shared (e.g., decor not cloned)
                 // or something went wrong. Only dispose if we know it's unique.
                 console.warn(`Geometry for InstancedMesh ${typeId} seems shared or missing attribute, not disposing.`);
            }

            // Dispose the UNIQUE material CLONE used by this InstancedMesh
             if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => {
                    if (m instanceof THREE.Material && m.vertexColors) { // Check if it's the cloned one
                        console.log(`Disposing unique material clone (array item) for InstancedMesh: ${typeId}`);
                        m.dispose();
                    }
                });
            } else if (mesh.material instanceof THREE.Material) {
                // Check if it's the cloned one (e.g., has vertexColors enabled by our setup)
                 if (mesh.material.vertexColors) {
                    console.log(`Disposing unique material clone for InstancedMesh: ${typeId}`);
                    mesh.material.dispose();
                 } else {
                     console.warn(`Material for InstancedMesh ${typeId} seems shared, not disposing.`);
                 }
            }
        }
    }
    // --- Dispose CACHED GLTF data (original scenes, geometries, materials) ---
    console.log("Disposing cached GLTF assets...");
    for (const modelPath in gltfCache) {
        const cacheEntry = gltfCache[modelPath];
        if (cacheEntry) {
            // Dispose extracted geometry/material IF they weren't cloned/managed above
            // It's safer to assume the InstancedMesh disposal handled the clones.
            // We might need to dispose the ORIGINAL geometry/material from the loaded scene IF they weren't used/cloned.
            // Let's focus on disposing things we know we created/cloned.
            // The base THREE.Scene (`cacheEntry.scene`) doesn't need explicit disposal,
            // but its children's geometries/materials might if not handled elsewhere.
            // Given our cloning strategy, the main cached geo/mat might not need disposal here.

            // Clear textures from original materials in the scene graph
            cacheEntry.scene.traverse(child => {
                 if (child instanceof THREE.Mesh && child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => {
                        Object.values(mat).forEach((value: any) => {
                             if (value instanceof THREE.Texture) {
                                // console.log(`Disposing texture found in cached GLTF scene: ${modelPath}`);
                                value.dispose();
                             }
                        });
                         // Dispose the material itself if it wasn't cloned and used by instancing
                         // This is tricky - maybe track original materials separately?
                         // For now, rely on instancing disposal for used materials.
                    });
                 }
                 // Dispose original geometry if it wasn't cloned and used
                 // if (child instanceof THREE.Mesh && child.geometry && ...) {
                 //    child.geometry.dispose();
                 // }
            });
        }
        delete gltfCache[modelPath]; // Remove entry from cache
    }
    console.log("Cleared GLTF Cache.");

	// --- Clear Internal State ---
    gardenGrid = []; // Clear grid array
    allPlants.clear();
    allDecor.clear();
    updatablePlants.clear();
    instancedMeshes = {}; // Clear mesh references
    instanceIdToDataMap.clear(); // Clear lookup map
    assetsLoaded = false; // Reset flag
    // Clear other state variables if necessary

	console.log("Garden cleanup complete.");
});
</script>

<div
    bind:this={container}
    style="width: 100%; height: 100%; touch-action: none;"
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
  cursor: default;
}
</style>