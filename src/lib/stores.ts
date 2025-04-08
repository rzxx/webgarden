import { writable } from 'svelte/store';

// Define possible actions/tools
export type SelectedAction =
    | { type: 'plant'; plantType: string } // e.g., { type: 'plant', plantType: 'fern' }
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
    { id: 'box', name: 'Box' },
    { id: 'boxBig', name: 'Big Box' },
    // Add more decor types here
];