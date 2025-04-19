import { writable, get } from 'svelte/store';

// --- Grid Configuration ---
export const GRID_ROWS = 8;
export const GRID_COLS = 12;
export const GRID_GAP = 10; // px
// --- End Grid Configuration ---

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

// --- NEW: Widget System ---

/**
 * Base type for widget-specific settings.
 * Can be extended by individual widgets later.
 * Example: { updateInterval: number } for a weather widget.
 */
export type WidgetSettings = Record<string, any>; // Use a generic object for now

/**
 * Configuration for a single widget instance placed on the grid.
 */
export interface WidgetConfig {
    id: string; // Unique identifier (e.g., generated UUID or timestamp)
    componentName: string; // Key to map to the actual Svelte component (e.g., 'ClockWidget')
    gridRowStart: number;
    gridColumnStart: number;
    gridRowSpan: number;
    gridColumnSpan: number;
    settings?: WidgetSettings; // Optional widget-specific settings
}

// Type for the store: an array of widget configurations
export type WidgetStore = WidgetConfig[];

const WIDGET_STORAGE_KEY = 'gardenWidgetLayout';

// --- Load initial widget layout from localStorage ---
function loadWidgets(): WidgetStore {
    try {
        const savedData = localStorage.getItem(WIDGET_STORAGE_KEY);
        if (savedData) {
            const parsedWidgets: WidgetStore = JSON.parse(savedData);
            // Optional: Add validation here to ensure parsed data matches WidgetConfig structure
            console.log("Widgets loaded from localStorage:", parsedWidgets);
            return parsedWidgets;
        }
    } catch (error) {
        console.error("Failed to load widgets from localStorage:", error);
        // Optionally clear corrupted data: localStorage.removeItem(WIDGET_STORAGE_KEY);
    }
    // Return an empty array if loading fails or no data exists
    console.log("No saved widgets found or load failed, starting fresh.");
    return [];
}

// The widget store, initialized by loading from localStorage
export const widgetStore = writable<WidgetStore>(loadWidgets());

// --- Subscribe to widget changes and save to localStorage ---
widgetStore.subscribe(currentWidgets => {
    try {
        // No complex conversion needed, array of objects is directly serializable
        localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(currentWidgets));
        // console.log("Widgets saved to localStorage."); // Optional: Log on every save
    } catch (error) {
        console.error("Failed to save widgets to localStorage:", error);
    }
});

// --- Helper functions to manage widgets (add, remove, update) ---

/**
 * Adds a new widget configuration to the store.
 * @param newWidget - The configuration object for the new widget.
 */
export function addWidget(newWidget: WidgetConfig) {
    widgetStore.update(widgets => {
        // Optional: Check for ID collision, though unlikely with good ID generation
        console.log("Adding widget:", newWidget);
        return [...widgets, newWidget]; // Add to the array
    });
}

/**
 * Removes a widget configuration from the store by its ID.
 * @param widgetId - The unique ID of the widget to remove.
 */
export function removeWidget(widgetId: string) {
    widgetStore.update(widgets => {
        const initialLength = widgets.length;
        const filteredWidgets = widgets.filter(w => w.id !== widgetId);
        if (filteredWidgets.length < initialLength) {
            console.log("Removing widget:", widgetId);
        } else {
            console.warn("Attempted to remove non-existent widget:", widgetId);
        }
        return filteredWidgets;
    });
}

/**
 * Updates an existing widget's configuration in the store.
 * @param updatedWidget - The widget configuration with updated properties. Must include the correct ID.
 */
export function updateWidget(updatedWidget: WidgetConfig) {
    widgetStore.update(widgets => {
        const index = widgets.findIndex(w => w.id === updatedWidget.id);
        if (index !== -1) {
            console.log("Updating widget:", updatedWidget.id, updatedWidget);
            // Create a new array with the updated widget to ensure reactivity
            const newWidgets = [...widgets];
            newWidgets[index] = updatedWidget;
            return newWidgets;
        } else {
            console.warn("Attempted to update non-existent widget:", updatedWidget.id);
            return widgets; // Return unchanged array if not found
        }
    });
}

// Keep the interface if needed by widgets/modal
export interface WidgetSizeOption {
    rows: number;
    cols: number;
    label: string;
}