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
	let animationFrameId: number;
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

	const clock = new THREE.Clock(); // Add a clock for delta time

	const LOCAL_STORAGE_KEY = 'gardenSaveData'; // Key for localStorage

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

		const raycaster = new THREE.Raycaster();
		const mouse = new THREE.Vector2();
		const rect = container.getBoundingClientRect();
		mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
		raycaster.setFromCamera(mouse, camera);
		const intersects = raycaster.intersectObject(ground);

		if (intersects.length > 0) {
			const intersectPoint = intersects[0].point;
			const gridCoords = worldToGrid(intersectPoint.x, intersectPoint.z);

			if (gridCoords) {
                // We use the specific functions which internally resolve pointers now
				switch (currentAction.toolType) {
					case 'water':
						console.log(`Attempting to water Grid Cell: Row ${gridCoords.row}, Col ${gridCoords.col}`);
						waterPlantAt(gridCoords.row, gridCoords.col); // Will resolve pointer internally
						break;
					case 'remove':
						console.log(`Attempting to remove from Grid Cell: Row ${gridCoords.row}, Col ${gridCoords.col}`);
						removePlantAt(gridCoords.row, gridCoords.col); // Will resolve pointer internally
						break;
					default:
						console.log("Unknown tool selected:", currentAction.toolType);
					}
			} else {
				console.log("Clicked outside the grid area (tool action).");
			}
		} else {
			console.log("No intersection with the ground plane (tool action).");
		}
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

	// ... (Keep handleResize as is) ...
	const handleResize = () => {
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
	}
	// Keep your existing handleDragOver
	function handleDragOver(event: DragEvent) {
		event.preventDefault(); // Necessary to allow drop
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		// --- Preview Update Logic ---
		if (!draggingPlantType) return;
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
				if (!lastPreviewGridPos || lastPreviewGridPos.row !== gridCoords.row || lastPreviewGridPos.col !== gridCoords.col) {
					updatePreviewBox(gridCoords.row, gridCoords.col, draggingPlantType);
				}
			} else {
				hidePreviewBox();
			}
		} else {
			hidePreviewBox();
		}
		// --- End Preview Update Logic ---
	}

	// Keep your existing handleDrop, but add preview hiding
	function handleDrop(event: DragEvent) {
		event.preventDefault();
		hidePreviewBox();
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
					} else { console.log("Dropped outside grid."); }
				} else { console.log("No intersection on drop."); }
			} else { console.log("Invalid plantType drop data:", plantType); }
		}
		draggingPlantType = null;
	}

	// Add handleDragEnter (Moved outside onMount)
	function handleDragEnter(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer?.types.includes('planttype')) {
			const plantType = event.dataTransfer.getData('plantType');
			if (plantConfigs[plantType]) {
				draggingPlantType = plantType;
				console.log("Dragging plant:", draggingPlantType);
			} else { draggingPlantType = null; }
		} else { draggingPlantType = null; }
	}

	// Add handleDragLeave (Moved outside onMount)
	function handleDragLeave(event: DragEvent) {
		if (event.relatedTarget === null || (event.relatedTarget instanceof Node && !container.contains(event.relatedTarget))) {
			console.log("Drag left container");
			hidePreviewBox();
			draggingPlantType = null;
		}
	}

	// Add handleBeforeUnload (Moved outside onMount)
	function handleBeforeUnload(event: BeforeUnloadEvent) {
		console.log('beforeunload triggered, saving state...');
		saveGardenState();
	};

	onMount(() => {
		if (!container) return;

		scene = new THREE.Scene();
		scene.background = new THREE.Color(0xf4f1de);

		// Initialize or Load State BEFORE setting up camera/renderer etc.
		const loaded = loadGardenState();
		if (!loaded) {
			initializeGrid(); // Ensure grid is initialized if load fails/no data
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
		const shadowCamSize = 20; // How wide/tall the shadow area is (related to PLANE_SIZE)
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

		const animate = () => {
			animationFrameId = requestAnimationFrame(animate);
			const now = Date.now();
            let needsSave = false; // Flag to save only once per frame if needed

			// Live Update Loop (Iterate smartly)
			for (let r = 0; r < GRID_DIVISIONS; r++) {
				for (let c = 0; c < GRID_DIVISIONS; c++) {
                    // Only process actual PlantInfo objects, skip nulls and pointers
					const cell = gardenGrid[r]?.[c];
					if (cell && 'plantTypeId' in cell) { // Check if it's a PlantInfo
						const plantInfo = cell; // Already the main object
                        let stateChangedThisFrame = false;

						// Check for Thirst
						const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
						if (plantInfo.state === 'healthy' && (now - plantInfo.lastWateredTime) > config.thirstThresholdSeconds * 1000) {
							plantInfo.state = 'needs_water';
							// console.log(`Plant at [${r},${c}] needs water!`); // Can be verbose
							stateChangedThisFrame = true;
						}

						// Growth Update
						const growthHappened = updatePlantGrowth(plantInfo);

						// Update visuals if state changed OR growth happened
						if (stateChangedThisFrame || growthHappened) {
							updatePlantVisuals(plantInfo);
						}

                        // Flag for saving if state flipped to thirsty this frame
                        if (stateChangedThisFrame) {
                           needsSave = true;
                        }
					}
				}
			}

            // Save once after the loop if any plant became thirsty
            if (needsSave) {
                 saveGardenState();
            }

			renderer.render(scene, camera);
		};

		window.addEventListener('resize', handleResize);
		handleResize();
		clock.start();
		animate();

		saveIntervalId = window.setInterval(() => {
            // console.log("Periodic save triggered."); // Optional log for periodic save
            saveGardenState();
        }, SAVE_INTERVAL_MS);

		// --- Drag and Drop Setup (MODIFIED) ---

		// Keep your existing handleDragOver (we might split logic later)
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
			hidePreviewBox(); // Hide preview immediately on drop

			if (event.dataTransfer) {
				const plantType = event.dataTransfer.getData('plantType');
				if (plantType && plantConfigs[plantType]) {
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
							placeObjectAt(gridCoords.row, gridCoords.col, plantType);
						} else {
							console.log("Dropped outside the grid area.");
						}
					} else {
						console.log("No intersection with the ground plane on drop.");
					}
				} else {
					console.log("Invalid or missing plantType in drop data:", plantType);
				}
			}
			draggingPlantType = null; // Reset dragging state
		}

		// Add handleDragEnter
		function handleDragEnter(event: DragEvent) {
			event.preventDefault();
			// Check if the dragged item has the plantType data
			if (event.dataTransfer?.types.includes('planttype')) {
				const plantType = event.dataTransfer.getData('plantType');
				if (plantConfigs[plantType]) {
					draggingPlantType = plantType;
					console.log("Dragging plant:", draggingPlantType);
				} else {
					draggingPlantType = null; // Invalid plant type
				}
			} else {
				draggingPlantType = null; // Not dragging a plant
			}
		}

		// Add handleDragLeave
		function handleDragLeave(event: DragEvent) {
			// Important: Check if the mouse is *really* leaving the container,
			// not just moving over a child element (like the canvas itself if nested weirdly).
			// A simple check is often sufficient:
			if (event.relatedTarget === null || (event.relatedTarget instanceof Node && !container.contains(event.relatedTarget))) {
				console.log("Drag left container");
				hidePreviewBox();
				draggingPlantType = null; // Reset dragging state
			}
		}

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
		if (typeof window !== 'undefined') {
       		window.addEventListener('beforeunload', handleBeforeUnload);
    	}
	});

	// ... (Keep onDestroy as is, including material/geometry disposal and listener removal) ...
	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('beforeunload', handleBeforeUnload);
		}
		saveGardenState(); // Final save attempt

		if (saveIntervalId !== undefined) {
			clearInterval(saveIntervalId);
		}

		cancelAnimationFrame(animationFrameId);
		window.removeEventListener('resize', handleResize);
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