import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { DRACOLoader } from 'three-stdlib';
import { plantConfigs, decorConfigs } from './objectConfigs'; // Assuming these are accessible

// --- Types ---
interface IconRequest {
    name: string;
    objectType: 'plant' | 'decor';
    growth: number | undefined;
    size: number;
    rotationY: number | undefined;
    resolve: (dataUrl: string) => void;
    reject: (error: any) => void;
}

interface CachedModel {
    scene: THREE.Group;
    // Add other relevant cached data if needed (like bounding box)
}

// --- Module State ---
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.OrthographicCamera | null = null;
let ambientLight: THREE.AmbientLight | null = null;
let directionalLight: THREE.DirectionalLight | null = null;
let canvasElement: HTMLCanvasElement | null = null;

const loadingManager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(loadingManager);
const dracoLoader = new DRACOLoader(loadingManager);
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
gltfLoader.setDRACOLoader(dracoLoader);

const modelCache: Record<string, Promise<CachedModel>> = {}; // Cache promises to handle concurrent requests for the same model
const imageDataCache = new Map<string, string>();
let isProcessing = false;
const requestQueue: IconRequest[] = [];

// --- Helper: Get Model Path (Combine previous helpers) ---
function getModelPath(objectType: 'plant' | 'decor', name: string, growth: number | undefined): string | null {
     if (objectType === 'plant') {
        const targetGrowth = growth ?? 1.0;
        const clampedGrowth = Math.max(0, Math.min(1, targetGrowth));
        const config = plantConfigs[name];
        if (!config?.growthStages || config.growthStages.length === 0) {
            console.warn(`Icon Generator: Config/stages missing for plant ${name}. Using default.`);
            const defaultConfig = plantConfigs.default;
             if (!defaultConfig?.growthStages || defaultConfig.growthStages.length === 0) return null;
             const sortedDefaultStages = [...defaultConfig.growthStages].sort((a, b) => a.maxGrowth - b.maxGrowth);
             const defaultStage = sortedDefaultStages.find(s => clampedGrowth <= s.maxGrowth) ?? sortedDefaultStages[sortedDefaultStages.length - 1];
             return defaultStage?.modelPath ?? null;
        }
        const sortedStages = [...config.growthStages].sort((a, b) => a.maxGrowth - b.maxGrowth);
        const stage = sortedStages.find(s => clampedGrowth <= s.maxGrowth);
        return stage ? stage.modelPath : sortedStages[sortedStages.length - 1]?.modelPath ?? null;
    } else { // decor
        const config = decorConfigs[name];
        return config?.modelPath ?? null;
    }
}

// --- Helper: Load or Get Model from Cache ---
async function loadModel(modelPath: string): Promise<CachedModel> {
    if (!modelCache[modelPath]) {
        modelCache[modelPath] = new Promise((resolve, reject) => {
            console.log(`Icon Generator: Loading model ${modelPath}`);
            gltfLoader.load(
                modelPath,
                (gltf) => {
                    console.log(`Icon Generator: Successfully loaded ${modelPath}`);
                    // We might want to clone the scene later if modifications are needed per-icon
                    // For now, cache the original loaded scene
                    resolve({ scene: gltf.scene });
                },
                undefined,
                (error) => {
                    console.error(`Icon Generator: Error loading GLTF ${modelPath}:`, error);
                    delete modelCache[modelPath]; // Remove failed promise from cache
                    reject(`Failed to load model: ${modelPath.split('/').pop()}`);
                }
            );
        });
    }
     try {
        // Return a clone to avoid modifying the cached original if needed later
        const original = await modelCache[modelPath];
        const clonedScene = original.scene.clone(); // Simple clone for now
        return { scene: clonedScene };
    } catch (error) {
        console.error(`Icon Generator: Error retrieving cached model ${modelPath}:`, error);
        throw error; // Re-throw to be caught by processQueue
    }
}

// --- Helper: Create Cache Key ---
function createCacheKey(req: Omit<IconRequest, 'resolve' | 'reject'>): string {
    let stageIdentifier: string;
    if (req.objectType === 'plant') {
        // Determine the model path based on growth, this IS the stage identifier
        stageIdentifier = getModelPath(req.objectType, req.name, req.growth) ?? 'unknown_plant_stage';
    } else {
        // For decor, the name itself (or its model path) identifies the object
        stageIdentifier = getModelPath(req.objectType, req.name, req.growth) ?? 'unknown_decor'; // Or just req.name if model paths are unique per name
    }

    const rotationStr = (req.rotationY ?? 0).toFixed(3);
    // Key now depends on: type, name (still useful), VISUAL stage (model path), size, rotation
    return `${req.objectType}:${req.name}:${stageIdentifier}:${req.size}:${rotationStr}`;
}

// --- Initialize Shared Renderer ---
function initializeRenderer(size: number) {
    if (renderer) return; // Already initialized

    console.log("Icon Generator: Initializing shared WebGL context...");
    canvasElement = document.createElement('canvas');
    canvasElement.width = size; // Initial size, might need resize later if different sizes requested
    canvasElement.height = size;

    try {
        renderer = new THREE.WebGLRenderer({
            canvas: canvasElement,
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true, // Needed for toDataURL
        });
        renderer.setPixelRatio(window.devicePixelRatio); // Set early
        renderer.setSize(size, size); // Ensure size is set
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setClearColor(0x000000, 0);

        scene = new THREE.Scene();

        const aspect = 1; // square
        const initialFrustumSize = 2;
        camera = new THREE.OrthographicCamera(
            initialFrustumSize * aspect / -2, initialFrustumSize * aspect / 2,
            initialFrustumSize / 2, initialFrustumSize / -2,
            0.1, 100
        );
        camera.position.set(1.5, 1, 1.5);
        camera.lookAt(0, 0, 0);
        scene.add(camera);

        ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambientLight);
        directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(2, 3, 1);
        directionalLight.target.position.set(0, 0, 0);
        scene.add(directionalLight);
        scene.add(directionalLight.target);

        console.log("Icon Generator: Shared context initialized.");

    } catch (e) {
        console.error("Icon Generator: Failed to initialize WebGL:", e);
        renderer = null; // Ensure it's null if failed
        // Reject any pending requests?
        requestQueue.forEach(req => req.reject("Failed to initialize WebGL"));
        requestQueue.length = 0; // Clear queue
    }
}

// --- Process the Queue ---
async function processQueue() {
    if (isProcessing || requestQueue.length === 0) {
        return;
    }

    const request = requestQueue.shift();
    if (!request) {
        isProcessing = false;
        return;
    }

    const cacheKey = createCacheKey(request);
    if (imageDataCache.has(cacheKey)) {
        console.log(`Icon Generator: Cache hit for ${request.name} (${cacheKey})`);
        request.resolve(imageDataCache.get(cacheKey)!);
        setTimeout(processQueue, 0); // Check for next item
        return; // Skip rendering
    }

    isProcessing = true;

    // Ensure renderer is initialized (using the size of the current request)
    initializeRenderer(request.size);
    if (!renderer || !scene || !camera || !canvasElement) {
        request.reject("Renderer not available");
        isProcessing = false;
        setTimeout(processQueue, 0);
        return;
    }

    // Resize renderer if necessary
    if (canvasElement.width !== request.size || canvasElement.height !== request.size) {
        console.log(`Icon Generator: Resizing renderer to ${request.size}x${request.size}`);
        renderer.setSize(request.size, request.size);
        // Camera aspect might need update if size changes ratio, but here it's always 1:1
    }

    let model: THREE.Group | null = null;
    let modelPath: string | null = null;
    try {
        modelPath = getModelPath(request.objectType, request.name, request.growth);
        if (!modelPath) {
            throw new Error(`Could not determine model path for ${request.objectType} ${request.name}`);
        }

        const loadedModelData = await loadModel(modelPath);
        model = loadedModelData.scene; // Use the cloned scene

        // --- Position and Scale Model ---
        const box = new THREE.Box3().setFromObject(model);
        const sizeVec = new THREE.Vector3();
        box.getSize(sizeVec);
        const center = new THREE.Vector3();
        box.getCenter(center);

        model.position.set(-center.x, -center.y, -center.z); // Center the model
        model.rotation.y = request.rotationY ?? 0;

        const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
        const effectiveDim = Math.max(maxDim, 0.1);
        const cameraViewSize = effectiveDim * 1.4; // Padding

        camera.left = cameraViewSize / -2;
        camera.right = cameraViewSize / 2;
        camera.top = cameraViewSize / 2;
        camera.bottom = cameraViewSize / -2;
        camera.near = Math.max(0.01, effectiveDim * 0.1);
        camera.far = effectiveDim * 5;
        camera.updateProjectionMatrix();

        const dist = cameraViewSize * 1.2;
        camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
        camera.lookAt(0, 0, 0);
        // --- End Positioning ---

        scene.add(model);
        renderer.render(scene, camera);

        const dataUrl = renderer.domElement.toDataURL('image/webp', 0.85);

        imageDataCache.set(cacheKey, dataUrl);
        console.log(`Icon Generator: Cached result for ${request.name} (${cacheKey})`);

        request.resolve(dataUrl);

    } catch (error) {
        console.error(`Icon Generator: Failed to generate icon for ${request.name}:`, error);
        request.reject(error instanceof Error ? error.message : String(error));
    } finally {
        if (model && scene) {
            scene.remove(model);
             model.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.geometry?.dispose();
                     const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => mat?.dispose());
                }
            });
        }

        isProcessing = false;
        // Process next item immediately
        setTimeout(processQueue, 0);
    }
}

export function generateIconDataUrl(
    objectType: 'plant' | 'decor',
    name: string,
    size: number,
    growth: number | undefined,
    rotationY: number | undefined
): Promise<string> {
    // --- Check Cache Before Queuing ---
    const checkReq = { objectType, name, size, growth, rotationY };
    const cacheKey = createCacheKey(checkReq);
    if (imageDataCache.has(cacheKey)) {
         console.log(`Icon Generator: Cache hit (sync) for ${name} (${cacheKey})`);
        return Promise.resolve(imageDataCache.get(cacheKey)!);
    }
    // --- End Cache Check ---


    return new Promise((resolve, reject) => {
        requestQueue.push({
            name,
            objectType,
            growth,
            size,
            rotationY,
            resolve,
            reject,
        });
        if (!isProcessing) {
             setTimeout(processQueue, 0);
        }
    });
}