import * as THREE from 'three';

export const plantConfigs: Record<string, PlantConfig> = {
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

export type GrowthStage = {
    maxGrowth: number; // The progress value *up to which* this stage applies (inclusive)
    modelPath: string;
    // Optional: stage-specific scale factors if needed, otherwise use main config
    // initialScale?: number;
    // maxScale?: number; // Max scale *for this stage*
};

export type PlantConfig = {
    growthRatePerSecond: number;
    initialScale: number; // Overall initial scale (at progress 0)
    maxScale: number;     // Overall max scale (at progress 1)
    thirstThresholdSeconds: number;
    size: { rows: number; cols: number };
    growthStages: GrowthStage[]; // REQUIRED: Define models for growth phases
    healthyColorTint?: THREE.Color;
    thirstyColorTint?: THREE.Color;
};

export type DecorPointLightProps = {
    // Properties for the THREE.PointLight
    color?: number | string; // Default: 0xffffff
    intensity?: number;      // Default: 1.0
    distance?: number;       // Default: 0 (no limit) - Set this! Often crucial for performance.
    decay?: number;          // Default: 2 (realistic falloff)
    castShadow?: boolean;    // Default: false (shadows are expensive!)
    // --- Custom Logic Flags ---
    activeAtNightOnly?: boolean; // Example: For lamps that turn on at night
    // Add more properties as needed (e.g., powerCost, flicker settings?)
};

export type DecorConfig = {
    size: { rows: number; cols: number };
    modelPath: string;
    defaultRotationY?: number;
    baseScale?: number;
    // NEW: Map Empty names to their light properties
    pointLightDefinitions?: Record<string, DecorPointLightProps>; // Key: Name of the Empty in the GLTF
};

export const decorConfigs: Record<string, DecorConfig> = {
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
                distance: 10,
                decay: 2,
                castShadow: true, // Maybe one lamp casts shadows? Use sparingly!
                activeAtNightOnly: true // Only on when dark
            }
        }
    }
};