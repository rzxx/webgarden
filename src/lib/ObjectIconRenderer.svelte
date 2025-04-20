<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as THREE from 'three';
	import { GLTFLoader } from 'three-stdlib';
	import { DRACOLoader } from 'three-stdlib';
    import { plantConfigs, decorConfigs } from './objectConfigs';

	// --- Props ---
	/** The ID of the plant or decor object (e.g., "fern", "streetLamp") */
	export let name: string;
	/** The type of object to determine which config to use */
	export let objectType: 'plant' | 'decor';
    /** Optional: The growth progress (0.0 to 1.0) for plants. Defaults to 1.0 (fully grown) if undefined. */
	export let growth: number | undefined = undefined;
	/** Desired size (width & height) of the icon canvas in pixels */
	export let size: number = 64; // Default size

	// --- Internal State ---
	let container: HTMLDivElement;
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.OrthographicCamera | null = null;
	let model: THREE.Group | null = null;
	let requestRef: number | undefined = undefined; // Keep track if animation loop runs briefly
	let isLoading = true;
	let error: string | null = null;
	// --- End Configs ---


	// --- Helper: Find Correct Plant Model Path Based on Growth ---
	function getPlantModelPathForGrowth(plantId: string, growthProgress: number): string | null {
        // Ensure growthProgress is clamped between 0 and 1
        const clampedGrowth = Math.max(0, Math.min(1, growthProgress));

        const config = plantConfigs[plantId]; // Don't use default here initially

        if (!config) {
             console.warn(`Icon Renderer: Plant config not found for ID "${plantId}". Trying default.`);
             const defaultConfig = plantConfigs.default;
             if (!defaultConfig?.growthStages || defaultConfig.growthStages.length === 0) {
                 console.error(`Icon Renderer: Default plant config is missing growth stages.`);
                 return null;
             }
              // Use default config's stages
             const sortedDefaultStages = [...defaultConfig.growthStages].sort((a, b) => a.maxGrowth - b.maxGrowth);
             const defaultStage = sortedDefaultStages.find(s => clampedGrowth <= s.maxGrowth) ?? sortedDefaultStages[sortedDefaultStages.length - 1];
             return defaultStage?.modelPath ?? null;
        }


		if (!config.growthStages || config.growthStages.length === 0) {
			console.error(`Icon Renderer: Plant config for "${plantId}" has no growthStages defined.`);
			return null;
		}

		// Ensure stages are sorted by maxGrowth (important!)
        // Create a sorted copy to avoid modifying the original config object
		const sortedStages = [...config.growthStages].sort((a, b) => a.maxGrowth - b.maxGrowth);

		// Find the first stage where the plant's progress is less than or equal to the stage's maxGrowth
		const stage = sortedStages.find(s => clampedGrowth <= s.maxGrowth);

		if (stage) {
			return stage.modelPath;
		} else {
			// This case should technically not be hit if clampedGrowth <= 1.0 and the stages cover up to 1.0,
            // but as a fallback, return the last stage (fully grown).
			console.warn(`Icon Renderer: Could not find specific growth stage for progress ${clampedGrowth} for ${plantId}. Using last stage.`);
			return sortedStages[sortedStages.length - 1]?.modelPath ?? null; // Added null check
		}
	}

    // --- Helper: Find Decor Model Path ---
    function getDecorModelPath(decorId: string): string | null {
        const config = decorConfigs[decorId];
         if (!config) {
            console.error(`Icon Renderer: Decor config not found for ID "${decorId}".`);
            return null;
        }
        if (!config.modelPath) {
             console.error(`Icon Renderer: Decor config for "${decorId}" is missing modelPath.`);
             return null;
        }
        return config.modelPath;
    }

	// --- Setup and Render Logic ---
	onMount(() => {
		if (!container) return;
        isLoading = true;
        error = null;

        // --- Determine Model Path ---
        let modelPath: string | null = null;
        if (objectType === 'plant') {
            // Use the provided growth prop, defaulting to 1.0 if undefined
            const targetGrowth = growth ?? 1.0;
            modelPath = getPlantModelPathForGrowth(name, targetGrowth);
        } else { // objectType === 'decor'
             modelPath = getDecorModelPath(name);
        }
        // --- ---

        if (!modelPath) {
            error = `Failed to find model path for ${objectType} '${name}'${objectType === 'plant' ? ` at growth ${growth ?? 1.0}` : ''}. Check config.`;
            isLoading = false;
            console.error(error);
            return;
        }

        // --- Basic Scene ---
        scene = new THREE.Scene();

		// --- Renderer ---
		try {
			renderer = new THREE.WebGLRenderer({
				antialias: true,
				alpha: true,
				canvas: container.querySelector('canvas') ?? undefined
			});
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(size, size);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.setClearColor(0x000000, 0);
            if (!renderer.domElement.parentElement) {
                 container.appendChild(renderer.domElement);
            }
		} catch (e) {
			error = `Failed to initialize WebGL: ${e}`;
            isLoading = false;
            console.error(error);
			return;
		}

		// --- Camera (Adjusted after model load) ---
        const aspect = 1; // Canvas is square
        const initialFrustumSize = 2; // Initial guess
		camera = new THREE.OrthographicCamera(
            initialFrustumSize * aspect / -2, initialFrustumSize * aspect / 2,
            initialFrustumSize / 2, initialFrustumSize / -2,
            0.1, 100
        );
		camera.position.set(1.5, 1, 1.5); // Initial position
		camera.lookAt(0, 0, 0);
        scene.add(camera);

		// --- Simple Lighting ---
		const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
		scene.add(ambientLight);
		const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
		directionalLight.position.set(2, 3, 1);
        directionalLight.target.position.set(0,0,0);
		scene.add(directionalLight);
        scene.add(directionalLight.target);

		// --- Loading Manager & Loaders ---
        const loadingManager = new THREE.LoadingManager();
        const gltfLoader = new GLTFLoader(loadingManager);
        const dracoLoader = new DRACOLoader(loadingManager);
		dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'); // Adjust if needed
		gltfLoader.setDRACOLoader(dracoLoader);

		// --- Load the Model ---
        console.log(`Icon Renderer: Attempting to load ${modelPath} for ${name}`);
		gltfLoader.load(
			modelPath,
			(gltf) => {
				console.log(`Icon Renderer: Successfully loaded ${modelPath}`);
				model = gltf.scene;

                // --- Process Model for Icon Rendering ---
                const box = new THREE.Box3().setFromObject(model);
                const sizeVec = new THREE.Vector3();
                box.getSize(sizeVec);
                const center = new THREE.Vector3();
                box.getCenter(center);

                model.position.x -= center.x;
                model.position.y -= center.y; // Center vertically
                model.position.z -= center.z;

                const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
                if (maxDim === 0 && modelPath !== '/models/seed.glb') { // Allow seed to be tiny
                    console.warn(`Model ${modelPath} has zero dimensions.`);
                    // Optional: Handle zero-size model (show error, different icon?)
                     // error = "Model has zero dimensions.";
                     // isLoading = false;
                     // return; // Prevent rendering if strictly desired
                }

                // Add a minimum size to prevent overly large camera view for tiny objects (like seeds)
                const effectiveDim = Math.max(maxDim, 0.1); // Ensure at least 0.1 dimension for camera calculation
                const cameraViewSize = effectiveDim * 1.4; // Padding
                const aspect = 1;

                if (camera) {
                    camera.left = cameraViewSize * aspect / -2;
                    camera.right = cameraViewSize * aspect / 2;
                    camera.top = cameraViewSize / 2;
                    camera.bottom = cameraViewSize / -2;
                     // Adjust near/far based on *effective* dimension
                    camera.near = Math.max(0.01, effectiveDim * 0.1); // Use smaller near for small icons
                    camera.far = effectiveDim * 5;
                    camera.updateProjectionMatrix();

                    // Adjust camera position based on *view size*
                    const dist = cameraViewSize * 1.2; // Adjust multiplier for distance
                    camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7); // Maintain angle
                    camera.lookAt(0, 0, 0);
                }

				scene?.add(model);

                if (renderer && scene && camera) {
                    renderer.render(scene, camera);
                    console.log(`Icon Renderer: Rendered ${name} using ${modelPath}`);
                } else {
                    console.error("Icon Renderer: Missing components for final render.");
                     error = "Render components missing.";
                }
                isLoading = false;
			},
			undefined,
			(err) => {
				console.error(`Icon Renderer: Error loading GLTF ${modelPath}:`, err);
                error = `Failed to load: ${modelPath.split('/').pop()}`; // Show filename
                isLoading = false;
			}
		);

        return () => {
             // Cleanup is in onDestroy
        }
	}); // End onMount

    onDestroy(() => {
        console.log(`Icon Renderer: Destroying instance for ${name}`);
        if (requestRef) {
            cancelAnimationFrame(requestRef);
        }

        // Dispose Three.js Objects
        if (model && scene) {
            scene.remove(model);
            model.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.geometry?.dispose();
                    // Dispose materials and textures
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => {
                        if (mat) {
                            Object.keys(mat).forEach(key => {
                                const value = mat[key as keyof THREE.Material];
                                if (value instanceof THREE.Texture) {
                                    value.dispose();
                                }
                            });
                            mat.dispose();
                        }
                    });
                }
            });
            model = null;
        }

        // Dispose scene children (lights etc.)
        if(scene) {
            while(scene.children.length > 0){
                const obj = scene.children[0];
                scene.remove(obj);
                // Basic disposal for lights (usually not much needed)
                if (obj instanceof THREE.Light) {
                    obj.dispose?.(); // Some lights might have dispose methods
                }
            }
            scene = null;
        }


        if (renderer) {
            renderer.dispose(); // Release WebGL context and resources
            // Remove canvas if it was added by this component
            if (renderer.domElement && renderer.domElement.parentElement === container) {
                 container?.removeChild(renderer.domElement);
            }
            renderer = null;
        }

        camera = null; // Just clear reference

        console.log(`Icon Renderer: Cleanup complete for ${name}`);
    });

</script>

<div bind:this={container} class="icon-container" style:width="{size}px" style:height="{size}px">
	{#if isLoading}
		<div class="status loading">Loading...</div>
	{:else if error}
		<div class="status error" title={error}>Error</div>
	{/if}
    <!-- Canvas will be appended here by Three.js if not already present -->
    <canvas style:width="{size}px" style:height="{size}px"></canvas>
</div>

<style>
	.icon-container {
		display: inline-block; /* Or block, depending on layout needs */
		position: relative;
		overflow: hidden;
        border: 1px solid #ccc; /* Optional: for visualization */
        background-color: rgba(100, 100, 150, 0.2); /* Optional: faint bg */
	}

    canvas {
        display: block; /* Remove extra space below canvas */
        width: 100%;
        height: 100%;
    }

	.status {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		display: flex;
		justify-content: center;
		align-items: center;
		font-size: calc(var(--icon-size, 64px) * 0.2); /* Adjust font size relative to container */
        line-height: 1;
		background-color: rgba(0, 0, 0, 0.5);
		color: white;
		z-index: 1; /* Ensure status is above canvas */
        text-align: center;
        padding: 2px;
        box-sizing: border-box;
	}

    .status.loading {
        /* Add spinner styles if desired */
        background-color: rgba(0, 0, 0, 0.7);
    }

	.status.error {
		background-color: rgba(200, 0, 0, 0.7);
        cursor: help;
	}
</style>