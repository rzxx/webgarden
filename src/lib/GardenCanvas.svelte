<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import * as THREE from 'three';
import { MathUtils } from 'three'; // For mapLinear and lerp
import { selectedAction, type SelectedAction, heldItem, isDraggingItem, type HeldItemInfo } from './stores';
import { get } from 'svelte/store';
import { GLTFLoader } from 'three-stdlib'; // Import GLTFLoader
import { DRACOLoader } from 'three-stdlib';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'; // Import SkeletonUtils for cloning

// Toon Shading Gradient Map
const toonGradientMap = new THREE.TextureLoader().load('/threeTone.jpg')
toonGradientMap.minFilter = THREE.NearestFilter
toonGradientMap.magFilter = THREE.NearestFilter

// --- Plant Configuration ---
interface GrowthStage {
    maxGrowth: number; // The progress value *up to which* this stage applies (inclusive)
    modelPath: string;
    // Optional: stage-specific scale factors if needed, otherwise use main config
    // initialScale?: number;
    // maxScale?: number; // Max scale *for this stage*
}

interface PlantConfig {
    growthRatePerSecond: number;
    initialScale: number; // Overall initial scale (at progress 0)
    maxScale: number;     // Overall max scale (at progress 1)
    thirstThresholdSeconds: number;
    size: { rows: number; cols: number };
    growthStages: GrowthStage[]; // REQUIRED: Define models for growth phases
    healthyColorTint?: THREE.Color;
    thirstyColorTint?: THREE.Color;
}

// --- Updated Plant Configs ---
const plantConfigs: Record<string, PlantConfig> = {
    fern: {
        growthRatePerSecond: 1 / (60 * 1), // Faster for testing
        initialScale: 0.2, // Overall start scale
        maxScale: 1,     // Overall end scale
        thirstThresholdSeconds: 60 * 1,
        size: { rows: 1, cols: 1 },
        healthyColorTint: new THREE.Color(0xffffff),
        thirstyColorTint: new THREE.Color(0x6a6a6a),
        growthStages: [
            { maxGrowth: 0.25, modelPath: '/models/seed.glb' },
            { maxGrowth: 1.00, modelPath: '/models/fern.glb' }
        ]
    },
    cactus: {
        growthRatePerSecond: 1 / (60 * 5),
        initialScale: 0.2,
        maxScale: 1,
        thirstThresholdSeconds: 60 * 10,
        size: { rows: 1, cols: 1 },
        healthyColorTint: new THREE.Color(0xffffff),
        thirstyColorTint: new THREE.Color(0x6a6a6a),
        growthStages: [
            { maxGrowth: 0.50, modelPath: '/models/seed.glb' },
            { maxGrowth: 1.00, modelPath: '/models/cactus.glb' }
        ]
    },
    bush: { // Example: Bush might skip a stage
        growthRatePerSecond: 1 / (60 * 3),
        initialScale: 0.1,
        maxScale: 1,
        thirstThresholdSeconds: 60 * 8,
        size: { rows: 2, cols: 2 },
        healthyColorTint: new THREE.Color(0xffffff),
        thirstyColorTint: new THREE.Color(0x8a8a8a),
        growthStages: [
            { maxGrowth: 0.10, modelPath: '/models/seed.glb' },
            { maxGrowth: 0.50, modelPath: '/models/bush_early.glb' },
            { maxGrowth: 0.75, modelPath: '/models/bush_growing.glb' },
            { maxGrowth: 1.00, modelPath: '/models/bush.glb' }
        ]
    },
    default: { // Add growthStages to default as well
        growthRatePerSecond: 1 / (60 * 2),
        initialScale: 0.4,
        maxScale: 1.0,
        thirstThresholdSeconds: 60 * 5,
        size: { rows: 1, cols: 1 },
        healthyColorTint: new THREE.Color(0xffffff),
        thirstyColorTint: new THREE.Color(0x6a6a6a),
        growthStages: [
             { maxGrowth: 1.00, modelPath: '/models/fern.glb' } // Default uses box
        ]
    }
};
// --- End Plant Configuration ---

// --- Decor Configuration ---
interface DecorPointLightProps {
    // Properties for the THREE.PointLight
    color?: number | string; // Default: 0xffffff
    intensity?: number;      // Default: 1.0
    distance?: number;       // Default: 0 (no limit) - Set this! Often crucial for performance.
    decay?: number;          // Default: 2 (realistic falloff)
    castShadow?: boolean;    // Default: false (shadows are expensive!)
    // --- Custom Logic Flags ---
    activeAtNightOnly?: boolean; // Example: For lamps that turn on at night
    // Add more properties as needed (e.g., powerCost, flicker settings?)
}

interface DecorConfig {
    size: { rows: number; cols: number };
    modelPath: string;
    defaultRotationY?: number;
    baseScale?: number;
    // NEW: Map Empty names to their light properties
    pointLightDefinitions?: Record<string, DecorPointLightProps>; // Key: Name of the Empty in the GLTF
}

const decorConfigs: Record<string, DecorConfig> = {
    /* box: {
        size: { rows: 1, cols: 1 },
        modelPath: '/models/box.glb',
        defaultRotationY: 0,
        baseScale: 1.0 },
	boxBig: {
        size: { rows: 2, cols: 2 },
        modelPath: '/models/box_big.glb',
        defaultRotationY: 0,
        baseScale: 1.0 }, // Base scale refers to the size *within* its 2x2 area */
    streetLamp: {
        size: { rows: 1, cols: 1 }, // Example size
        modelPath: '/models/street_lamp.glb',
        defaultRotationY: 0,
        baseScale: 1.5,
        pointLightDefinitions: {
            "PointLight_Lamp": { // Matches the Empty name in street_lamp.glb
                color: 0xFFE6A7, // Cornsilk (warm white)
                intensity: 10.0,
                distance: 12,
                decay: 2,
                castShadow: true, // Maybe one lamp casts shadows? Use sparingly!
                activeAtNightOnly: true // Only on when dark
            }
        }
    }
};
// --- End Decor Configuration ---

      
// --- Decor Instance Data Type (Updated) ---
interface DecorInfo {
    decorTypeId: string;
    size: { rows: number; cols: number };
    gridPos: { row: number; col: number };
    rotationY: number;
    object3D: THREE.Group | null;
    // NEW: Store the light instances
    lightObjects?: THREE.PointLight[];
    // NEW: Optional mapping if needed for updates (e.g., linking light back to its config name)
    lightMap?: Map<string, THREE.PointLight>; // Key: Empty name, Value: Light instance
    shaderUniforms?: Record<string, ObjectShaderUniforms>; // Map material UUID to its uniforms
}
// --- End Decor Instance Data ---

    

// --- Grid Cell Data Type (Updated) ---
interface PlantInfo {
    plantTypeId: string;
    state: 'healthy' | 'needs_water';
    growthProgress: number; // 0.0 to 1.0
    lastUpdateTime: number;
    lastWateredTime: number;
    size: { rows: number; cols: number };
    gridPos: { row: number; col: number };
    object3D: THREE.Group | null;
    originalMaterialColors?: Map<THREE.Material, THREE.Color>;
    shaderUniforms?: Record<string, ObjectShaderUniforms>; // Map material UUID to its uniforms
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
// Optional padding factor (e.g., 1.1 for 10% padding around the content)
const PADDING_FACTOR = 1.5;

// --- NEW: Define placeholder materials (if models aren't found) ---
const placeholderMaterial = new THREE.MeshToonMaterial({ color: 0x800080, gradientMap: toonGradientMap }); // Purple
const placeholderGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.5, CELL_SIZE * 0.5, CELL_SIZE * 0.5);
// --- End Placeholder ---

// --- Types for Saving ---
interface SerializableDecorInfo {
    decorTypeId: string;
    size: { rows: number; cols: number };
    rotationY: number;
    type: 'decor';
    // object3D is NOT saved
}
interface SerializablePlantInfo {
	plantTypeId: string;
	state: 'healthy' | 'needs_water';
	growthProgress: number;
	lastUpdateTime: number;
	lastWateredTime: number;
	size: { rows: number; cols: number };
	type: 'plant';
    // object3D is NOT saved
    // originalMaterialColors is NOT saved
}
type SerializableGridCell = SerializablePlantInfo | SerializableDecorInfo | null;
type SerializableGardenGrid = SerializableGridCell[][];
// --- End Types ---

// --- Asset Loading (Cache structure simplified slightly) ---
const loadingManager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(loadingManager);
const dracoLoader = new DRACOLoader(loadingManager);
dracoLoader.setDecoderPath( 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/' );
gltfLoader.setDRACOLoader(dracoLoader);

// Update the interface slightly if you want the name change reflected (optional)
interface CachedGltfData {
    scene: THREE.Group;
    baseScale: number; // This is now the scale to make the model 'unit size' (max dim = 1.0)
    centerOffsetX: number;
    centerOffsetY: number;
    centerOffsetZ: number;
}
const gltfCache: Record<string, CachedGltfData> = {};
let assetsLoaded = false;
let assetsLoadingPromise: Promise<void> | null = null;
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

//// --- Bounding Boxes / Preview (Keep mostly as is) ---
let previewGroup: THREE.Group | null = null;
let previewMeshes: THREE.Mesh[] = [];
const MAX_PREVIEW_CELLS = 16;
let validPlacementMaterial: THREE.MeshBasicMaterial;
let invalidPlacementMaterial: THREE.MeshBasicMaterial;
let lastPreviewGridPos: { row: number; col: number } | null = null;
const THROTTLE_DRAGOVER_MS = 75;
// --- End Bounding Boxes ---

// --- State variables to track pointer drag ---
let currentHeldItem: HeldItemInfo | null = null;
let isPointerDragging = false; // Local state reflecting the store
/// --- End Bounding Boxes ---

// --- Types for Shader Uniforms (Ensure this exists or add it) ---
interface ObjectShaderUniforms {
    fade: { value: number };
    waterEffect: { value: number };
    // NEW uniforms for watering effect
    waterProgress: { value: number };
    modelMinY: { value: number };
    modelMaxY: { value: number };
    waterEffectWidth: { value: number };
}

// --- Update ActiveAnimation interface ---
interface ActiveAnimation {
    uniform: { value: number };
    targetValue: number;
    startValue: number;
    duration: number;
    startTime: number;
    onComplete?: () => void;
    isPingPong?: boolean;
    pingPongReachedPeak?: boolean;
    ease?: (t: number) => number; // NEW: Easing function
}
const activeAnimations: ActiveAnimation[] = [];
/// --- End Animation Variables

// --- Reusable objects for updates ---
const tempVector3 = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScaleVector = new THREE.Vector3();
const tempColor = new THREE.Color(); // Keep for color manipulation

// --- Update CachedGltfData ---
interface CachedGltfData {
    scene: THREE.Group; // The *original* loaded scene (to be cloned)
    baseScale: number; // Scale factor to normalize model size
    // Offsets needed to move the bounding box center to (0, y, 0) *before* scaling
    centerOffsetX: number;
    centerOffsetY: number;
    centerOffsetZ: number;
    // NEW: Store model bounds
    modelMinY: number;
    modelMaxY: number;
}

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
const MAX_DIRECTIONAL_INTENSITY = 2;
const MIN_DIRECTIONAL_INTENSITY = 0.4;
const MAX_AMBIENT_INTENSITY = 0.8;
const MIN_AMBIENT_INTENSITY = 0.2;
const MAX_HEMISPHERE_INTENSITY = 1;
const MIN_HEMISPHERE_INTENSITY = 0.2;

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

/// --- Helper: Extract Geometry/Material and Calculate Scale from GLTF (Improved Centering & Normalization) ---
function extractAndPrepareGltfData(gltfScene: THREE.Group, modelPath: string, targetSize: number = 1.0): CachedGltfData | null {
    let modelNormalizationScale = 1.0;
    let centerOffsetX = 0;
    let centerOffsetY = 0;
    let centerOffsetZ = 0;
    let modelMinY = 0; // NEW: Initialize bounds
    let modelMaxY = 0; // NEW: Initialize bounds

    // --- Calculate Bounding Box for the entire scene ---
    const box = new THREE.Box3();
    box.setFromObject(gltfScene, true); // true = precisely check descendants

    const size = new THREE.Vector3();
    box.getSize(size);

    const center = new THREE.Vector3();
    box.getCenter(center);

    // --- STORE ORIGINAL BOUNDS ---
    // Store these *before* calculating centering offsets
    modelMinY = box.min.y;
    modelMaxY = box.max.y;
    // --- End Store Bounds ---

    if (size.x === 0 && size.y === 0 && size.z === 0) {
        console.warn("GLTF scene bounding box is zero. Using default scale/offset.", gltfScene);
    } else {
        const maxDim = Math.max(size.x, size.y, size.z);

        if (maxDim > 0) {
            modelNormalizationScale = targetSize / maxDim;
        } else {
            modelNormalizationScale = 1.0;
        }

        // Offsets calculated relative to original model size
        centerOffsetY = -box.min.y; // Offset needed *before scaling* to put base at y=0
        centerOffsetX = -center.x;
        centerOffsetZ = -center.z;

        // console.log(`GLTF Prep: Path=${modelPath || 'N/A'}`);
        // console.log(`  Orig Bounds Y: [${modelMinY.toFixed(2)}, ${modelMaxY.toFixed(2)}]`); // Log bounds
    }

    // Ensure shadows are enabled on descendants
    gltfScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    // Return the calculated data including bounds
    return {
        scene: gltfScene,
        baseScale: modelNormalizationScale,
        centerOffsetX,
        centerOffsetY,
        centerOffsetZ,
        modelMinY, // NEW
        modelMaxY  // NEW
     };
}

      
// --- GLSL Injection Function ---
function modifyMaterialForEffects(shader: { vertexShader: string; fragmentShader: string; uniforms: any }, uniforms: ObjectShaderUniforms) {
    // Add uniforms to the shader
    shader.uniforms.u_fadeProgress = uniforms.fade;
    shader.uniforms.u_waterEffectIntensity = uniforms.waterEffect; // Intensity (0 to 1, should be eased on CPU)
    shader.uniforms.u_waterProgress = uniforms.waterProgress;   // Top-to-bottom progress (0 to 1)
    shader.uniforms.u_modelMinY = uniforms.modelMinY;         // Object's min Y in model space
    shader.uniforms.u_modelMaxY = uniforms.modelMaxY;         // Object's max Y in model space
    shader.uniforms.u_waterEffectWidth = uniforms.waterEffectWidth || { value: 0.1 }; // Width of the bright band (optional uniform)

    // Inject vertex shader code
    shader.vertexShader = `
        uniform float u_fadeProgress;
        uniform float u_waterEffectIntensity;
        varying vec3 v_modelPosition; // Pass model space position
        varying float v_waterEffectIntensity; // Pass intensity to fragment shader

        ${shader.vertexShader}
    `.replace(
        `#include <begin_vertex>`,
        `#include <begin_vertex>

        v_modelPosition = position; // Pass original model position
        v_waterEffectIntensity = u_waterEffectIntensity; // Pass water intensity

        // --- Combined Scaling Effects ---
        // 1. Base scaling for watering effect (pulsing)
        float waterScaleEffect = 1.0 + u_waterEffectIntensity * 0.1;

        // 2. Scaling based on fade progress (0.0 to 1.0)
        float fadeScaleEffect = u_fadeProgress; // Directly use fade progress

        // 3. Combine the scales: Multiply the base vertex by both effects
        // Apply fade scale first, then water pulse scale on top of that
        transformed *= fadeScaleEffect;
        transformed *= waterScaleEffect; // Apply watering scale *after* fade scale
        `
    );

    // Inject fragment shader code
    shader.fragmentShader = `
        uniform float u_fadeProgress;
        uniform float u_waterEffectIntensity; // Overall eased intensity (0 -> 1 -> 0)
        uniform float u_waterProgress;      // Water line progress (0 -> 1)
        uniform float u_modelMinY;          // Model's min Y coordinate
        uniform float u_modelMaxY;          // Model's max Y coordinate
        uniform float u_waterEffectWidth;   // Width of the effect band (e.g., 0.1 for 10% of height)

        varying vec3 v_modelPosition;       // Received model space position
        varying float v_waterEffectIntensity; // Received overall eased intensity

        // Helper function for safe normalization
        float safeNormalize(float value, float minVal, float maxVal) {
            float range = maxVal - minVal;
            // Avoid division by zero for flat objects or invalid bounds
            if (range < 0.0001) return 0.5; // Or 0.0 or 1.0 depending on desired behavior
            return clamp((value - minVal) / range, 0.0, 1.0);
        }

        ${shader.fragmentShader}
    `.replace(
        `#include <dithering_fragment>`, // A common place to modify final color/alpha
        `#include <dithering_fragment>

        // --- Watering Brightness Effect (Top-to-Bottom) ---

        // 1. Normalize the fragment's vertical position (0 = bottom, 1 = top)
        float normalizedY = safeNormalize(v_modelPosition.y, u_modelMinY, u_modelMaxY);

        // 2. Determine the current "water line" position (normalized, 1 = top, 0 = bottom)
        float waterLine = 1.0 - u_waterProgress; // As progress increases, waterLine decreases

        // 3. Calculate how much this fragment should be affected based on its proximity to the water line
        // Use smoothstep for a soft band around the water line
        float lowerEdge = waterLine - u_waterEffectWidth * 0.5;
        float upperEdge = waterLine + u_waterEffectWidth * 0.5;
        float positionalIntensity = smoothstep(lowerEdge, waterLine, normalizedY) - smoothstep(waterLine, upperEdge, normalizedY);
        // Clamp to ensure it doesn't go negative due to float precision
        positionalIntensity = clamp(positionalIntensity, 0.0, 1.0);


        // 4. Calculate the final brightness boost:
        // Modulate the overall (eased) effect intensity by the positional intensity
        float brightnessBoost = 1.0 + (v_waterEffectIntensity * positionalIntensity * 0.5); // e.g., 50% brighter at peak

        // Apply brightness boost
        gl_FragColor.rgb *= brightnessBoost;


        // --- Fade Effect (applied to alpha) ---
        gl_FragColor.a *= u_fadeProgress;

        // Discard pixel entirely if fully faded (optional optimization)
        if (gl_FragColor.a < 0.01) discard;
        `
    );
}
// --- End GLSL Injection ---

/**
* Finds the appropriate growth stage configuration based on the plant's current progress.
*/
function getGrowthStageConfig(plantInfo: PlantInfo): GrowthStage | null {
    const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
    if (!config.growthStages || config.growthStages.length === 0) {
        console.error(`Plant type ${plantInfo.plantTypeId} missing growthStages configuration.`);
        return null;
    }

    // Ensure stages are sorted by maxGrowth (important!)
    // Do this once at load time ideally, but for safety check here too or assume pre-sorted
    const sortedStages = config.growthStages.sort((a, b) => a.maxGrowth - b.maxGrowth);

    // Find the first stage where the plant's progress is less than or equal to the stage's maxGrowth
    const stage = sortedStages.find(s => plantInfo.growthProgress <= s.maxGrowth);

    if (stage) {
        return stage;
    } else {
        // If progress is somehow > 1.0 or config doesn't cover 1.0, return the last stage
        console.warn(`Could not find growth stage for progress ${plantInfo.growthProgress.toFixed(2)} for ${plantInfo.plantTypeId}. Using last stage.`);
        return sortedStages[sortedStages.length - 1];
    }
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

// --- Helper function to stop animation for a specific uniform ---
function stopAnimationForUniform(uniform: { value: number }) {
    const index = activeAnimations.findIndex(a => a.uniform === uniform);
    if (index > -1) {
        activeAnimations.splice(index, 1);
    }
}

/**
 * Swaps the 3D model for a plant instance.
 * Removes the old model, clones the new one, adds it, and updates plantInfo.
 * Assumes the new modelPath exists in gltfCache.
 */
 function swapPlantModel(plantInfo: PlantInfo, newModelPath: string): boolean {
    if (!plantInfo) {
        console.error("swapPlantModel: Invalid plantInfo provided.");
        return false;
    }

    const oldObject = plantInfo.object3D;
    const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;

    // --- 1. Get New Model Data ---
    const cachedGltfData = gltfCache[newModelPath];
    if (!cachedGltfData || !cachedGltfData.scene) {
        console.error(`swapPlantModel: Cached GLTF scene missing for new model ${newModelPath}. Cannot swap.`);
        return false;
    }

    // --- 2. Remove and Dispose Old Model (if exists) ---
    if (oldObject) {
        // --- Stop animations associated with the OLD object ---
        if (plantInfo.shaderUniforms) {
            console.log(`   Clearing animations for old model of ${plantInfo.plantTypeId}`);
            Object.values(plantInfo.shaderUniforms).forEach(uniforms => {
                stopAnimationForUniform(uniforms.fade);
                stopAnimationForUniform(uniforms.waterEffect);
                stopAnimationForUniform(uniforms.waterProgress);
                // Add any other animated uniforms here
            });
        }
        scene.remove(oldObject); // Remove from scene first

        // Dispose geometry and materials of the old object
        oldObject.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry?.dispose();
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => {
                        Object.keys(mat).forEach(key => {
                            const value = mat[key as keyof THREE.Material];
                            if (value instanceof THREE.Texture) {
                                value.dispose();
                            }
                        });
                        mat.dispose();
                    });
                }
            }
        });
         console.log(`   Disposed old model for ${plantInfo.plantTypeId}`);
        plantInfo.object3D = null; // Clear reference temporarily
        plantInfo.originalMaterialColors = undefined; // Clear old color map
        plantInfo.shaderUniforms = undefined; // Clear old shader uniforms map too
    } else {
         console.warn(`swapPlantModel: Plant ${plantInfo.plantTypeId} had no existing object3D to remove.`);
    }

    // --- 3. Clone New Model ---
    const newObject = SkeletonUtils.clone(cachedGltfData.scene) as THREE.Group;
    newObject.visible = true; // Ensure visibility

    // --- 4. Update PlantInfo ---
    plantInfo.object3D = newObject; // Assign new model
    // Link back userData
    newObject.userData.gridInfo = plantInfo;
    newObject.userData.objectType = 'plant';
    newObject.userData.typeId = plantInfo.plantTypeId;

    // --- 5. Rebuild Material Map & Apply Visuals ---
    // Rebuild map *before* applying tint in updatePlantVisuals
    rebuildOriginalMaterialColors(plantInfo, newModelPath);
    // --- 6. Add New Model to Scene ---
    scene.add(newObject); // Add to scene BEFORE first visual update

    // --- 7. Update Visuals (Position, Scale, AND Tint) for the NEW model ---
    // This call now happens AFTER rebuild and AFTER adding to scene.
    // It will use the newly rebuilt originalMaterialColors and the current plantInfo.state
    updatePlantVisuals(plantInfo);
    console.log(`   Successfully swapped to model ${newModelPath} for ${plantInfo.plantTypeId}`);
    requestRender(); // Ensure the newly swapped and positioned model is drawn
    return true; // Success
}

/**
* Updates the Transform and Material properties for a specific plant's Object3D.
* Uses the model defined by the current growth stage.
*/
function updatePlantVisuals(plantInfo: PlantInfo) {
    const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;

    // --- Determine Current Stage and Model ---
    const currentStage = getGrowthStageConfig(plantInfo);
    if (!currentStage || !currentStage.modelPath) {
        // console.warn(`Cannot update visuals for plant ${plantInfo.plantTypeId}: Could not determine growth stage or model path.`); // Less noisy log
        // Make object invisible if stage is invalid?
        if (plantInfo.object3D) plantInfo.object3D.visible = false;
        return;
    }
    if (!plantInfo.object3D) {
        // console.warn(`Cannot update visuals for plant at [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}]: Missing object3D.`); // Less noisy log
        return;
    }

    // --- Get Cached Data for the CURRENT Model ---
    const cachedGltfData = gltfCache[currentStage.modelPath];
    if (!cachedGltfData) {
        console.warn(`Cannot update visuals for plant ${plantInfo.plantTypeId}: Missing cached GLTF data for current stage model ${currentStage.modelPath}. Hiding object.`);
        plantInfo.object3D.visible = false; // Hide if cache is missing
        return;
    }
    plantInfo.object3D.visible = true; // Ensure visible if cache was found


    // --- 1. Calculate Transformation ---

    // Calculate the desired *overall visual scale multiplier* based on growth progress,
    // relative to the CELL_SIZE.
    const currentOverallMultiplier = MathUtils.lerp(config.initialScale, config.maxScale, plantInfo.growthProgress);

    // Calculate the target world size based on the multiplier and cell size.
    // For multi-cell plants, using CELL_SIZE as the base unit for the multiplier might still be okay,
    // as the overall placement is centered correctly. Alternatively, you could use
    // CELL_SIZE * Math.max(config.size.rows, config.size.cols) if you want the multiplier
    // relative to the plant's full footprint. Let's stick with CELL_SIZE for now.
    const targetVisualSize = currentOverallMultiplier * CELL_SIZE * Math.max(config.size.rows, config.size.cols);

    // Get the normalization scale for the *current model* (makes its max dim = 1.0)
    const modelNormalizationScale = cachedGltfData.baseScale;

    // The final scale combines the model's normalization with the desired visual size
    const finalScale = modelNormalizationScale * targetVisualSize;

    // Calculate world position for the center of the plant's grid area
    const worldPosCenter = gridAreaCenterToWorld(plantInfo.gridPos.row, plantInfo.gridPos.col, plantInfo.size.rows, plantInfo.size.cols);

    // Apply the pre-calculated centering offsets *from the current model's cached data*.
    // IMPORTANT: These offsets were calculated for the *unscaled* model.
    // We need to multiply them by the *finalScale* to apply them correctly to the scaled object.
    const offsetX = cachedGltfData.centerOffsetX * finalScale;
    const offsetY = cachedGltfData.centerOffsetY * finalScale; // This places the calculated base (min.y) at y=0
    const offsetZ = cachedGltfData.centerOffsetZ * finalScale;

    plantInfo.object3D.position.set(
        worldPosCenter.x + offsetX,
        worldPosCenter.y + offsetY, // Apply the scaled Y offset
        worldPosCenter.z + offsetZ
    );
    plantInfo.object3D.scale.set(finalScale, finalScale, finalScale);
    // plantInfo.object3D.rotation.set(0, 0, 0); // Keep existing rotation

    // --- 2. Update Material Color (Tinting) ---
    const targetColor = plantInfo.state === 'needs_water'
        ? (config.thirstyColorTint ?? new THREE.Color(0xaaaaaa))
        : (config.healthyColorTint ?? new THREE.Color(0xffffff));

    if (!plantInfo.originalMaterialColors) {
        console.warn(`Plant ${plantInfo.plantTypeId} at [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] missing originalMaterialColors map for tinting. Rebuilding...`);
        rebuildOriginalMaterialColors(plantInfo, currentStage.modelPath); // Assuming currentStage.modelPath is correct
        if (!plantInfo.originalMaterialColors) {
            console.error(`   Failed to rebuild originalMaterialColors. Tinting skipped.`);
            return; // Skip tinting if rebuild failed
        }
    }

    plantInfo.object3D.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
                // *** MODIFIED CONDITION BELOW ***
                if (plantInfo.originalMaterialColors!.has(mat) &&
                    (mat instanceof THREE.MeshStandardMaterial || // Keep for potential fallback/mixed materials
                    mat instanceof THREE.MeshBasicMaterial ||   // Keep for potential fallback/mixed materials
                    mat instanceof THREE.MeshToonMaterial)) { // *** ADDED THIS CHECK ***

                    const originalColor = plantInfo.originalMaterialColors!.get(mat)!;
                    tempColor.copy(originalColor).multiply(targetColor); // Tinting logic remains the same

                    // Check if update is needed to avoid unnecessary work
                    if (!mat.color.equals(tempColor)) {
                        mat.color.copy(tempColor);
                        mat.needsUpdate = true; // Good practice, though THREE often detects changes
                    }
                } else if (mat instanceof THREE.MeshToonMaterial) { // Added for debugging: is it a Toon material not in the map?
                    // This might indicate an issue in rebuildOriginalMaterialColors if it logs frequently
                    // console.warn(`Toon Material on ${plantInfo.plantTypeId} not found in originalMaterialColors map during tinting. UUID: ${mat.uuid}`);
                }
                // We don't need an else if for standard/basic here as the primary if handles them if they ARE in the map.
            });
        }
    });
}
// --- End Function to Update Plant Visuals ---

// --- Placeholder updateDecorVisuals (adapt as needed) ---
function updateDecorVisuals(decorInfo: DecorInfo) {
    if (!decorInfo.object3D) return;

    const config = decorConfigs[decorInfo.decorTypeId];
    if (!config) return;
    const cachedGltfData = gltfCache[config.modelPath];
    if (!cachedGltfData) {
        console.warn(`Cannot update visuals for decor ${decorInfo.decorTypeId}: Missing cached GLTF data for model ${config.modelPath}. Hiding object.`);
        if (decorInfo.object3D) decorInfo.object3D.visible = false;
        return;
    }
    if (decorInfo.object3D) decorInfo.object3D.visible = true;

    // --- 1. Calculate Transformation ---

    // Get the desired relative scale multiplier from decor config
    const baseMultiplier = config.baseScale ?? 1.0;

    // Calculate the base world size of the decor's grid footprint using the instance's size
    const baseOccupancyWorldSize = Math.max(decorInfo.size.rows, decorInfo.size.cols) * CELL_SIZE;

    // Calculate the target absolute world size based on multiplier and footprint
    const targetVisualSize = baseMultiplier * baseOccupancyWorldSize;

    // Get the model's normalization scale (makes its max dim = 1.0)
    const modelNormalizationScale = cachedGltfData.baseScale;

    // Calculate the final scale: model norm scale * target absolute world size
    const finalScale = modelNormalizationScale * targetVisualSize;

    // Calculate world position for the center of the decor's grid area
    const worldPosCenter = gridAreaCenterToWorld(decorInfo.gridPos.row, decorInfo.gridPos.col, decorInfo.size.rows, decorInfo.size.cols);

    // Apply the pre-calculated centering offsets *multiplied by the finalScale*
    const offsetX = cachedGltfData.centerOffsetX * finalScale;
    const offsetY = cachedGltfData.centerOffsetY * finalScale;
    const offsetZ = cachedGltfData.centerOffsetZ * finalScale;

    decorInfo.object3D.position.set(
        worldPosCenter.x + offsetX,
        worldPosCenter.y + offsetY,
        worldPosCenter.z + offsetZ
    );
    decorInfo.object3D.scale.set(finalScale, finalScale, finalScale);
	decorInfo.object3D.rotation.set(0, decorInfo.rotationY, 0);
}

// --- Easing Functions ---
const linearEase = (t: number): number => t;
const cubicOutEase = (t: number): number => 1 - Math.pow(1 - t, 3);
const power1InEase = (t: number): number => t * t; // Example for the down-part of ping pong if needed

// --- Animation Helpers (Modified) ---

// Helper to start an animation
function animateUniform(
    uniform: { value: number },
    targetValue: number,
    duration: number,
    ease: (t: number) => number = linearEase, // Default to linear
    onComplete?: () => void
) {
    const existingIndex = activeAnimations.findIndex(a => a.uniform === uniform);
    if (existingIndex > -1) activeAnimations.splice(existingIndex, 1);

    activeAnimations.push({
        uniform,
        targetValue,
        startValue: uniform.value,
        duration,
        startTime: performance.now(),
        onComplete,
        ease // Store the ease function
    });
    startRenderLoop();
}

// Helper for ping-pong effect (0 -> peak -> 0)
function animateUniformPingPong(
    uniform: { value: number },
    peakValue: number,
    duration: number, // Total duration for 0 -> peak -> 0
    easeUp: (t: number) => number = cubicOutEase, // Ease for 0 -> peak
    easeDown: (t: number) => number = power1InEase, // Ease for peak -> 0
    onComplete?: () => void
) {
    const existingIndex = activeAnimations.findIndex(a => a.uniform === uniform);
    if (existingIndex > -1) activeAnimations.splice(existingIndex, 1);

    const halfDuration = duration / 2;
    uniform.value = 0.0; // Ensure start at 0

    // Phase 1: 0 -> peak
    activeAnimations.push({
        uniform,
        targetValue: peakValue,
        startValue: 0.0,
        duration: halfDuration,
        startTime: performance.now(),
        isPingPong: true,
        pingPongReachedPeak: false,
        ease: easeUp, // Use easeUp for first half
        // onComplete will be handled by phase 2
    });
    startRenderLoop();
}

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

// --- Helper Function to Update Decor Lights based on Time ---
function updateDecorLightsForTime(isNight: boolean) {
    // Determine if it's generally "night" based on cycleProgress or isNight flag
    // const isNight = (cycleProgress < SUNRISE_START_POINT || cycleProgress >= SUNSET_END_POINT);

    for (const decorInfo of allDecor) {
        if (!decorInfo.lightMap || decorInfo.lightMap.size === 0) continue; // Skip if no lights

        const config = decorConfigs[decorInfo.decorTypeId];
        if (!config || !config.pointLightDefinitions) continue; // Skip if config missing

        // Iterate through the lights managed by this decor object
        for (const [emptyName, light] of decorInfo.lightMap.entries()) {
            const lightProps = config.pointLightDefinitions[emptyName];
            if (!lightProps) continue; // Should not happen if map is built correctly

            let targetIntensity = lightProps.intensity ?? 1.0; // Default intensity from config
            let targetVisible = true;

            // Apply custom logic (e.g., night-only lights)
            if (lightProps.activeAtNightOnly) {
                if (!isNight) {
                    targetVisible = false;
                    targetIntensity = 0; // Ensure intensity is zero when off
                }
                // Keep config intensity if it *is* night
            }

            // --- Apply the changes ---
            // Only update if necessary to avoid redundant property sets
            if (light.intensity !== targetIntensity) {
                light.intensity = targetIntensity;
            }
            if (light.visible !== targetVisible) {
                light.visible = targetVisible;
                // If turning shadows on/off dynamically, you might need:
                if (lightProps.castShadow) light.castShadow = targetVisible;
            }
        }
    }
}

// function for Day Night cycle
// --- Main Update Function ---
function updateDayNightCycle(currentTime: Date) {
    if (!directionalLight || !ambientLight || !hemisphereLight || !scene) return;

    const cycleProgress = (currentTime.getHours() + currentTime.getMinutes() / 60 + currentTime.getSeconds() / 3600) / 24;
    const isNight = (cycleProgress < SUNRISE_START_POINT || cycleProgress >= SUNSET_END_POINT);

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
    directionalLight.castShadow = !isNight;

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

    // --- NEW: Update Decor Lights based on time ---
    updateDecorLightsForTime(isNight); // Pass necessary info

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

// --- Function to Remove Grid Object (Modified for Fade Out) ---
function removeGridObjectAt(row: number, col: number) {
    const gridObjectInfo = getGridObjectInfoAt(row, col);

    if (!gridObjectInfo || !gridObjectInfo.object3D || !gridObjectInfo.shaderUniforms) {
        console.log(`No object with shader uniforms found at [${row}, ${col}] to fade out and remove.`);
        // Optionally, add logic here to remove objects without shaders immediately
        if (gridObjectInfo) {
             // Fallback to immediate removal if needed
             performImmediateRemoval(gridObjectInfo);
        }
        return;
    }

    const objectToRemove = gridObjectInfo;
    const objectType = 'plantTypeId' in objectToRemove ? 'plant' : 'decor';
    const typeId = objectType === 'plant' ? (objectToRemove as PlantInfo).plantTypeId : (objectToRemove as DecorInfo).decorTypeId;

    console.log(`Starting fade-out for ${objectType} ${typeId} at [${objectToRemove.gridPos.row}, ${objectToRemove.gridPos.col}]`);

    const FADE_OUT_DURATION = 400; // ms
    let animationsPending = 0;

    // --- Callback after ALL fade animations for this object complete ---
    const onFadeComplete = () => {
        animationsPending--;
        if (animationsPending <= 0) {
            console.log(`Fade out complete for ${typeId}, proceeding with removal.`);
            performImmediateRemoval(objectToRemove); // Call the actual removal logic
        }
    };

    // --- Start fade-out for all materials ---
    Object.values(objectToRemove.shaderUniforms ?? {}).forEach(uniforms => {
        if (uniforms.fade.value > 0.01) {
            animationsPending++;
            // Animate fade uniform with easing (e.g., cubic in or power1In)
            animateUniform(uniforms.fade, 0.0, FADE_OUT_DURATION, power1InEase, onFadeComplete);
        }
    });

    if (animationsPending === 0) {
        // No materials needed fading (already faded or none found)
        console.log(`No fade animation needed for ${typeId}, removing immediately.`);
        performImmediateRemoval(objectToRemove);
    }
    // IMPORTANT: The rest of the removal logic is now in performImmediateRemoval
}

// --- Helper for the actual removal steps (called after fade-out) ---
function performImmediateRemoval(objectToRemove: PlantInfo | DecorInfo) {
    const objectType = 'plantTypeId' in objectToRemove ? 'plant' : 'decor';
    const typeId = objectType === 'plant' ? (objectToRemove as PlantInfo).plantTypeId : (objectToRemove as DecorInfo).decorTypeId;
    const gridPos = objectToRemove.gridPos; // Capture before potential modification

    console.log(`Performing immediate removal of ${typeId} at [${gridPos.row}, ${gridPos.col}]`);

    // --- 1. Remove Object3D from Scene and Dispose ---
    if (objectToRemove.object3D) {
        // Handle Decor Lights
        if (objectType === 'decor') {
            // --- Handle Lights BEFORE removing main object ---
            if (objectType === 'decor') {
                const decorInfo = objectToRemove as DecorInfo;
                if (decorInfo.lightObjects && decorInfo.lightObjects.length > 0) {
                    console.log(`   Disposing ${decorInfo.lightObjects.length} associated point lights.`);
                    decorInfo.lightObjects.forEach(light => {
                        // PointLights don't have geometry/material, but calling dispose is harmless
                        // and good practice in case future Three.js versions add something.
                        light.dispose(); // Technically optional for PointLight
                        // The light will be removed from the scene when its parent is removed.
                    });
                    decorInfo.lightObjects = []; // Clear the array
                    decorInfo.lightMap?.clear(); // Clear the map
                }
            }
            // --- End Light Handling ---
        }
        scene.remove(objectToRemove.object3D);
        // Dispose geometry and materials
        objectToRemove.object3D.traverse((child) => {
             if (child instanceof THREE.Mesh) {
                child.customDepthMaterial?.dispose();
                child.geometry?.dispose();
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => {
                        // Dispose textures
                        Object.keys(mat).forEach(key => {
                            const value = mat[key as keyof THREE.Material];
                            if (value instanceof THREE.Texture) value.dispose();
                        });
                        mat.dispose(); // Dispose material
                    });
                }
            }
        });
        console.log(`   Removed and disposed object3D for ${typeId}`);
        objectToRemove.object3D = null;
    } else {
         console.warn(`   Object ${typeId} at [${gridPos.row}, ${gridPos.col}] had no object3D reference.`);
    }

    // --- 2. Remove from Tracking Sets ---
    if (objectType === 'plant') {
        allPlants.delete(objectToRemove as PlantInfo);
        updatablePlants.delete(objectToRemove as PlantInfo);
    } else {
        allDecor.delete(objectToRemove as DecorInfo);
    }

    // --- 3. Clear Grid Data ---
    const { size } = objectToRemove;
    for (let rOffset = 0; rOffset < size.rows; rOffset++) {
        for (let cOffset = 0; cOffset < size.cols; cOffset++) {
            const targetRow = gridPos.row + rOffset;
            const targetCol = gridPos.col + cOffset;
            if (targetRow >= 0 && targetRow < GRID_DIVISIONS && targetCol >= 0 && targetCol < GRID_DIVISIONS) {
                const cell = gardenGrid[targetRow]?.[targetCol];
                if (cell === objectToRemove || (cell && 'pointerTo' in cell && cell.pointerTo.row === gridPos.row && cell.pointerTo.col === gridPos.col)) {
                    gardenGrid[targetRow][targetCol] = null;
                }
            }
        }
    }

    // --- 4. Save State ---
    debouncedSaveGardenState();
    // No render request needed here, object is gone.
}

// --- Helper to rebuild original material colors AND ensure unique instances ---
function rebuildOriginalMaterialColors(objectInfo: PlantInfo | DecorInfo, modelPath: string) {
    if (!objectInfo.object3D) {
        console.warn(`Cannot rebuild materials for object at [${objectInfo.gridPos.row}, ${objectInfo.gridPos.col}]: object3D is null.`);
        return;
    }
    const cachedGltfData = gltfCache[modelPath];
    if (!cachedGltfData) {
        console.error(`rebuildOriginalMaterialColors: Missing cached data for model ${modelPath}. Cannot setup shaders correctly.`);
        return;
    }

    const objectType = 'plantTypeId' in objectInfo ? 'plant' : 'decor';
    const typeId = objectType === 'plant' ? (objectInfo as PlantInfo).plantTypeId : (objectInfo as DecorInfo).decorTypeId;

    // Initialize or clear maps
    objectInfo.shaderUniforms = {};
    if (objectType === 'plant') {
        (objectInfo as PlantInfo).originalMaterialColors = new Map<THREE.Material, THREE.Color>();
    }

    console.log(`Rebuilding unique materials & shaders for ${typeId} [${objectInfo.gridPos.row}, ${objectInfo.gridPos.col}] using model ${modelPath}`);

    objectInfo.object3D.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
            const originalMaterials = Array.isArray(child.material) ? child.material : [child.material];
            const newMaterials: THREE.Material[] = [];
            let materialsChanged = false;

            originalMaterials.forEach(originalMat => {
                if (originalMat instanceof THREE.MeshStandardMaterial ||
                originalMat instanceof THREE.MeshBasicMaterial ||
                originalMat instanceof THREE.MeshPhysicalMaterial // Add others if needed
                ) {
                    // --- Create NEW MeshToonMaterial ---
                    const toonMaterial = new THREE.MeshToonMaterial();

                    // --- Copy Essential Properties from Original ---
                    toonMaterial.color.copy(originalMat.color);
                    toonMaterial.map = originalMat.map; // Copy texture map if it exists
                    // Copy other maps if your models use them (normal, ao, emissive, etc.)
                    // toonMaterial.normalMap = (originalMat as THREE.MeshStandardMaterial).normalMap;
                    // toonMaterial.aoMap = (originalMat as THREE.MeshStandardMaterial).aoMap;
                    // ... etc.

                    toonMaterial.name = originalMat.name + '_toon'; // Optional: for debugging
                    toonMaterial.side = originalMat.side; // Important if using DoubleSide etc.
                    toonMaterial.transparent = true; // REQUIRED for fade/shader effects
                    toonMaterial.wireframe = originalMat.wireframe;
                    toonMaterial.gradientMap = toonGradientMap;

                    // --- Store Original Color for Tinting (Plants Only) ---
                    if (objectType === 'plant') {
                        // Store the toon material instance and its base color
                        (objectInfo as PlantInfo).originalMaterialColors!.set(toonMaterial, toonMaterial.color.clone());
                    }

                    // --- Create ALL Shader Uniforms for THIS Toon material instance ---
                    const uniforms: ObjectShaderUniforms = {
                        fade: { value: 1.0 },
                        waterEffect: { value: 0.0 },
                        waterProgress: { value: 0.0 },
                        modelMinY: { value: cachedGltfData.modelMinY },
                        modelMaxY: { value: cachedGltfData.modelMaxY },
                        waterEffectWidth: { value: 0.15 } // Example value
                    };
                    // Store uniforms keyed by the NEW toonMaterial's UUID
                    objectInfo.shaderUniforms![toonMaterial.uuid] = uniforms;

                    // --- Setup Main Material Shader (onBeforeCompile on the Toon Material) ---
                    toonMaterial.onBeforeCompile = (shader) => {
                        console.log(`Applying onBeforeCompile to TOON material ${toonMaterial.uuid} for ${typeId}`);
                        // Pass the uniforms object created above
                        modifyMaterialForEffects(shader, uniforms);
                    };

                    // Mark for recompilation
                    toonMaterial.needsUpdate = true;

                    // Add the new toon material to the list for this mesh
                    newMaterials.push(toonMaterial);
                    materialsChanged = true;

                    // --- Create Custom Shadow Material (Logic remains similar) ---
                    // Still use MeshDepthMaterial for shadows
                    const shadowMaterial = new THREE.MeshDepthMaterial({
                        depthPacking: THREE.RGBADepthPacking,
                        // alphaTest: 0.01 // Potentially needed if fade creates transparent holes
                    });
                    // Link shadow material name to the TOON material's UUID for easier debugging
                    shadowMaterial.name = `shadowMat_${toonMaterial.uuid}`;

                    // --- Setup Shadow Material Shader (using the SAME uniforms instance) ---
                    shadowMaterial.onBeforeCompile = (shader) => {
                        console.log(`Applying onBeforeCompile to SHADOW material for ${typeId} (linked to toon ${toonMaterial.uuid})`);
                        if (uniforms && uniforms.fade && uniforms.waterEffect) {
                            shader.uniforms.u_fadeProgress = uniforms.fade;
                            shader.uniforms.u_waterEffectIntensity = uniforms.waterEffect;
                            shader.vertexShader = `
                                uniform float u_fadeProgress;
                                uniform float u_waterEffectIntensity;
                                ${shader.vertexShader}
                            `.replace(
                                `#include <begin_vertex>`,
                                `#include <begin_vertex>
                                float waterScaleEffect = 1.0 + u_waterEffectIntensity * 0.1;
                                float fadeScaleEffect = u_fadeProgress;
                                transformed *= fadeScaleEffect;
                                transformed *= waterScaleEffect;
                                `
                            );
                        } else {
                            console.error(`!!! Critical Error: Could not link shadow uniforms via closure for toon mat ${toonMaterial.uuid}.`);
                        }
                    };
                    shadowMaterial.needsUpdate = true;

                    // Assign shadow material
                    child.customDepthMaterial = shadowMaterial;

                } else {
                    // Keep non-standard materials (e.g., LineBasicMaterial, PointsMaterial) as they are
                    console.log(`Keeping original material type for mesh ${child.name}: ${originalMat.type}`);
                    newMaterials.push(originalMat);
                }
                }); // End originalMaterials.forEach

            if (materialsChanged) {
                child.material = Array.isArray(child.material) ? newMaterials : newMaterials[0];
            }
        } // End if child is Mesh
    }); // End objectInfo.object3D.traverse

    const uniformCount = Object.keys(objectInfo.shaderUniforms).length;
    console.log(`   Finished rebuilding. Stored ${uniformCount} shader uniforms.`);
    if (objectType === 'plant') {
         console.log(`   Stored original colors for ${(objectInfo as PlantInfo).originalMaterialColors!.size} unique materials.`);
    }
}

// --- NEW HELPER FUNCTION ---
// Sets the initial state of lights for a *single* DecorInfo object
function setInitialDecorLightState(decorInfo: DecorInfo, isNight: boolean) {
    if (!decorInfo.lightMap || decorInfo.lightMap.size === 0) return;

    const config = decorConfigs[decorInfo.decorTypeId];
    if (!config || !config.pointLightDefinitions) return;

    for (const [emptyName, light] of decorInfo.lightMap.entries()) {
        const lightProps = config.pointLightDefinitions[emptyName];
        if (!lightProps) continue;

        let targetIntensity = lightProps.intensity ?? 1.0;
        let targetVisible = true;

        if (lightProps.activeAtNightOnly && !isNight) {
            targetVisible = false;
            targetIntensity = 0;
        }

        // Directly set the initial state
        light.intensity = targetIntensity;
        light.visible = targetVisible;
        if (lightProps.castShadow) light.castShadow = targetVisible; // Also set initial shadow state
    }
}

/// --- Function to Place Grid Object (REWRITTEN - With Point Light Creation) ---
function placeGridObjectAt(row: number, col: number, objectType: 'plant' | 'decor', typeId: string, initialState?: Partial<PlantInfo | DecorInfo>) {
    // --- Asset Check ---
    if (!assetsLoaded) {
        console.warn(`Assets not loaded yet. Cannot place ${typeId}.`);
        return;
    }

    // --- Get Config and Model Path ---
    let config: PlantConfig | DecorConfig | undefined;
    let modelPath: string | undefined;
    let objectSize: { rows: number; cols: number };

    if (objectType === 'plant') {
        config = plantConfigs[typeId];
        if (!config) {
            console.error(`No plant config found for id ${typeId}`); return;
        }
        // Determine initial stage based on potential initialState or default 0.0
        const initialProgress = (initialState as PlantInfo)?.growthProgress ?? 0.0;
        // Create a temporary PlantInfo-like object just for getting the stage
        const tempInfo = { plantTypeId: typeId, growthProgress: initialProgress } as PlantInfo;
        const initialStage = getGrowthStageConfig(tempInfo);
        if (!initialStage || !initialStage.modelPath) {
             console.error(`Could not determine initial growth stage or model path for ${typeId} at progress ${initialProgress}.`);
             return;
        }
        modelPath = initialStage.modelPath;
        objectSize = config.size;
    } else { // Decor
        config = decorConfigs[typeId];
         if (!config) {
            console.error(`No decor config found for id ${typeId}`); return;
        }
        modelPath = config.modelPath;
        objectSize = config.size;
    }

    if (!modelPath) { // Should be caught above, but safety check
        console.error(`No modelPath determined for ${objectType} ${typeId}`); return;
    }

    const cachedGltfData = gltfCache[modelPath];
    if (!cachedGltfData || !cachedGltfData.scene) {
        console.error(`Cached GLTF scene missing for ${typeId} using model ${modelPath}. Cannot place.`);
        // TODO: Optionally create a placeholder object here
        return;
    }
    // --- End Config/Model Path ---


	// --- Check Free Space ---
    if (!isAreaFree(row, col, objectSize.rows, objectSize.cols)) {
        console.log(`Cannot place ${typeId} of size ${objectSize.rows}x${objectSize.cols} at [${row}, ${col}], area not free.`);
		hidePreviewBox(); // Hide preview if shown
        if (!isRenderLoopActive) requestRender(); // Ensure preview hide is rendered if needed
        return;
    }

    // --- 1. Clone the GLTF Scene ---
    const clonedObject = SkeletonUtils.clone(cachedGltfData.scene);
    clonedObject.visible = true;

    // --- 2. Create PlantInfo / DecorInfo ---
    const now = Date.now();
    let newGridObject: PlantInfo | DecorInfo;

    if (objectType === 'plant') {
        const plantConfig = config as PlantConfig;
        const originalMaterialColors = new Map<THREE.Material, THREE.Color>(); // Reset for this new object
        const newPlant: PlantInfo = {
            plantTypeId: typeId,
            state: 'healthy',
            growthProgress: 0.0, // Default, will be overwritten by initialState if provided
            lastUpdateTime: now,
            lastWateredTime: now,
            size: { ...objectSize },
            gridPos: { row, col },
            object3D: clonedObject as THREE.Group,
            originalMaterialColors: originalMaterialColors,
            ...(initialState as Partial<PlantInfo>) // Apply loaded state (overwrites defaults)
        };
        newGridObject = newPlant;
        allPlants.add(newPlant);
        if (newPlant.state === 'healthy' && newPlant.growthProgress < 1.0) {
            updatablePlants.add(newPlant);
        }
    } else { // objectType === 'decor'
        const decorConfig = config as DecorConfig;
        const loadedState = initialState as Partial<DecorInfo>; // Cast for easier access
        const rotationY = loadedState?.rotationY ?? decorConfig.defaultRotationY ?? 0;
        const newDecor: DecorInfo = {
            decorTypeId: typeId,
            size: { ...objectSize },
            gridPos: { row, col },
            rotationY: rotationY,
            object3D: clonedObject as THREE.Group,
            // Initialize light arrays/maps
            lightObjects: [], // Ensure it's always a fresh array
            lightMap: new Map<string, THREE.PointLight>(), // Ensure it's always a fresh Map
        };
        newGridObject = newDecor;
        allDecor.add(newDecor);
    }

    // --- Store reference from Object3D back to the info ---
    clonedObject.userData.gridInfo = newGridObject;
    clonedObject.userData.objectType = objectType;
    clonedObject.userData.typeId = typeId;

    // --- 3. Update Grid & Pointers ---
    // (Keep existing logic for placing main object and pointers)
    gardenGrid[row][col] = newGridObject;
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

    // --- 4. Rebuild Materials & Set Initial Transform ---
    rebuildOriginalMaterialColors(newGridObject, modelPath); // Apply shader mods & store uniforms

    // Set initial visual state (scale, position, rotation, tint)
    if (objectType === 'plant') {
        updatePlantVisuals(newGridObject as PlantInfo);
    } else {
        updateDecorVisuals(newGridObject as DecorInfo);
    }

    // --- 5. Add to Scene ---
    scene.add(clonedObject);
    console.log(`Placed ${objectType} ${typeId} (Model: ${modelPath}) at [${row}, ${col}]`);

    // --- 6. *** NEW: Create and Place Point Lights (for Decor only) *** ---
    if (objectType === 'decor') {
        const decorInfo = newGridObject as DecorInfo;
        const decorConfig = config as DecorConfig;

        if (decorInfo.object3D && decorConfig.pointLightDefinitions) {
            console.log(`   Searching for light sources in ${typeId}...`);
            const lightsToAdd: THREE.PointLight[] = []; // Collect lights before adding

            decorInfo.object3D.traverse((node) => {
                // Check if the node's name is a key in our light definitions
                if (node.isObject3D && decorConfig.pointLightDefinitions![node.name]) {
                    const lightProps = decorConfig.pointLightDefinitions![node.name];
                    console.log(`   Found light source Empty: "${node.name}"`);

                    // Create the PointLight using config properties
                    const light = new THREE.PointLight(
                        lightProps.color ?? 0xffffff,
                        lightProps.intensity ?? 1.0,
                        lightProps.distance ?? 0,
                        lightProps.decay ?? 2
                    );

                    // --- Positioning Strategy ---
                    // Add the light as a child of the *found Empty node*.
                    // This ensures the light inherits the Empty's exact transformation
                    // relative to the parent decor object.
                    node.add(light); // Add light as child of the Empty

                    // Configure shadows (use sparingly!)
                    if (lightProps.castShadow) {
                        light.castShadow = true;
                        // You might need to configure shadow map size, bias etc. here
                        light.shadow.mapSize.width = 128;
                        light.shadow.mapSize.height = 128;
                        light.shadow.camera.far = light.distance
                        // light.shadow.bias = -0.005; // Adjust as needed
                    }

                    // Store the light instance
                    if (!decorInfo.lightObjects) decorInfo.lightObjects = []; // Ensure array exists
                    if (!decorInfo.lightMap) decorInfo.lightMap = new Map(); // Ensure map exists
                    decorInfo.lightObjects.push(light);
                    decorInfo.lightMap.set(node.name, light);

                     // Optional: Make the original Empty invisible if it's distracting
                     // node.visible = false;

                    console.log(`     Created PointLight for "${node.name}"`, lightProps);
                }
            });
        }
        // --- Set Initial Light State *** ---
        // After creating all lights for this decor object, immediately set their
        // visibility/intensity based on the current time.
        const now = new Date();
        const cycleProgress = (now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600) / 24;
        const isNight = (cycleProgress < SUNRISE_START_POINT || cycleProgress >= SUNSET_END_POINT);
        // Call a modified version or reuse updateDecorLightsForTime logic *just for this object*
        setInitialDecorLightState(decorInfo, isNight); // Pass the newly created decorInfo
        console.log(`   Set initial light state for ${typeId} based on isNight=${isNight}`);
        // --- *** END ADDED BLOCK *** ---
    }
    // --- End Point Light Creation ---

    // --- 7. *** START FADE-IN ANIMATION *** ---
    if (newGridObject.shaderUniforms) {
        console.log(`Starting fade-in for ${typeId}`);
        const FADE_IN_DURATION = 500; // ms
        Object.values(newGridObject.shaderUniforms).forEach(uniforms => {
            uniforms.fade.value = 0.0; // Start invisible AND scale 0
            // Animate fade uniform with easing (e.g., cubic out)
            animateUniform(uniforms.fade, 1.0, FADE_IN_DURATION, cubicOutEase);
        });
    }
    // --- End Fade-In ---

    // --- 8. Save and Render ---
    if (!initialState) { // Only save/render if NOT loading from save data
        debouncedSaveGardenState();
        requestRender();
    }
}
// --- End Function to Place Grid Object ---

// --- Function to Water Plant ---
function waterPlantAt(row: number, col: number) {
	const gridObjectInfo = getGridObjectInfoAt(row, col);

	if (gridObjectInfo && 'plantTypeId' in gridObjectInfo) {
		const plantInfo = gridObjectInfo;
		console.log(`Watering plant ${plantInfo.plantTypeId} at [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}]`);
		let visualStateChanged = false;
		let timeUpdated = false;
		const now = Date.now();

		if (plantInfo.state === 'needs_water') {
			plantInfo.state = 'healthy';
            plantInfo.lastUpdateTime = now;
            plantInfo.lastWateredTime = now;
			console.log(`   Plant is now healthy.`);
			updatePlantVisuals(plantInfo); // Update visuals (handles color change)
			visualStateChanged = true;
			timeUpdated = true;

            if (plantInfo.growthProgress < 1.0) {
                 updatablePlants.add(plantInfo);
                 console.log(`   Plant added back to updatable list.`);
                 // Request render only if loop isn't active AND visual state changed
            }
		} else {
			plantInfo.lastWateredTime = now; // Reset thirst timer even if healthy
			console.log(`   Plant was already healthy, reset thirst timer.`);
			timeUpdated = true;
            // Optional: maybe a visual cue for watering a healthy plant?
		}

        // --- START WATERING ANIMATION ---
        if (plantInfo.shaderUniforms) {
             console.log(`Starting watering effect for ${plantInfo.plantTypeId}`);
             const waterAnimDuration = 1200; // Total duration in ms (e.g., 1.2 seconds)

             Object.values(plantInfo.shaderUniforms).forEach(uniforms => {
                // 1. Animate Intensity (Ping-Pong with Easing)
                // Uses cubicOut for up, power1In (t*t) for down by default
                animateUniformPingPong(uniforms.waterEffect, 1.0, waterAnimDuration);

                // 2. Animate Progress (Linear Top-to-Bottom)
                uniforms.waterProgress.value = 0.0; // Reset progress
                animateUniform(uniforms.waterProgress, 1.0, waterAnimDuration, cubicOutEase, () => {
                    // Optional: reset progress after completion if desired
                    uniforms.waterProgress.value = 0.0;
                });
             });
             // Ensure render loop runs for the animation
             startRenderLoop();
        } else {
            console.warn("Could not apply watering effect: shaderUniforms missing.");
            // Request render only if state changed but no animation started
            if(visualStateChanged && !isRenderLoopActive) requestRender();
        }
        // --- End Watering Animation --

		if (timeUpdated) {
			debouncedSaveGardenState();
		}
        // Request render if visual state changed *and* no animation was started (which calls startRenderLoop)
        if (visualStateChanged && !plantInfo.shaderUniforms && !isRenderLoopActive) {
             requestRender();
        }
	} else if (gridObjectInfo) {
         console.log(`Cannot water: object at [${row}, ${col}] is decor.`);
    } else {
        console.log(`No object found at or pointed to by [${row}, ${col}] to water.`);
    }
}
// --- End Function to Water Plant ---

// --- handleCanvasPointerDown (REWRITTEN for individual objects) ---
function handleCanvasPointerDown(event: PointerEvent) {
	if (isPointerDragging || !container || !camera || !scene) return; // Ignore if dragging UI item or refs missing

	const currentAction = get(selectedAction);
	if (currentAction?.type !== 'tool') return;

	isInteracting = true; // Mark interaction start (for tools)

	const raycaster = new THREE.Raycaster();
	const mouse = new THREE.Vector2();
	const rect = container.getBoundingClientRect();
	mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);

	// --- Target Ground + All Placed Objects ---
    const objectsToIntersect: THREE.Object3D[] = [ground];
    allPlants.forEach(p => { if (p.object3D) objectsToIntersect.push(p.object3D); });
    allDecor.forEach(d => { if (d.object3D) objectsToIntersect.push(d.object3D); });

	// Raycast against the list, check recursively INSIDE the object groups
	const intersects = raycaster.intersectObjects(objectsToIntersect, true); // true = recursive

	let interactionOccurred = false;
    let hitInfo: { info: PlantInfo | DecorInfo, type: 'plant' | 'decor' } | null = null;
    let groundHitPoint: THREE.Vector3 | null = null;

	// --- Process Intersects ---
    if (intersects.length > 0) {
        for (const intersect of intersects) {
            if (intersect.object === ground && !groundHitPoint) {
                groundHitPoint = intersect.point; // Record first ground hit
                // Don't break, an object might be closer
            } else if (intersect.object !== ground) {
                // Hit something other than ground - likely a mesh within a placed object's group
                let targetObject = intersect.object;
                let gridInfo: PlantInfo | DecorInfo | undefined;

                // Traverse up to find the parent Group with our stored gridInfo
                while (targetObject.parent && !gridInfo) {
                    targetObject = targetObject.parent;
                    gridInfo = targetObject.userData.gridInfo as (PlantInfo | DecorInfo | undefined);
                }

                if (gridInfo) {
                    // Found the main object and its associated data
                    const objectType = 'plantTypeId' in gridInfo ? 'plant' : 'decor';
                    hitInfo = { info: gridInfo, type: objectType };
                    console.log(`Raycast direct hit on ${objectType} ${gridInfo.object3D?.userData.typeId} at [${gridInfo.gridPos.row}, ${gridInfo.gridPos.col}]`);
                    break; // Found the target object group, stop searching
                } else {
                    // This shouldn't happen if userData is set correctly on placement
                    console.warn("Raycast hit an object mesh, but couldn't find parent with gridInfo:", intersect.object);
                }
            }
        } // End intersect loop
    }

    // --- Perform Action ---
    if (currentAction.toolType === 'water') {
        if (hitInfo?.type === 'plant') {
            waterPlantAt(hitInfo.info.gridPos.row, hitInfo.info.gridPos.col);
            interactionOccurred = true;
        } else if (groundHitPoint) {
            const gridCoords = worldToGrid(groundHitPoint.x, groundHitPoint.z);
            if (gridCoords) {
                const objectInCell = getGridObjectInfoAt(gridCoords.row, gridCoords.col);
                if (objectInCell && 'plantTypeId' in objectInCell) {
                    waterPlantAt(gridCoords.row, gridCoords.col); // Use clicked cell coords
                    interactionOccurred = true;
                }
            }
        }
    } else if (currentAction.toolType === 'remove') {
        if (hitInfo) {
            removeGridObjectAt(hitInfo.info.gridPos.row, hitInfo.info.gridPos.col);
            interactionOccurred = true;
        } else if (groundHitPoint) {
            const gridCoords = worldToGrid(groundHitPoint.x, groundHitPoint.z);
            if (gridCoords) {
                const objectInCell = getGridObjectInfoAt(gridCoords.row, gridCoords.col);
                if (objectInCell) { // Check if *any* object is there
                    removeGridObjectAt(gridCoords.row, gridCoords.col); // Use clicked cell coords
                    interactionOccurred = true;
                }
            }
        }
    }
    // Add other tools if needed

	// --- Finalization ---
    isInteracting = false; // Tool interaction ends immediately
    // Request render if needed (actions like remove/water call requestRender internally)
    // if (interactionOccurred && !isRenderLoopActive) { requestRender(); }
}
// --- End handleCanvasPointerDown ---

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

// --- Asset Loading Function (Modified) ---
async function loadAssets() {
    console.log("Starting asset loading...");
    const loadPromises: Promise<void>[] = [];
    const modelPathsToLoad = new Set<string>();

    // Add models from Plants
    for (const typeId in plantConfigs) {
        if (typeId === 'default' && (!plantConfigs.default.growthStages || plantConfigs.default.growthStages.length === 0)) continue; // Skip default if no stages
        const config = plantConfigs[typeId];
        if (config.growthStages && config.growthStages.length > 0) {
            config.growthStages.forEach(stage => {
                if (stage.modelPath) {
                    modelPathsToLoad.add(stage.modelPath);
                } else {
                    console.warn(`Plant config ${typeId} has a growth stage missing a modelPath.`);
                }
            });
        } else {
            console.warn(`Plant config ${typeId} is missing growthStages array.`);
        }
    }

    // Add models from Decor
    for (const typeId in decorConfigs) {
        const config = decorConfigs[typeId];
        if (config.modelPath) {
            modelPathsToLoad.add(config.modelPath);
        } else {
             console.warn(`Decor config ${typeId} is missing modelPath.`);
        }
    }

    // --- The rest of the loading logic remains the same ---
    // It iterates through modelPathsToLoad and caches them in gltfCache
    for (const modelPath of modelPathsToLoad) {
        if (!gltfCache[modelPath]) {
            const loadPromise = new Promise<void>((resolve, reject) => {
                gltfLoader.load( modelPath, (gltf) => {
                        console.log(`Loaded: ${modelPath}`);
                        let targetSize = 1.0; // Default normalization target

                        // --- Use extractAndPrepareGltfData (no changes needed here) ---
                        const preparedData = extractAndPrepareGltfData(gltf.scene, modelPath, targetSize);
                        if (preparedData) {
                            gltfCache[modelPath] = preparedData;
                        } else {
                            console.error(`Failed to extract data from GLTF: ${modelPath}`);
                        }
                        resolve();
                    },
                    undefined, // Progress callback (optional)
                    (error) => {
                        console.error(`Error loading GLTF: ${modelPath}`, error);
                         // Add placeholder cache entry on failure?
                         // gltfCache[modelPath] = createPlaceholderCacheEntry(); // Requires a function to make placeholder data
                        resolve(); // Resolve even on error to not block everything
                    }
                );
            });
            loadPromises.push(loadPromise);
        }
    }

    try {
        await Promise.all(loadPromises);
        assetsLoaded = true;
        console.log("Asset loading process finished.");
    } catch (error) {
        console.error("Error during asset loading:", error);
        assetsLoaded = false; // Mark as not loaded on error
    }
}
// --- End Asset Loading ---

// --- Persistence Functions ---
// Debounce saveGardenState with a delay (e.g., 1.5 seconds)
const DEBOUNCED_SAVE_DELAY_MS = 1500;
const debouncedSaveGardenState = debounce(saveGardenState, DEBOUNCED_SAVE_DELAY_MS);

// Save Function
function saveGardenState() {
	try {
		if (typeof localStorage === 'undefined') return;
		console.log(`Attempting save at ${new Date().toLocaleTimeString()}.`);

        const serializableGrid: SerializableGardenGrid = Array(GRID_DIVISIONS).fill(null).map(() => Array(GRID_DIVISIONS).fill(null));

        const serialize = (info: PlantInfo | DecorInfo): SerializablePlantInfo | SerializableDecorInfo | null => {
             if ('plantTypeId' in info) {
                const { object3D, originalMaterialColors, ...dataToSave } = info; // Exclude non-serializable fields
                return { ...dataToSave, type: 'plant' };
             } else if ('decorTypeId' in info) {
                 const { object3D, ...dataToSave } = info; // Exclude non-serializable fields
                 return { ...dataToSave, type: 'decor' };
             }
             return null;
        }

        // Iterate over grid, find main objects, serialize them
        for (let r = 0; r < GRID_DIVISIONS; r++) {
            for (let c = 0; c < GRID_DIVISIONS; c++) {
                const cell = gardenGrid[r][c];
                // Only save if it's the *main* info block (not null or a pointer)
                if (cell && !('pointerTo' in cell)) {
                     const serializableData = serialize(cell);
                     if(serializableData) {
                        serializableGrid[r][c] = serializableData;
                     }
                } else if (cell === null) {
                    serializableGrid[r][c] = null;
                }
                 // Pointers are implicitly handled by the main object's position
            }
        }

		localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializableGrid));
		console.log(`Garden state saved. (${allPlants.size} plants, ${allDecor.size} decor)`);

	} catch (error) {
		console.error("Failed to save garden state:", error);
	}
}

function loadGardenState() {
	try {
		const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
		if (savedData && assetsLoaded) { // Ensure assets are ready before loading
            const loadedGrid: SerializableGridCell[][] = JSON.parse(savedData);
			console.log("Loading saved garden state...");

			initializeGrid(); // Start with clean grid
            allPlants.clear();
            allDecor.clear();
            updatablePlants.clear();
            // No need to reset instance counts/maps

            // Clear existing objects from the scene first (important if reloading without page refresh)
            allPlants.forEach(p => { if (p.object3D) scene.remove(p.object3D); }); // Assuming scene exists
            allDecor.forEach(d => { if (d.object3D) scene.remove(d.object3D); });

			for (let r = 0; r < GRID_DIVISIONS; r++) {
				for (let c = 0; c < GRID_DIVISIONS; c++) {
					const savedCell = loadedGrid[r]?.[c];

					// If it's a saved object (not null, not a pointer implicitly)
					if (savedCell) {
						// Check grid spot again just in case (should be redundant with initializeGrid)
						if (gardenGrid[r][c] !== null) {
							console.warn(`Load conflict: Cell [${r}, ${c}] not empty.`);
							continue;
						}

                        const { type, ...loadedData } = savedCell;
                        const typeId = type === 'plant' ? (loadedData as SerializablePlantInfo).plantTypeId : (loadedData as SerializableDecorInfo).decorTypeId;

                        // Call placeGridObjectAt, passing loadedData as initialState
                        // It will handle cloning, placing pointers, adding to sets etc.
                        placeGridObjectAt(r, c, type, typeId, loadedData);
					}
				}
			}
			console.log("Garden state loaded.");
            requestRender(); // Render the loaded state
			return true;
		} else if (!assetsLoaded) {
            console.warn("Attempted to load state before assets were ready. Load deferred.");
            // We might need to trigger loadGardenState again after assets load promise resolves
        }
	} catch (error) {
		console.error("Failed to load or parse garden state:", error);
		// localStorage.removeItem(LOCAL_STORAGE_KEY); // Optional: clear bad save data
		initializeGrid(); // Start fresh
	}
	return false;
}
// --- End Persistence ---

// performs render on window resize
function performResize() {
    // Ensure necessary components exist
    if (!container || !renderer || !camera || !scene) {
        console.warn("Resize skipped: Missing required components.");
        return;
    }

    // Ensure PLANE_SIZE is available in this scope
    if (typeof PLANE_SIZE === 'undefined') {
         console.error("Resize skipped: PLANE_SIZE is not defined or accessible in the scope of performResize.");
         return;
    }

    const screenWidth = container.clientWidth;
    const screenHeight = container.clientHeight;

    // Check for zero size
    if (screenWidth === 0 || screenHeight === 0) {
        console.warn("Resize skipped: Container dimensions are zero.");
        return;
    }

    const screenAspect = screenWidth / screenHeight;

    // --- Automatically determine content dimensions based on the plane ---
    // Since the plane is PLANE_SIZE x PLANE_SIZE and lies flat on XZ,
    // the relevant world dimensions for the XY camera view are:
    const contentWidth = PLANE_SIZE;  // Plane's extent along World X-axis
    const contentHeight = PLANE_SIZE; // Plane's extent along World Z-axis (viewed as Height in XY camera)
    const contentAspect = contentWidth / contentHeight; // Will be 1.0 for this square plane

    // --- Calculate camera view size based on aspect ratios ---
    let cameraViewWidth;
    let cameraViewHeight;

    // Compare screen aspect to content aspect
    if (screenAspect > contentAspect) {
        // Screen is wider than content (aspect > 1): Match content height, calculate width
        // The limiting dimension is height. Fit the content height plus padding.
        cameraViewHeight = contentHeight * PADDING_FACTOR;
        // Calculate the corresponding width needed to fill the screen viewport
        cameraViewWidth = cameraViewHeight * screenAspect;
    } else {
        // Screen is taller than or equal to content (aspect <= 1): Match content width, calculate height
        // The limiting dimension is width. Fit the content width plus padding.
        cameraViewWidth = contentWidth * PADDING_FACTOR;
        // Calculate the corresponding height needed to fill the screen viewport
        cameraViewHeight = cameraViewWidth / screenAspect;
    }

    // Set camera frustum properties (centered at origin)
    camera.left = -cameraViewWidth / 2;
    camera.right = cameraViewWidth / 2;
    camera.top = cameraViewHeight / 2;
    camera.bottom = -cameraViewHeight / 2;

    // Update camera projection matrix
    camera.updateProjectionMatrix();

    // Update renderer size
    renderer.setSize(screenWidth, screenHeight);
    renderer.render(scene, camera);
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

      
// --- renderFrame (Adjusted for Model Swapping) ---
function renderFrame() {
    renderRequested = false;
    animationFrameId = undefined; // Clear the ID tracking this frame
    let needsRenderLater = false; // Flag if any visual update happens
    const perfNow = performance.now(); // Use performance.now for animations
    const now = new Date();
    const currentMinute = now.getMinutes();

    // --- Day/Night Update ---
    if (currentMinute !== lastDayNightUpdateMinute) {
        updateDayNightCycle(now);
        lastDayNightUpdateMinute = currentMinute;
        needsRenderLater = true; // <-- ADD THIS LINE
        // Day/night change always requires a render, but renderFrame is already running
    }

    let needsSave = false;
    const nowTimestamp = now.getTime();
    const plantsToRemoveFromUpdateList: PlantInfo[] = [];

    // --- Process Active Animations (MODIFIED FOR EASING) ---
    const completedAnimationsIndices: number[] = [];
    activeAnimations.forEach((anim, index) => {
        const elapsed = perfNow - anim.startTime;
        let rawProgress = Math.min(1.0, elapsed / anim.duration);

        // Apply easing function (default to linear if undefined)
        const easeFunc = anim.ease || linearEase;
        let easedProgress = easeFunc(rawProgress);

        if (anim.isPingPong) {
            if (!anim.pingPongReachedPeak) { // Phase 1: start -> peak
                anim.uniform.value = MathUtils.lerp(anim.startValue, anim.targetValue, easedProgress);
                if (rawProgress >= 1.0) { // Check raw progress for completion
                    anim.pingPongReachedPeak = true;
                    anim.startTime = perfNow; // Reset time for phase 2
                    anim.startValue = anim.targetValue; // Start phase 2 from peak
                    anim.targetValue = 0.0; // Target phase 2 is 0
                    // Duration remains halfDuration (already set)
                    // Set the easing for the *second* half (peak -> 0)
                    anim.ease = power1InEase; // Or pass this in animateUniformPingPong
                    // Don't mark as complete yet
                }
            } else { // Phase 2: peak -> 0
                 // Easing function for phase 2 should already be set in anim.ease
                 easedProgress = (anim.ease || linearEase)(rawProgress); // Re-apply easing for phase 2 progress
                anim.uniform.value = MathUtils.lerp(anim.startValue, anim.targetValue, easedProgress);
                if (rawProgress >= 1.0) { // Check raw progress
                    anim.uniform.value = anim.targetValue; // Ensure end value (0.0)
                    completedAnimationsIndices.push(index);
                    if (anim.onComplete) anim.onComplete(); // Call original onComplete now
                }
            }
        } else { // Standard animation
            anim.uniform.value = MathUtils.lerp(anim.startValue, anim.targetValue, easedProgress);
            if (rawProgress >= 1.0) { // Check raw progress
                anim.uniform.value = anim.targetValue;
                completedAnimationsIndices.push(index);
                if (anim.onComplete) anim.onComplete();
            }
        }
        needsRenderLater = true; // Animation updated visuals
    });

    // Remove completed animations (iterate backwards to avoid index issues)
    for (let i = completedAnimationsIndices.length - 1; i >= 0; i--) {
        activeAnimations.splice(completedAnimationsIndices[i], 1);
    }
    // --- End Animation Processing ---

    // --- Update Growable Plants ---
    for (const plantInfo of updatablePlants) {
        let shouldBeRemovedFromUpdateList = false;
        let needsVisualUpdateThisFrame = false; // Did *this specific plant* change visually?

        // --- Get Stage BEFORE growth update ---
        const stageBeforeUpdate = getGrowthStageConfig(plantInfo);

        // --- Check Thirst first (can happen regardless of growth) ---
        const config = plantConfigs[plantInfo.plantTypeId] ?? plantConfigs.default;
        if (plantInfo.state === 'healthy' && (nowTimestamp - plantInfo.lastWateredTime) > config.thirstThresholdSeconds * 1000) {
            plantInfo.state = 'needs_water';
            plantInfo.lastUpdateTime = nowTimestamp; // Update time even if state changes
            needsSave = true;
            needsVisualUpdateThisFrame = true; // Color will change
            shouldBeRemovedFromUpdateList = true; // Stop growth updates
            console.log(`RenderFrame: Plant [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] became thirsty.`);
        } else if (plantInfo.state === 'healthy') {
            // --- Healthy: Check Growth ---
            const growthOccurred = updatePlantGrowth(plantInfo); // Updates progress and lastUpdateTime

            if (growthOccurred) {
                 needsVisualUpdateThisFrame = true; // Scale/pos might change
            }

            // --- Check for Stage Change AFTER growth update ---
            const stageAfterUpdate = getGrowthStageConfig(plantInfo);

            if (stageBeforeUpdate && stageAfterUpdate && stageBeforeUpdate.modelPath !== stageAfterUpdate.modelPath) {
                console.log(`RenderFrame: Plant [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] changed stage!`);
                console.log(`   From: ${stageBeforeUpdate.modelPath} (Prog: ${(plantInfo.growthProgress - 0.001).toFixed(3)})`); // Show approx progress before change
                console.log(`   To:   ${stageAfterUpdate.modelPath} (Prog: ${plantInfo.growthProgress.toFixed(3)})`);

                // --- SWAP MODEL ---
                const swapSuccess = swapPlantModel(plantInfo, stageAfterUpdate.modelPath);
                if (swapSuccess) {
                    needsVisualUpdateThisFrame = true; // Ensure visuals are updated with new model
                } else {
                    console.error("Model swap failed. Visuals may be incorrect.");
                    // Decide how to handle failure - stop growth? Show placeholder?
                }
            }

            // Check if finished growing *after* potential stage swap
            if (plantInfo.growthProgress >= 1.0) {
                shouldBeRemovedFromUpdateList = true; // Finished growing
                console.log(`RenderFrame: Plant [${plantInfo.gridPos.row}, ${plantInfo.gridPos.col}] finished growing.`);
            }
        } else { // Already thirsty
            plantInfo.lastUpdateTime = nowTimestamp; // Keep timestamp fresh even if thirsty
            shouldBeRemovedFromUpdateList = true; // Should already be marked, but ensure
        }

        // --- Update Visuals for THIS plant if needed ---
        if (needsVisualUpdateThisFrame) {
            updatePlantVisuals(plantInfo); // Handles scale, position, tint, uses CURRENT object3D
            needsRenderLater = true; // Signal that the renderer needs to run
        }

        // --- Mark for removal from active updates ---
        if (shouldBeRemovedFromUpdateList) {
            plantsToRemoveFromUpdateList.push(plantInfo);
        }
    } // End loop over updatablePlants

    // Remove plants that became idle/thirsty/fully grown
    if (plantsToRemoveFromUpdateList.length > 0) {
        plantsToRemoveFromUpdateList.forEach(p => updatablePlants.delete(p));
        console.log(`Removed ${plantsToRemoveFromUpdateList.length} plants from update list. New size: ${updatablePlants.size}`);
        // No need to request render here, as the removal itself doesn't change visuals immediately
    }

    // --- Save State if changed ---
    if (needsSave) {
        debouncedSaveGardenState();
    }

    // --- Render Scene ---
    if (needsRenderLater || activeAnimations.length > 0 || isInteracting) {
        // Add a check for preview box visibility too for sanity
        // console.log("Rendering. Preview visible:", previewGroup?.visible);
        renderer.render(scene, camera);
        needsRenderLater = true; // Ensure loop logic considers this render happened
    } else {
        needsRenderLater = false; // Nothing required rendering this frame
    }

    // --- Manage Render Loop ---
    const loopShouldBeActive = isInteracting || activeAnimations.length > 0;

    if (loopShouldBeActive) {
        // If the loop should be active...
        if (!isRenderLoopActive) {
            // ...but it isn't, start it.
            startRenderLoop(); // startRenderLoop handles requesting the next frame
        } else {
            // ...and it is active, request the next frame directly.
            animationFrameId = requestAnimationFrame(renderFrame);
        }
    } else {
        // If the loop should NOT be active...
        if (isRenderLoopActive) {
            // ...but it is, stop it.
            stopRenderLoop();
        }
        // ...and it's not active, do nothing (loop remains stopped).
    }

    // Ensure renderRequested is false as we've processed this frame's potential render
    renderRequested = false;
}
// --- End renderFrame ---

/// --- Core Component Logic (onMount, onDestroy - Adjusted) ---
let initComplete = false;
onMount(() => {
	if (!container) return;

    // --- Store Subscriptions (Keep as is) ---
    const unsubHeldItem = heldItem.subscribe(value => { currentHeldItem = value; });
    const unsubIsDragging = isDraggingItem.subscribe(value => {
        isPointerDragging = value;
        if (isPointerDragging && !isInteracting && initComplete) {
            console.log("Pointer drag detected, starting interaction loop.");
            isInteracting = true;
            startRenderLoop();
            selectedAction.set(null); // Hide tool selection
        }
        // Stop handled by pointer up/cancel
    });

	scene = new THREE.Scene();
	scene.background = new THREE.Color(0xc6eafa); // Start with day sky

	camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 1, 1000 ); // Frustum set in performResize
	camera.position.set(10, 10, 10);
	camera.lookAt(0, 0, 0);
	scene.add(camera);

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setSize(container.clientWidth, container.clientHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.shadowMap.enabled = true;
    // renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	container.appendChild(renderer.domElement);

    // --- Lights Setup (Keep as is) ---
	ambientLight = new THREE.AmbientLight(0xffffff, MAX_AMBIENT_INTENSITY);
	scene.add(ambientLight);
	hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, MAX_HEMISPHERE_INTENSITY);
	scene.add(hemisphereLight);
	scene.fog = new THREE.Fog(0xffffff, 25, 50);
	directionalLight = new THREE.DirectionalLight(0xffffff, MAX_DIRECTIONAL_INTENSITY);
    directionalLight.position.set(-SUN_DISTANCE * 0.5, SUN_DISTANCE * 0.7, SUN_DISTANCE * 0.3);
    directionalLight.castShadow = true;
	const shadowCamSize = PLANE_SIZE * 1.2; // Slightly larger shadow area
	directionalLight.shadow.camera.left = -shadowCamSize;
	directionalLight.shadow.camera.right = shadowCamSize;
	directionalLight.shadow.camera.top = shadowCamSize;
	directionalLight.shadow.camera.bottom = -shadowCamSize;
	directionalLight.shadow.camera.near = 0.5;
	directionalLight.shadow.camera.far = SUN_DISTANCE * 2; // Ensure far enough
	// directionalLight.shadow.mapSize.width = 2048;
	// directionalLight.shadow.mapSize.height = 2048;
	scene.add(directionalLight);
	scene.add(directionalLight.target); // Important to add target if moved
	// const shadowHelper = new THREE.CameraHelper(directionalLight.shadow.camera); // Debug
	// scene.add(shadowHelper);

	// --- Ground and Grid Helper (Keep as is) ---
	const groundGeometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
	const groundMaterial = new THREE.MeshToonMaterial({ color: 0x5C946E, side: THREE.DoubleSide, gradientMap: toonGradientMap });
	ground = new THREE.Mesh(groundGeometry, groundMaterial);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.01;
	ground.receiveShadow = true;
	scene.add(ground);

    const gridLineColor = new THREE.Color(0x666666);
    const centerLineColor = new THREE.Color(0x666666);

	gridHelper = new THREE.GridHelper(PLANE_SIZE, GRID_DIVISIONS, centerLineColor, gridLineColor);
	gridHelper.position.y = 0.01; // Slightly above ground
	scene.add(gridHelper);

    // --- Make gridhelper transparent ---
    if (gridHelper.material instanceof THREE.Material) {
        gridHelper.material.transparent = true;
        gridHelper.material.opacity = 0.1; // Combine dimmer color with transparency
    }

	// --- Preview Bounding Box Setup (Keep as is) ---
	validPlacementMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.5, transparent: true, side: THREE.DoubleSide });
	invalidPlacementMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.5, transparent: true, side: THREE.DoubleSide });
	previewGroup = new THREE.Group();
	previewGroup.visible = false;
	scene.add(previewGroup);
	const previewPlaneGeom = new THREE.PlaneGeometry(CELL_SIZE * 0.95, CELL_SIZE * 0.95);
	previewPlaneGeom.rotateX(-Math.PI / 2);
	for (let i = 0; i < MAX_PREVIEW_CELLS; i++) {
		const plane = new THREE.Mesh(previewPlaneGeom, validPlacementMaterial);
		plane.visible = false;
		plane.position.y = 0.02;
		previewMeshes.push(plane);
		previewGroup.add(plane);
	}

	// --- Event Listeners (Keep as is, uses updated handlers) ---
	container.addEventListener('pointerdown', handleCanvasPointerDown);
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUpOrCancel);
    window.addEventListener('pointercancel', handlePointerUpOrCancel);
    window.addEventListener('lostpointercapture', handlePointerUpOrCancel);
	window.addEventListener('resize', resizeHandler);
	window.addEventListener('beforeunload', handleBeforeUnload);


	// --- Load Assets and THEN Load Save Data ---
    assetsLoadingPromise = loadAssets().then(() => {
        if (!assetsLoaded) {
             console.error("Asset loading failed. Garden initialization incomplete.");
             return;
        }
        console.log("Assets loaded, proceeding with post-load setup...");

        // REMOVED: setupInstancedMeshes();

        // Load saved state AFTER assets are confirmed loaded
        const loaded = loadGardenState(); // loadGardenState now calls placeGridObjectAt
        if (!loaded) {
            initializeGrid(); // Initialize fresh if load fails or no save exists
        }

        // --- Final Initializations ---
        initComplete = true;
        clock.start();
        performResize(); // Initial resize correctly sets camera frustum
        const initialTime = new Date();
        updateDayNightCycle(initialTime);
        lastDayNightUpdateMinute = initialTime.getMinutes();

        // Start background intervals
        if (backgroundCheckIntervalId === undefined) {
             backgroundCheckIntervalId = window.setInterval(performBackgroundCheck, BACKGROUND_UPDATE_INTERVAL_MS);
             console.log(`Started background check interval (${BACKGROUND_UPDATE_INTERVAL_MS}ms)`);
        }
        if (idleDayNightCheckIntervalId === undefined) {
             idleDayNightCheckIntervalId = window.setInterval(performIdleBackgroundCheck, IDLE_DAYNIGHT_UPDATE_INTERVAL_MS);
             console.log(`Started idle day/night check interval (${IDLE_DAYNIGHT_UPDATE_INTERVAL_MS}ms)`);
        }

        requestRender(); // Request first frame
        console.log("Garden setup complete.");

    }).catch(error => {
        console.error("Error in async setup chain:", error);
    });

	// --- Return Cleanup Function ---
	return () => {
		console.log("onMount cleanup function running");
		stopRenderLoop(); // Ensure loop is stopped
		// Remove listeners added in onMount
        unsubHeldItem();
        unsubIsDragging();
		if (container) container.removeEventListener('pointerdown', handleCanvasPointerDown);
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUpOrCancel);
		window.removeEventListener('pointercancel', handlePointerUpOrCancel);
		window.removeEventListener('lostpointercapture', handlePointerUpOrCancel);
        window.removeEventListener('resize', resizeHandler);
		// beforeunload listener removed in onDestroy
	};
});

// --- onDestroy (Adjusted for new cleanup) ---
onDestroy(() => {
    initComplete = false;
    assetsLoaded = false;

	stopRenderLoop();
	window.removeEventListener('beforeunload', handleBeforeUnload);
    console.log('onDestroy triggered, flushing pending save...');
    debouncedSaveGardenState.flush(); // Force final save

	// Clear intervals
    if (backgroundCheckIntervalId !== undefined) clearInterval(backgroundCheckIntervalId);
    if (idleDayNightCheckIntervalId !== undefined) clearInterval(idleDayNightCheckIntervalId);
    if (animationFrameId !== undefined) cancelAnimationFrame(animationFrameId);
	if (clock.running) clock.stop();

	// --- Dispose ALL individually placed objects ---
    console.log("Disposing individual garden objects...");
    const disposeObject = (obj: THREE.Object3D) => {
        obj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry?.dispose();
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => {
                        Object.keys(mat).forEach(key => { // Dispose textures
                            const value = mat[key as keyof THREE.Material];
                            if (value instanceof THREE.Texture) value.dispose();
                        });
                        mat.dispose();
                    });
                }
            }
        });
         console.log(`   Disposed object ${obj.userData.typeId}`);
    };

    allPlants.forEach(p => { if (p.object3D) disposeObject(p.object3D); });
    allDecor.forEach(d => { if (d.object3D) disposeObject(d.object3D); });
    allPlants.clear();
    allDecor.clear();
    updatablePlants.clear();

    // --- Dispose Shared Scene Assets ---
    console.log("Disposing shared scene assets...");
	ground?.geometry?.dispose();
	if(ground?.material) (Array.isArray(ground.material) ? ground.material : [ground.material]).forEach(m => m.dispose());
	gridHelper?.geometry?.dispose();
	if(gridHelper?.material) (Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material]).forEach(m => m.dispose());
	validPlacementMaterial?.dispose();
	invalidPlacementMaterial?.dispose();
	previewMeshes[0]?.geometry?.dispose(); // Dispose shared preview geometry
    placeholderGeometry?.dispose(); // Dispose placeholder geometry
    placeholderMaterial?.dispose(); // Dispose placeholder material

	// --- Dispose Lights / Fog (usually not strictly needed, but good practice)
    // Lights don't have geometry/material, fog doesn't need explicit disposal
    // --- Remove Instanced Mesh Disposal ---
    // console.log("Disposing Instanced Meshes and associated assets..."); // REMOVED SECTION

    // --- Dispose CACHED GLTF data (Original Scenes) ---
    console.log("Disposing cached GLTF original assets...");
    for (const modelPath in gltfCache) {
        const cacheEntry = gltfCache[modelPath];
        if (cacheEntry && cacheEntry.scene) {
             // Traverse the ORIGINAL scene to dispose materials/geometries
             // that were NOT cloned (though our current logic clones everything placed)
             // This is more of a safety net for the original loaded data.
            cacheEntry.scene.traverse(child => {
                 if (child instanceof THREE.Mesh) {
                    // Only dispose if geometry/material haven't already been disposed
                    // (e.g., if the original mesh itself was somehow added/removed directly)
                    // This is tricky, rely primarily on the disposal of the clones above.
                    // We risk double-disposing if not careful.
                    // Let's just clear the cache reference. The objects themselves should
                    // be garbage collected if not referenced elsewhere.
                 }
            });
        }
        delete gltfCache[modelPath];
    }
    console.log("Cleared GLTF Cache.");

    // --- Dispose Renderer ---
	if (renderer) {
		renderer.dispose();
		if (renderer.domElement?.parentNode) {
			renderer.domElement.parentNode.removeChild(renderer.domElement);
		}
        console.log("Disposed renderer.");
	}

    // --- Clear Internal State ---
    gardenGrid = [];

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