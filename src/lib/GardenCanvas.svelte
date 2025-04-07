<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as THREE from 'three';
	import { selectedAction, type SelectedAction } from './stores';
	import { get } from 'svelte/store';
	//import { GLTFLoader } from 'three-stdlib'; // Import GLTFLoader

	// --- Plant Configuration ---
	interface PlantConfig {
		growthRatePerSecond: number; // How much progress (0-1) per second
		initialScale: number;
		maxScale: number;
		thirstThresholdSeconds: number; // New property
		// Add other type-specific things later (e.g., model path)
	}

	const plantConfigs: Record<string, PlantConfig> = {
		fern: { growthRatePerSecond: 1 / (60 * 1), initialScale: 0.3, maxScale: 1.0, thirstThresholdSeconds: 60 * 1 }, // 1 minute
		cactus: { growthRatePerSecond: 1 / (60 * 5), initialScale: 0.2, maxScale: 0.8, thirstThresholdSeconds: 60 * 10 }, // 10 minutes
		default: { growthRatePerSecond: 1 / (60 * 2), initialScale: 0.4, maxScale: 1.0, thirstThresholdSeconds: 60 * 5 }  // 5 minutes
	};
	// --- End Plant Configuration ---

	// --- Grid Cell Data Type ---
	interface PlantInfo {
		plantTypeId: string; // 'fern', 'cactus', etc.
		state: 'healthy' | 'needs_water'; // Keep state for watering interaction
		growthProgress: number; // 0.0 to 1.0
		lastUpdateTime: number; // Timestamp
		lastWateredTime: number; // Timestamp for thirst check
		mesh?: THREE.Mesh;
	}

	type GridCell = PlantInfo | null;
	// --- End Grid Cell Data ---

	// --- Types ---
	// Add a serializable version of PlantInfo (without the mesh)
	interface SerializablePlantInfo {
		plantTypeId: string;
		state: 'healthy' | 'needs_water';
		growthProgress: number;
		lastUpdateTime: number;
		lastWateredTime: number;
	}
	type SerializableGridCell = SerializablePlantInfo | null;
	type SerializableGardenGrid = SerializableGridCell[][];
	// --- End Types ---

	let container: HTMLDivElement;
	let renderer: THREE.WebGLRenderer;
	let animationFrameId: number;
	let scene: THREE.Scene;
	let camera: THREE.OrthographicCamera;
	let ground: THREE.Mesh;
	let saveIntervalId: number | undefined = undefined; // Timer ID for periodic saving
	const SAVE_INTERVAL_MS = 15000; // Save every 15 seconds (adjust as needed)

	// --- Grid Data ---
	let gardenGrid: GridCell[][] = [];
	// --- End Grid Data ---

	// ... Grid System Parameters ...
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
	 * representing the center of the cell on the XZ plane (Y=0).
	 */
	function gridToWorld(row: number, col: number): THREE.Vector3 {
		// Calculate the top-left corner of the cell in world coordinates
		const worldX = col * CELL_SIZE - HALF_PLANE_SIZE;
		const worldZ = row * CELL_SIZE - HALF_PLANE_SIZE;

		// Calculate the center of the cell
		const centerX = worldX + CELL_SIZE / 2;
		const centerZ = worldZ + CELL_SIZE / 2;

		return new THREE.Vector3(centerX, 0, centerZ); // Y is 0 for the ground plane
	}

	// --- End Coordinate Mapping Functions ---

	function initializeGrid() {
		gardenGrid = []; // Clear existing grid data
		for (let r = 0; r < GRID_DIVISIONS; r++) {
			gardenGrid[r] = []; // Initialize row
			for (let c = 0; c < GRID_DIVISIONS; c++) {
				gardenGrid[r][c] = null; // Initialize cell as empty
			}
		}
		console.log("Initialized Grid:", gardenGrid); // For debugging
	}

	// --- Placeholder Object Geometry/Materials ---
	const placeholderGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.5, CELL_SIZE * 0.5, CELL_SIZE * 0.5);
	const healthyMaterial = new THREE.MeshStandardMaterial({ color: 0xf2cc8f });
	const thirstyMaterial = new THREE.MeshStandardMaterial({ color: 0xdad7cd });
	// --- End Placeholder Materials ---

	// --- Function to Update Plant Visuals ---
	function updatePlantVisuals(plantInfo: PlantInfo) {
		if (!plantInfo.mesh) return;

		const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
		// Linear interpolation for scale based on progress
		const currentScale = config.initialScale + (config.maxScale - config.initialScale) * plantInfo.growthProgress;

		plantInfo.mesh.scale.set(currentScale, currentScale, currentScale);
		// Adjust y position so base stays on the ground
		// Assuming placeholderGeometry is a cube centered at origin
		const currentHeight = (CELL_SIZE * 0.5) * currentScale;
		plantInfo.mesh.position.y = currentHeight / 2;

		// --- Update Material based on State ---
		if (plantInfo.state === 'needs_water') {
			plantInfo.mesh.material = thirstyMaterial;
		} else {
			plantInfo.mesh.material = healthyMaterial;
		}
		// --- End Update Material ---
	}
	// --- End Function to Update Plant Visuals ---

	// --- Function to Update Plant Growth (Handles Offline Time) ---
	function updatePlantGrowth(plantInfo: PlantInfo): boolean {
		const now = Date.now();
		const elapsedSeconds = (now - plantInfo.lastUpdateTime) / 1000;
		let needsVisualUpdate = false;

		if (elapsedSeconds <= 0) {
			return false; // No time passed or clock went back
		}

		// Only grow if healthy (add other conditions later if needed)
		if (plantInfo.state === 'healthy' && plantInfo.growthProgress < 1.0) {
			const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
			const potentialGrowth = elapsedSeconds * config.growthRatePerSecond;
			const newProgress = Math.min(1.0, plantInfo.growthProgress + potentialGrowth);

			if (newProgress > plantInfo.growthProgress) {
				plantInfo.growthProgress = newProgress;
				needsVisualUpdate = true;
				//console.log(`Plant ${plantInfo.plantTypeId} progress: ${plantInfo.growthProgress.toFixed(3)}`);
			}
		}

		// Always update the time, even if no growth occurred (to prevent huge jumps later)
		plantInfo.lastUpdateTime = now;
		return needsVisualUpdate;
	}
	// --- End Function to Update Plant Growth ---

	// --- Function to Remove Plant ---
	function removePlantAt(row: number, col: number) {
		const cell = gardenGrid[row]?.[col];
		if (cell?.mesh) { // Check if there's a plant and it has a mesh
			console.log(`Removing plant ${cell.plantTypeId} at [${row}, ${col}]`);

			// 1. Remove from Scene
			scene.remove(cell.mesh);

			// 2. Dispose Geometry (important for memory management)
			//    We don't dispose the shared materials here.
			cell.mesh.geometry.dispose();

			// 3. Update Grid Data
			gardenGrid[row][col] = null;

			// 4. Save State
			saveGardenState();

		} else {
			console.log(`No plant to remove at [${row}, ${col}].`);
		}
	}
	// --- End Function to Remove Plant ---

	// --- Function to Place Object (Initialize lastWateredTime) ---
	function placeObjectAt(row: number, col: number, plantTypeId: string) {
		if (gardenGrid[row]?.[col] !== null) {
			console.log(`Cell [${row}, ${col}] is already occupied.`);
			return;
		}

		const placeholderMesh = new THREE.Mesh(placeholderGeometry, healthyMaterial);
		const worldPos = gridToWorld(row, col);
		const now = Date.now(); // Get time once

		// Create the PlantInfo object
		const newPlant: PlantInfo = {
			plantTypeId: plantTypeId,
			state: 'healthy',
			growthProgress: 0.0,
			lastUpdateTime: now, // Initialize both times
			lastWateredTime: now, // Initialize last watered time
			mesh: placeholderMesh
		};

		// Set initial visual state
		updatePlantVisuals(newPlant); // Sets initial scale, position, and material

		// Add mesh to scene AFTER setting position/scale
		placeholderMesh.position.copy(worldPos); // Set XZ position
		placeholderMesh.position.y = newPlant.mesh!.position.y; // Use Y calculated by updatePlantVisuals
		scene.add(placeholderMesh);

		// Update grid data
		gardenGrid[row][col] = newPlant;
		console.log(`Placed ${plantTypeId} at [${row}, ${col}].`);

		// --- Save state after placing ---
		saveGardenState();
		// --- End Save state ---
	}
	// --- End Function to Place Object ---

	// --- Function to Water Plant (Update lastWateredTime) ---
	function waterPlantAt(row: number, col: number) {
			const cell = gardenGrid[row]?.[col];
			if (cell) {
				console.log(`Watering plant ${cell.plantTypeId} at [${row}, ${col}]`);
				let stateChanged = false;
				let timeUpdated = false; // <-- Track if time was updated

				const now = Date.now(); // Get time once

				if (cell.state === 'needs_water') {
					cell.state = 'healthy';
					cell.lastUpdateTime = now; // Reset growth timer base when state changes
					cell.lastWateredTime = now; // Update last watered time
					console.log(`   Plant is now healthy.`);
					updatePlantVisuals(cell); // Update visuals immediately
					stateChanged = true;
					timeUpdated = true; // Time updated because state changed
				} else {
					// Even if healthy, update lastWateredTime to reset the thirst timer
					cell.lastWateredTime = now;
					console.log(`   Plant was already healthy, reset thirst timer.`);
					timeUpdated = true; // Time was updated
					// Optional: Maybe provide visual feedback even if already healthy? (e.g., particle effect)
				}

				// --- Save state if state changed OR if the water timer was reset ---
				if (stateChanged || timeUpdated) { // <-- MODIFIED Condition
					saveGardenState(); // Save immediately
				}
				// --- End Save state ---
			} else {
				console.log(`No plant to water at [${row}, ${col}].`);
			}
	}
	// --- End Function to Water Plant ---
	function handleCanvasPointerDown(event: PointerEvent) {
		// Get the current action from the store
		const currentAction = get(selectedAction); // Use get() for one-time read

		// Only proceed if a tool action is selected
		if (currentAction?.type !== 'tool') {
			// If it's null, a plant action, do nothing on click
			console.log("Pointer down ignored, action is:", currentAction);
			return;
		}

		// --- Raycasting Logic ---
		const raycaster = new THREE.Raycaster(); // Create raycaster instance here or reuse if declared globally
		const mouse = new THREE.Vector2();     // Reusable vector

		// Calculate mouse position in normalized device coordinates (-1 to +1)
		const rect = container.getBoundingClientRect();
		mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		// Update the picking ray with the camera and mouse position
		raycaster.setFromCamera(mouse, camera);

		// Calculate objects intersecting the picking ray - specifically the ground
		const intersects = raycaster.intersectObject(ground); // Target only the ground mesh

		if (intersects.length > 0) {
			const intersectPoint = intersects[0].point; // Get the first intersection point

			// Convert the world intersection point to grid coordinates
			const gridCoords = worldToGrid(intersectPoint.x, intersectPoint.z);

			if (gridCoords) {
				// --- Perform action based on SELECTED TOOL ---
				switch (currentAction.toolType) {
					case 'water':
						console.log(`Attempting to water Grid Cell: Row ${gridCoords.row}, Col ${gridCoords.col}`);
						waterPlantAt(gridCoords.row, gridCoords.col);
						break;
					case 'remove':
						console.log(`Attempting to remove from Grid Cell: Row ${gridCoords.row}, Col ${gridCoords.col}`);
						removePlantAt(gridCoords.row, gridCoords.col);
						break;
					default:
						console.log("Unknown tool selected:", currentAction.toolType);
					}
					// --- End Perform action ---
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
			// Check if localStorage is actually available (e.g., not in private mode sometimes)
			if (typeof localStorage === 'undefined') {
				console.warn("localStorage not available, cannot save state.");
				return;
        	}
			const serializableGrid: SerializableGardenGrid = gardenGrid.map(row =>
				row.map(cell => {
					if (!cell) return null;
					// Exclude the mesh property for saving
					const { mesh, ...rest } = cell;
					return rest;
				})
        	);
			localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializableGrid));
			console.log("Garden state saved.");
    	} catch (error) {
			console.error("Failed to save garden state:", error);
			// Handle potential quota errors or other issues
    	}
	}

	function loadGardenState() {
		try {
			const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
			if (savedData) {
				const loadedGrid: SerializableGardenGrid = JSON.parse(savedData);
				console.log("Loading saved garden state...");

				// Initialize gardenGrid with the correct dimensions
				gardenGrid = Array(GRID_DIVISIONS).fill(null).map(() => Array(GRID_DIVISIONS).fill(null));

				for (let r = 0; r < GRID_DIVISIONS; r++) {
					for (let c = 0; c < GRID_DIVISIONS; c++) {
						const savedCell = loadedGrid[r]?.[c];
						if (savedCell) {
							// Recreate the mesh (using placeholder for now)
							const loadedMesh = new THREE.Mesh(placeholderGeometry, healthyMaterial);
							const worldPos = gridToWorld(r, c);

							// Create the full PlantInfo object
							const loadedPlant: PlantInfo = {
								...savedCell, // Spread the loaded data
								mesh: loadedMesh
							};

							// Calculate offline growth BEFORE setting visuals
							updatePlantGrowth(loadedPlant);

							// --- Check Thirst State After Offline Growth (Use plant-specific threshold) ---
							const now = Date.now();
							const config = plantConfigs[loadedPlant.plantTypeId] ?? plantConfigs.default;
							if (loadedPlant.state === 'healthy' && (now - loadedPlant.lastWateredTime) > config.thirstThresholdSeconds * 1000) {
								loadedPlant.state = 'needs_water';
								console.log(`Plant at [${r},${c}] became thirsty while offline.`);
							}
							// --- End Thirst Check ---

							// Set visuals based on potentially updated progress
							updatePlantVisuals(loadedPlant);

							// --- Corrected Positioning ---
							// Apply world X and Z, but keep the Y calculated by updatePlantVisuals
							loadedMesh.position.x = worldPos.x;
							loadedMesh.position.z = worldPos.z;
							// loadedMesh.position.y is already correctly set by updatePlantVisuals
							// --- End Corrected Positioning ---

							scene.add(loadedMesh);
							gardenGrid[r][c] = loadedPlant;
						}
					}
				}
				console.log("Garden state loaded.", gardenGrid);
				return true; // Indicate successful load
			}
		} catch (error) {
			console.error("Failed to load or parse garden state:", error);
			// Clear potentially corrupted data
			localStorage.removeItem(LOCAL_STORAGE_KEY);
		}
		return false; // Indicate load failed or no data
	}

	// --- End Persistence Functions ---

	onMount(() => {
		if (!container) return;

		// --- Scene Setup (Needs to happen before loading meshes) ---
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0xf4f1de);
		// --- End Scene Setup ---

		// --- Load State or Initialize ---
		const loaded = loadGardenState();
		if (!loaded) {
			initializeGrid(); // Initialize if no save data found or load failed
		}
		// --- End Load State ---

		// 1. Camera (Orthographic) - Initial setup, bounds will be set in handleResize
		camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 1, 1000 ); // Placeholder bounds
		camera.position.set(10, 10, 10); // Restore isometric-like position
		camera.lookAt(0, 0, 0);
		scene.add(camera);

		// 2. Renderer
		renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(container.clientWidth, container.clientHeight);
		renderer.setPixelRatio(window.devicePixelRatio);
		container.appendChild(renderer.domElement);

		// 3. Lighting
		const ambientLight = new THREE.AmbientLight(0xffffff, 1); // Slightly increased ambient
		scene.add(ambientLight);
		const directionalLight = new THREE.DirectionalLight(0xffffff, 1); // Slightly decreased directional
		directionalLight.position.set(-10, 15, 10); // Adjust light position if needed
		scene.add(directionalLight);

		// 4. Ground Plane
		const groundGeometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
		const groundMaterial = new THREE.MeshStandardMaterial({
			color: 0x81b29a,
			side: THREE.DoubleSide // Render both sides (useful for raycasting)
		});
		ground = new THREE.Mesh(groundGeometry, groundMaterial); // Assign to component variable
		ground.rotation.x = -Math.PI / 2; // Rotate it to be horizontal
		ground.position.y = -0.01;
		scene.add(ground);

		const gridHelper = new THREE.GridHelper(PLANE_SIZE, GRID_DIVISIONS);
		// gridHelper.position.y = 0.01; // Optional: Raise slightly to prevent z-fighting
		scene.add(gridHelper);

		// 5. Render Loop (Updated for Thirst Check)
		const animate = () => {
			animationFrameId = requestAnimationFrame(animate);

			const now = Date.now(); // Get current time once per frame

			// --- Live Update Loop ---
			for (let r = 0; r < GRID_DIVISIONS; r++) {
				for (let c = 0; c < GRID_DIVISIONS; c++) {
					const cell = gardenGrid[r]?.[c];
					if (cell) {
						let stateChanged = false; // Tracks if thirst state changed *this frame*

						// --- Check for Thirst ---
						const config = plantConfigs[cell.plantTypeId] ?? plantConfigs.default;
						if (cell.state === 'healthy' && (now - cell.lastWateredTime) > config.thirstThresholdSeconds * 1000) {
							cell.state = 'needs_water';
							console.log(`Plant at [${r},${c}] needs water!`);
							stateChanged = true; // Mark that the state flipped to thirsty
						}
						// --- End Thirst Check ---

						// --- Growth Update ---
						const needsVisualUpdate = updatePlantGrowth(cell);
						// --- End Growth Update ---

						// Update visuals if state changed OR growth happened
						if (stateChanged || needsVisualUpdate) {
							updatePlantVisuals(cell);
						}

						// --- Save if the state flipped to thirsty THIS FRAME ---
						// This ensures the thirsty state is saved as soon as it happens
						if (stateChanged) { // <-- SIMPLIFIED Condition
							saveGardenState();
						}
					}
				}
			}
			// --- End Live Update Loop ---

			renderer.render(scene, camera);
		};

		// Handle Resize (Updated for fitting the plane)
		const handleResize = () => {
			if (!container || !renderer || !camera) return;
			const width = container.clientWidth;
			const height = container.clientHeight;

			// Calculate the scale factor needed to fit gardenVisibleSize
			// into the smaller dimension of the viewport.
			// We divide the viewport dimension by the desired content size.
			const scaleX = width / gardenVisibleSize;
			const scaleY = height / gardenVisibleSize;

			// Use the smaller scale factor to ensure the content fits entirely.
			// This determines the "zoom" level.
			const scale = Math.min(scaleX, scaleY);

			// Calculate the effective world-space dimensions visible in the frustum.
			// We divide the viewport dimension by the chosen scale factor.
			const frustumWidth = width / scale;
			const frustumHeight = height / scale;

			// Set the camera's orthographic bounds based on the calculated frustum size.
			camera.left = -frustumWidth / 2;
			camera.right = frustumWidth / 2;
			camera.top = frustumHeight / 2;
			camera.bottom = -frustumHeight / 2;

			camera.updateProjectionMatrix(); // Apply the changes
			renderer.setSize(width, height); // Update renderer size
		}

		window.addEventListener('resize', handleResize);

		// Initial resize call to set correct camera bounds and start rendering
		handleResize();
		clock.start(); // Start the clock before the first frame
		animate(); // Start rendering and live updates

		// --- Start Periodic Saving ---
		saveIntervalId = window.setInterval(saveGardenState, SAVE_INTERVAL_MS);
		// --- End Periodic Saving ---

		// --- Drag and Drop Setup ---
		function handleDragOver(event: DragEvent) {
			event.preventDefault(); // Allow drop
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy'; // Indicate the type of drop
			}
		}

		function handleDrop(event: DragEvent) {
			event.preventDefault(); // Prevent default behavior
			if (event.dataTransfer) {
				const plantType = event.dataTransfer.getData('plantType');
				if (plantType) {
					// Calculate drop position
					const rect = container.getBoundingClientRect();
					const mouseX = event.clientX - rect.left;
					const mouseY = event.clientY - rect.top;

					// Normalize mouse coordinates
					const mouse = new THREE.Vector2(
						(mouseX / rect.width) * 2 - 1,
						-(mouseY / rect.height) * 2 + 1
					);

					// Raycasting
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
						console.log("No intersection with the ground plane.");
					}
				}
			}
		}

		container.addEventListener('dragover', handleDragOver);
		container.addEventListener('drop', handleDrop);
		container.addEventListener('pointerdown', handleCanvasPointerDown); 
		// --- End Drag and Drop Setup ---

		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			console.log('beforeunload triggered, saving state...');
			saveGardenState();
    	};
		if (typeof window !== 'undefined') {
       		window.addEventListener('beforeunload', handleBeforeUnload);
    	}
		// Cleanup on component destroy
		onDestroy(() => {
			if (typeof window !== 'undefined') {
            	window.removeEventListener('beforeunload', handleBeforeUnload);
        	}
			saveGardenState();

			// --- Clear Periodic Save Timer ---
			if (saveIntervalId !== undefined) {
				clearInterval(saveIntervalId);
			}
			// --- End Clear Timer ---

			cancelAnimationFrame(animationFrameId);
			window.removeEventListener('resize', handleResize);
			if (renderer) {
				renderer.dispose();
				if (renderer.domElement.parentNode) {
					renderer.domElement.parentNode.removeChild(renderer.domElement);
				}
			}
			// Dispose geometries, materials, textures if needed
			scene.traverse(object => {
				if (object instanceof THREE.Mesh) {
					object.geometry.dispose();
					// Check if material is an array before iterating
					if (Array.isArray(object.material)) {
						object.material.forEach(material => material.dispose());
					} else if (object.material) { // Check if material exists
						object.material.dispose();
					}
				}
				gridHelper.geometry.dispose();
				if (Array.isArray(gridHelper.material)) {
					gridHelper.material.forEach(m => m.dispose());
				} else {
					gridHelper.material.dispose();
				}
			});
			// Dispose placeholder geometry/material
			placeholderGeometry.dispose();
			healthyMaterial.dispose();
			thirstyMaterial.dispose();
			// Remove meshes explicitly if not handled by scene traversal dispose
			for (let r = 0; r < GRID_DIVISIONS; r++) {
				for (let c = 0; c < GRID_DIVISIONS; c++) {
					if (gardenGrid[r]?.[c]?.mesh) {
						scene.remove(gardenGrid[r][c]!.mesh!); // Remove from scene
					}
				}
			}
			clock.stop(); // Stop the clock

			// Remove event listeners
			container.removeEventListener('dragover', handleDragOver);
			container.removeEventListener('drop', handleDrop);
			container.removeEventListener('pointerdown', handleCanvasPointerDown);
		});
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