import { writable } from 'svelte/store';

// Define possible actions/tools
export type SelectedAction =
    | { type: 'plant'; plantType: string } // e.g., { type: 'plant', plantType: 'fern' }
    | { type: 'decor'; decorType: string } // Added decor type for consistency if needed later
    | { type: 'tool'; toolType: 'water' | 'remove' }
    | null; // Nothing selected

// Create the store with an initial value of null
export const selectedAction = writable<SelectedAction>(null);

// Define available plants (can be expanded later)
export const availablePlants = [
    { id: 'fern', name: 'Fern' },
    { id: 'cactus', name: 'Cactus' },
    { id: 'bush', name: 'Bush' },
    // Add more plant types here
];

// Define available decor (can be expanded later)
export const availableDecor = [
    { id: 'streetLamp', name: 'Street Lamp' },
    // Add more decor types here
];

// --- NEW: State for Pointer-Based Dragging ---
export interface HeldItemInfo {
    objectType: 'plant' | 'decor';
    typeId: string;
    // Optional: Add original event details if needed later
    // pointerId: number;
}

// Stores the info of the item currently being dragged via pointer
export const heldItem = writable<HeldItemInfo | null>(null);

// Flag to indicate if a pointer-based drag is in progress
export const isDraggingItem = writable<boolean>(false);
// Store for Selected Object Info
export interface SelectedObjectDisplayInfo {
    typeId: string; // e.g., 'fern', 'streetLamp'
    name: string;   // User-friendly name, e.g., "Fern", "Street Lamp"
    objectType: 'plant' | 'decor';
    status: string; // e.g., 'Healthy', 'Needs Water', 'OK', 'On', 'Off'
    growthProgress?: number; // Optional, for plants (0-1)
    gridPos: { row: number; col: number }; // For context/debugging
    // Add any other relevant info you want to display
}

export const selectedObjectInfo = writable<SelectedObjectDisplayInfo | null>(null);

export type UIMode = 'view' | 'edit';
export const uiMode = writable<UIMode>('view'); // Default to 'view'