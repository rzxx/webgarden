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
type GridCell = PlantInfo | GridPointer | null;
// --- End Grid Cell Data ---

// --- Types ---
interface SerializablePlantInfo {
	plantTypeId: string;
	state: 'healthy' | 'needs_water';
	growthProgress: number;
	lastUpdateTime: number;
	lastWateredTime: number;
	size: { rows: number; cols: number };
	// We don't save gridPos directly, it's derived from the save structure
}
type SerializableGridCell = SerializablePlantInfo | null;
type SerializableGardenGrid = SerializableGridCell[][];
// --- End Types ---

/// --- Bounding Boxes ---
let draggingPlantType: string | null = null; // Stores the ID of the plant being dragged
let previewGroup: THREE.Group | null = null; // Group to hold preview plane meshes
let previewMeshes: THREE.Mesh[] = []; // Array to hold reusable preview plane meshes
const MAX_PREVIEW_CELLS = 16; // Max anticipated size (e.g., 4x4), adjust if needed

// Materials for the preview
let validPlacementMaterial: THREE.MeshBasicMaterial;
let invalidPlacementMaterial: THREE.MeshBasicMaterial;

// To optimize updates, track the last grid cell the preview was drawn at
let lastPreviewGridPos: { row: number; col: number } | null = null;
/// --- End Bounding Boxes ---

let container: HTMLDivElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let ground: THREE.Mesh;
let saveIntervalId: number | undefined = undefined;
const SAVE_INTERVAL_MS = 15000;

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

// Configuration for background updates (can be adjusted or made dynamic later)
const BACKGROUND_UPDATE_INTERVAL_MS = 500; // Check for growth/dynamics every 500ms (2fps) - adjust as needed
// Interval ID for the background check
let backgroundCheckIntervalId: number | undefined = undefined;


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

// --- Placeholder Object Geometry/Materials ---
const placeholderGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.5, CELL_SIZE * 0.5, CELL_SIZE * 0.5);
const healthyMaterial = new THREE.MeshStandardMaterial({ color: 0xf2cc8f });
const thirstyMaterial = new THREE.MeshStandardMaterial({ color: 0xdad7cd });
// --- End Placeholder Materials ---

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

// --- Helper to get PlantInfo, resolving pointers ---
function getPlantInfoAt(row: number, col: number): PlantInfo | null {
	if (row < 0 || row >= GRID_DIVISIONS || col < 0 || col >= GRID_DIVISIONS) return null; // Out of bounds

	const cell = gardenGrid[row][col];
	if (!cell) {
		return null; // Empty cell
	} else if ('pointerTo' in cell) {
		// It's a pointer, follow it
		const target = cell.pointerTo;
		const targetCell = gardenGrid[target.row]?.[target.col];
		if (targetCell && 'plantTypeId' in targetCell) {
			return targetCell; // Return the PlantInfo from the target cell
		} else {
				console.error(`Pointer at [${row}, ${col}] points to invalid or empty cell [${target.row}, ${target.col}]`);
				// Optionally clean up the bad pointer here: gardenGrid[row][col] = null;
			return null; // Pointer leads nowhere valid
		}
	} else {
		// It's the main PlantInfo object
		return cell;
	}
}
// --- End Helper ---

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

		// Clear the background check interval
		if (backgroundCheckIntervalId !== undefined) {
            clearInterval(backgroundCheckIntervalId);
            backgroundCheckIntervalId = undefined; // Clear the ID
            console.log("Paused background check interval (rAF loop active).");
        }

		// Start the rAF loop
		animationFrameId = requestAnimationFrame(renderFrame);
	}
}

/**
 * Periodically checks if background processes (like growth) require a render frame.
 */
 function performBackgroundCheck() {
    // We only need to potentially trigger a render if:
    // 1. The main interaction loop ISN'T already running
    // 2. There IS active growth (or other future dynamic states) occurring
    // Note: activeGrowthOccurring is updated within renderFrame whenever it runs.
    // So, this check uses the value from the *last time* renderFrame executed.

    if (!isRenderLoopActive && activeGrowthOccurring) {
        // console.log("Background check: Growth detected, requesting render.");
        requestRender(); // Request a single frame to update growth visuals
    } else {
        // console.log(`Background check: No render needed (loopActive: ${isRenderLoopActive}, growth: ${activeGrowthOccurring})`);
    }
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

		// Restart the background check interval
        // Ensure it's not somehow already running and start it
        if (backgroundCheckIntervalId === undefined) {
            backgroundCheckIntervalId = window.setInterval(performBackgroundCheck, BACKGROUND_UPDATE_INTERVAL_MS);
            console.log(`Resumed background check interval (${BACKGROUND_UPDATE_INTERVAL_MS}ms).`);
        }
	}
	// If the loop wasn't active, make sure the background check is running
    // This handles cases where stopRenderLoop might be called defensively
    // even if the loop wasn't technically active (e.g., after interaction ends).
    else if (backgroundCheckIntervalId === undefined) {
         console.log("Ensuring background check interval is running (loop was not active).");
         backgroundCheckIntervalId = window.setInterval(performBackgroundCheck, BACKGROUND_UPDATE_INTERVAL_MS);
    }
}

/**
 * Updates the position, size, and color of the preview box.
 */
function updatePreviewBox(row: number, col: number, plantType: string) {
	if (!previewGroup || !plantConfigs[plantType]) {
		hidePreviewBox(); // Hide if something is wrong
		return;
	}

	const config = plantConfigs[plantType];
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
				console.warn("Need more meshes in preview pool for plant size!");
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
// --- End Function to Update Plant Growth ---

// --- Function to Remove Plant (Handles Multi-Cell) ---
function removePlantAt(row: number, col: number) {
	// 1. Find the actual PlantInfo, resolving pointers
	const plantInfo = getPlantInfoAt(row, col);

	if (plantInfo?.mesh) {
		console.log(`Removing plant ${plantInfo.plantTypeId} originating at [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] (triggered from [${row}, ${col}])`);

		// 2. Get size and original position from the resolved PlantInfo
		const { size, gridPos } = plantInfo;

		// 3. Remove Mesh from Scene and Dispose Geometry
		scene.remove(plantInfo.mesh);
		plantInfo.mesh.geometry.dispose();
		// (Materials are shared, don't dispose them here)
		plantInfo.mesh = undefined; // Clear mesh reference

		// 4. Clear Grid Data for all occupied cells
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
		console.log(`No plant found at or pointed to by [${row}, ${col}] to remove.`);
	}
}
// --- End Function to Remove Plant ---

// --- Function to Place Object (Handles Multi-Cell) ---
function placeObjectAt(row: number, col: number, plantTypeId: string) {
	const config = plantConfigs[plantTypeId] ?? plantConfigs.default;
	const plantSize = config.size;

	// 1. Check if the entire area is free
	if (!isAreaFree(row, col, plantSize.rows, plantSize.cols)) {
		console.log(`Cannot place ${plantTypeId} of size ${plantSize.rows}x${plantSize.cols} at [${row}, ${col}], area not free.`);
		return;
	}

	// 2. Create Mesh and PlantInfo
	const placeholderMesh = new THREE.Mesh(placeholderGeometry, healthyMaterial); // Start with healthy
	placeholderMesh.castShadow = true; // This plant mesh will cast shadows
	placeholderMesh.receiveShadow = true; // Receives shadows from other objects
	placeholderMesh.userData = { gridPos: { row, col } }; // Store reference to top-left
	const worldPos = gridAreaCenterToWorld(row, col, plantSize.rows, plantSize.cols); // Center of the whole area
	const now = Date.now();

	const newPlant: PlantInfo = {
		plantTypeId: plantTypeId,
		state: 'healthy',
		growthProgress: 0.0,
		lastUpdateTime: now,
		lastWateredTime: now,
		size: { ...plantSize }, // Copy size object
		gridPos: { row, col }, // Store top-left grid position
		mesh: placeholderMesh
	};

	// 3. Set Initial Visual State (Scale, Y-Position, Material)
	updatePlantVisuals(newPlant); // Sets scale, Y pos, material

	// 4. Set Mesh Position (XZ from area center, Y from visuals)
	placeholderMesh.position.x = worldPos.x;
	placeholderMesh.position.z = worldPos.z;
	// Y position is already set correctly by updatePlantVisuals
	scene.add(placeholderMesh);

	// 5. Update Grid Data
	// Place main PlantInfo at top-left
	gardenGrid[row][col] = newPlant;
	console.log(`Placed main info for ${plantTypeId} at [${row}, ${col}].`);

	// Place pointers in other cells
	for (let rOffset = 0; rOffset < plantSize.rows; rOffset++) {
		for (let cOffset = 0; cOffset < plantSize.cols; cOffset++) {
			// Skip the top-left cell where the main info is
			if (rOffset === 0 && cOffset === 0) continue;

			const targetRow = row + rOffset;
			const targetCol = col + cOffset;
			// Bounds check should be implicitly handled by isAreaFree, but double-check is safe
			if (targetRow < GRID_DIVISIONS && targetCol < GRID_DIVISIONS) {
				gardenGrid[targetRow][targetCol] = { pointerTo: { row, col } };
				// console.log(`Placed pointer at [${targetRow}, ${targetCol}] pointing to [${row}, ${col}].`);
			}
		}
	}

	// 6. Save state
	saveGardenState();
}
// --- End Function to Place Object ---

// --- Function to Water Plant (Uses Pointer Resolution) ---
function waterPlantAt(row: number, col: number) {
	// 1. Find the actual PlantInfo, resolving pointers
	const plantInfo = getPlantInfoAt(row, col);

	if (plantInfo) {
		console.log(`Watering plant ${plantInfo.plantTypeId} at [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] (triggered from [${row}, ${col}])`);
		let stateChanged = false;
		let timeUpdated = false;
		const now = Date.now();

		if (plantInfo.state === 'needs_water') {
			plantInfo.state = 'healthy';
			plantInfo.lastUpdateTime = now;
			plantInfo.lastWateredTime = now;
			console.log(`   Plant is now healthy.`);
			updatePlantVisuals(plantInfo); // Update visuals
			stateChanged = true;
			timeUpdated = true;
		} else {
			plantInfo.lastWateredTime = now; // Still reset thirst timer
			console.log(`   Plant was already healthy, reset thirst timer.`);
			timeUpdated = true;
			// Optional: Add feedback even if already healthy
		}

		if (stateChanged || timeUpdated) {
			saveGardenState();
		}
	} else {
		console.log(`No plant found at or pointed to by [${row}, ${col}] to water.`);
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

	let plantInteractedWith = false; // Flag to see if we hit a plant

	if (intersects.length > 0) {
		// Loop through intersected objects (sorted by distance)
		for (const intersect of intersects) {
			const intersectedObject = intersect.object;

			// Check if the intersected object is a Mesh and has our specific userData
			if (intersectedObject instanceof THREE.Mesh && intersectedObject.userData.gridPos) {
				const hitGridPos = intersectedObject.userData.gridPos as { row: number; col: number };

				switch (currentAction.toolType) {
					case 'water':
						console.log(`Attempting to water Plant at [${hitGridPos.row}, ${hitGridPos.col}]`);
						waterPlantAt(hitGridPos.row, hitGridPos.col); // Use the gridPos from userData
						plantInteractedWith = true;
						break;
					case 'remove':
						console.log(`Attempting to remove Plant at [${hitGridPos.row}, ${hitGridPos.col}]`);
						removePlantAt(hitGridPos.row, hitGridPos.col); // Use the gridPos from userData
						plantInteractedWith = true;
						break;
					default:
						console.log("Unknown tool selected on plant click:", currentAction.toolType);
				}

				// Once we've interacted with the first plant mesh hit, stop checking
				if (plantInteractedWith) {
					break;
				}
			}
			// Optional: Add checks here if you want to interact with other object types (like the ground)
			// else if (intersectedObject === ground) {
			//     console.log("Raycast hit ground.");
			// }
		} // End loop through intersects

	} // End if intersects.length > 0
	if (!plantInteractedWith) {
		// console.log("Clicked on empty space or non-plant object.");
		// You could potentially add logic here for other actions if clicking empty ground
		// was desired for certain tools, but for water/remove, we only care about hitting plants.
	}

	// Interaction ends immediately after the click for tools
	isInteracting = false;
	// If the loop was active due to growth, let renderFrame decide to stop it.
	// If loop wasn't active, the action already requested a frame if needed.
}

// --- Persistence Functions ---

function saveGardenState() {
	try {
		if (typeof localStorage === 'undefined') {
			console.warn("localStorage not available, cannot save state.");
			return;
		}
		// Create a serializable grid containing ONLY the main PlantInfo objects
		const serializableGrid: SerializableGardenGrid = Array(GRID_DIVISIONS).fill(null).map(() => Array(GRID_DIVISIONS).fill(null));

		for (let r = 0; r < GRID_DIVISIONS; r++) {
			for (let c = 0; c < GRID_DIVISIONS; c++) {
				const cell = gardenGrid[r][c];
				// Only save if it's the main PlantInfo (not null, not a pointer)
				if (cell && 'plantTypeId' in cell) {
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					const { mesh, gridPos, ...rest } = cell; // Exclude mesh and gridPos
					serializableGrid[r][c] = rest;
				}
				// Pointers and nulls are implicitly saved as null
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
			const loadedGrid: SerializableGardenGrid = JSON.parse(savedData);
			console.log("Loading saved garden state...");

			// Initialize gardenGrid first (important!)
			initializeGrid(); // Use the function to ensure clean grid

			for (let r = 0; r < GRID_DIVISIONS; r++) {
				for (let c = 0; c < GRID_DIVISIONS; c++) {
					const savedCell = loadedGrid[r]?.[c];
					// Only process if a saved plant exists at this top-left position
					if (savedCell) {
						// Check if this spot is already occupied (e.g., by a pointer from a previously loaded plant)
						// This shouldn't happen with correct saving, but good safety check.
						if (gardenGrid[r][c] !== null) {
							console.warn(`Load conflict: Cell [${r}, ${c}] should be empty but is not. Skipping load for saved data at this position.`);
							continue;
						}

						// 1. Recreate Mesh
						const loadedMesh = new THREE.Mesh(placeholderGeometry, healthyMaterial); // Start healthy
						loadedMesh.castShadow = true; // Loaded plants should also cast shadows
						loadedMesh.receiveShadow = true; // Receives shadows from other objects
						loadedMesh.userData = { gridPos: { row: r, col: c } }; // Store reference to top-left
						const plantSize = savedCell.size; // Get size from saved data
						const worldPos = gridAreaCenterToWorld(r, c, plantSize.rows, plantSize.cols); // Center of multi-cell area

						// 2. Create the full PlantInfo object
						const loadedPlant: PlantInfo = {
							...savedCell, // Spread loaded data (type, state, progress, times, size)
							mesh: loadedMesh,
							gridPos: { row: r, col: c } // Reconstruct gridPos
						};

						// 3. Calculate Offline Growth & Check Thirst BEFORE setting visuals
						updatePlantGrowth(loadedPlant);
						const now = Date.now();
						const config = plantConfigs[loadedPlant.plantTypeId] ?? plantConfigs.default;
						if (loadedPlant.state === 'healthy' && (now - loadedPlant.lastWateredTime) > config.thirstThresholdSeconds * 1000) {
							loadedPlant.state = 'needs_water';
						}

						// 4. Set Visuals (Scale, Y-Pos, Material)
						updatePlantVisuals(loadedPlant);

						// 5. Set Mesh Position (XZ from area center, Y from visuals)
						loadedMesh.position.x = worldPos.x;
						loadedMesh.position.z = worldPos.z;
						// Y position already set by updatePlantVisuals
						scene.add(loadedMesh);

						// 6. Update Grid: Place main PlantInfo AND Pointers
						gardenGrid[r][c] = loadedPlant; // Place main info

						for (let rOffset = 0; rOffset < plantSize.rows; rOffset++) {
							for (let cOffset = 0; cOffset < plantSize.cols; cOffset++) {
								if (rOffset === 0 && cOffset === 0) continue; // Skip top-left

								const targetRow = r + rOffset;
								const targetCol = c + cOffset;
								if (targetRow < GRID_DIVISIONS && targetCol < GRID_DIVISIONS) {
									// Check if pointer spot is unexpectedly occupied
									if (gardenGrid[targetRow][targetCol] !== null) {
											console.warn(`Load conflict: Pointer location [${targetRow}, ${targetCol}] for plant at [${r}, ${c}] is already occupied. Overwriting.`);
									}
									gardenGrid[targetRow][targetCol] = { pointerTo: { row: r, col: c } };
								} else {
									console.warn(`Load warning: Plant at [${r}, ${c}] extends out of bounds at [${targetRow}, ${targetCol}]. Pointer not placed.`);
								}
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
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = 'copy';
	}

	// --- Preview Update Logic ---
	if (!draggingPlantType) return; // Only update if dragging a known plant

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
				updatePreviewBox(gridCoords.row, gridCoords.col, draggingPlantType);
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
	const wasInteracting = isInteracting; // Store state before clearing

	// 1. Stop interaction state and loop FIRST
	hidePreviewBox(); // Hide preview (scene state change)
	draggingPlantType = null;
	isInteracting = false; // STOP Interaction state

	// Explicitly stop the loop *before* potential placement/saving
	if (wasInteracting) {
		stopRenderLoop(); // Ensure loop stops now
	}

	let placementOccurred = false;
	if (event.dataTransfer) {
		const plantType = event.dataTransfer.getData('plantType');
		if (plantType && plantConfigs[plantType]) {
			const rect = container.getBoundingClientRect();
			const mouseX = event.clientX - rect.left;
			const mouseY = event.clientY - rect.top;
			const mouse = new THREE.Vector2((mouseX / rect.width) * 2 - 1,-(mouseY / rect.height) * 2 + 1);
			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera(mouse, camera);
			const intersects = raycaster.intersectObject(ground);
			if (intersects.length > 0) {
				const intersectPoint = intersects[0].point;
				const gridCoords = worldToGrid(intersectPoint.x, intersectPoint.z);
				if (gridCoords) {
					placeObjectAt(gridCoords.row, gridCoords.col, plantType);
					placementOccurred = true;
				} else { console.log("Dropped outside grid."); }
			} else { console.log("No intersection on drop."); }
		} else { console.log("Invalid plantType drop data:", plantType); }
	}
	// Stop the loop if we were interacting (dragging)
	if (wasInteracting) {
		stopRenderLoop(); // STOP loop explicitly after drag ends
	}

	// If placement didn't happen (which calls requestRender),
	// but we stopped interacting/hid preview, request a render to be sure.
	if (!placementOccurred) {
		requestRender();
	}
}

// Add handleDragEnter
function handleDragEnter(event: DragEvent) {
	event.preventDefault();
	if (event.dataTransfer?.types.includes('planttype')) {
		const plantType = event.dataTransfer.getData('plantType');
		if (plantConfigs[plantType]) {
			draggingPlantType = plantType;
			isInteracting = true; // START Interaction
			startRenderLoop();   // START Loop for preview updates
			console.log("Dragging plant:", draggingPlantType);
		} else { draggingPlantType = null; }
	} else { draggingPlantType = null; }
}

// Add handleDragLeave
function handleDragLeave(event: DragEvent) {
	if (event.relatedTarget === null || (event.relatedTarget instanceof Node && !container.contains(event.relatedTarget))) {
		console.log("Drag left container");
		hidePreviewBox();
		draggingPlantType = null;
		isInteracting = false; // STOP Interaction
		stopRenderLoop();    // STOP Loop (unless growth needs it, renderFrame decides)
		// No render needed here usually, as nothing changed *on* the garden
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
					needsSave = true; // Became thirsty, save state
					visualChangeOccurred = true; // Thirst changes appearance
				}

				// --- Growth Update ---
				const growthHappened = updatePlantGrowth(plantInfo);
				if (growthHappened) {
					visualChangeOccurred = true; // Growth changes appearance
				}

				// Track if *any* healthy plant is still growing
				if (plantInfo.state === 'healthy' && plantInfo.growthProgress < 1.0) {
					activeGrowthOccurring = true;
				}

				// --- Update Visuals ---
				// Only update Three.js visuals if state changed or growth happened
				if (stateChangedThisFrame || growthHappened) {
					updatePlantVisuals(plantInfo);
					// No need to set visualChangeOccurred again, already covered
				}
			}
		}
	}

	// --- Save State ---
	if (needsSave) {
		saveGardenState();
	}

	// --- Render Scene ---
	// We always render if this function is called, either by the loop or requestRender
	// console.log("Rendering frame"); // Can be noisy, use for debugging
	renderer.render(scene, camera);

	// --- Decide whether to continue the loop ---
	// Continue if:
	// 1. The loop is *supposed* to be active (isRenderLoopActive is true)
	// AND
	// 2. EITHER the user is interacting OR there's active growth animation needed.
	const shouldContinueLoop = isRenderLoopActive && (isInteracting || activeGrowthOccurring);

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
	scene.background = new THREE.Color(0xf4f1de);

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

	const ambientLight = new THREE.AmbientLight(0xffffff, 1);
	scene.add(ambientLight);
	const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
	directionalLight.position.set(-10, 15, 10);
	directionalLight.castShadow = true; // Enable shadow casting for this light
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
	const shadowHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
	scene.add(shadowHelper); // Add temporarily to see the shadow box

	const groundGeometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
	const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x81b29a, side: THREE.DoubleSide });
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

	// Perform initial resize and render
	performResize(); // Calls requestRender
	clock.start();

	// Start periodic save timer
	saveIntervalId = window.setInterval(() => saveGardenState(), SAVE_INTERVAL_MS);

	// Always start the background check interval on mount now,
	// because the rAF loop does not start automatically anymore based on growth.
	// The background check will handle triggering renders if growth is occurring.
	if (backgroundCheckIntervalId === undefined) {
		backgroundCheckIntervalId = window.setInterval(performBackgroundCheck, BACKGROUND_UPDATE_INTERVAL_MS);
		console.log(`Started background check interval initially (${BACKGROUND_UPDATE_INTERVAL_MS}ms)`);
	} else {
		// This path shouldn't normally be hit if logic is correct
		console.warn("Background check interval ID was already set in onMount?");
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
	// Now, the background check interval, when it first fires, will see
	// the correct initial 'activeGrowthOccurring' state and request a render if needed.

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

	// Clear periodic save timer
	if (saveIntervalId !== undefined) {
		clearInterval(saveIntervalId);
	}

	if (animationFrameId !== undefined){
		cancelAnimationFrame(animationFrameId);
	}

	// Clear the background check interval
    if (backgroundCheckIntervalId !== undefined) {
        clearInterval(backgroundCheckIntervalId);
        console.log("Stopped background check interval.");
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

	// Clear meshes that might linger if traversal missed them somehow
	// (Mesh references should be cleared in removePlantAt and loadGardenState errors)
	// for (let r = 0; r < GRID_DIVISIONS; r++) {
	// 	for (let c = 0; c < GRID_DIVISIONS; c++) {
	// 		const cell = gardenGrid[r]?.[c];
	//         if (cell && 'mesh' in cell && cell.mesh) {
	//             scene.remove(cell.mesh); // Ensure removal if not already gone
	//         }
	// 	}
	// }

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