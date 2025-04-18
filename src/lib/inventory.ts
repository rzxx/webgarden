import { writable, get } from 'svelte/store';

// Type for the inventory store: Map<itemId, quantity>
export type Inventory = Map<string, number>;

const INVENTORY_STORAGE_KEY = 'gardenInventoryData';

// --- Load initial inventory from localStorage ---
function loadInventory(): Inventory {
    try {
        const savedData = localStorage.getItem(INVENTORY_STORAGE_KEY);
        if (savedData) {
            // Parse the saved data (assuming it's stored as an array of [key, value] pairs)
            const parsedArray: [string, number][] = JSON.parse(savedData);
            // Convert the array back into a Map
            const loadedInventory = new Map(parsedArray);
            console.log("Inventory loaded from localStorage:", loadedInventory);
            return loadedInventory;
        }
    } catch (error) {
        console.error("Failed to load inventory from localStorage:", error);
        // Optionally clear corrupted data: localStorage.removeItem(INVENTORY_STORAGE_KEY);
    }
    // Return a new empty Map if loading fails or no data exists
    console.log("No saved inventory found or load failed, starting fresh.");
    return new Map();
}

// The inventory store, initialized by loading from localStorage
export const inventory = writable<Inventory>(loadInventory());

// --- Subscribe to inventory changes and save to localStorage ---
inventory.subscribe(currentInventory => {
    try {
        // Convert the Map to an array of [key, value] pairs for JSON serialization
        const arrayToSave = Array.from(currentInventory.entries());
        localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(arrayToSave));
        // console.log("Inventory saved to localStorage."); // Optional: Log on every save
    } catch (error) {
        console.error("Failed to save inventory to localStorage:", error);
    }
});


/**
* Sets the initial quantities for items in the inventory.
* NOTE: This will OVERWRITE existing quantities loaded from storage
* unless called carefully after initial load. Usually used for first-time setup.
* @param initialItems - An object where keys are item IDs and values are quantities.
*/
export function initializeInventory(initialItems: Record<string, number>) {
    inventory.update(currentInventory => {
        // Decide if you want to merge or replace. Replacing is simpler for initialization.
        const newInventory = new Map<string, number>();
        for (const [itemId, quantity] of Object.entries(initialItems)) {
            newInventory.set(itemId, quantity);
        }
        console.log("Inventory explicitly initialized (overwriting previous state):", newInventory);
        return newInventory; // This triggers the subscription, saving the new state
    });
}

/**
* Gets the current quantity of a specific item in the inventory.
* Returns 0 if the item is not found.
* @param itemId - The ID of the item (e.g., 'fern', 'streetLamp').
* @returns The quantity of the item.
*/
export function getInventoryItemQuantity(itemId: string): number {
    const currentInventory = get(inventory); // Use get() for one-off reads
    return currentInventory.get(itemId) || 0;
}

/**
* Decrements the quantity of an item in the inventory by one.
* Does nothing if the item is not found or quantity is already 0.
* @param itemId - The ID of the item to decrement.
*/
export function decrementInventoryItem(itemId: string) {
    inventory.update(currentInventory => {
        const currentQuantity = currentInventory.get(itemId);
        if (currentQuantity !== undefined && currentQuantity > 0) {
            // No need to create a new Map, update the existing one
            currentInventory.set(itemId, currentQuantity - 1);
            console.log(`Inventory: Decremented ${itemId} to ${currentQuantity - 1}`);
            return currentInventory; // Return the mutated map to trigger subscription
        }
        console.warn(`Inventory: Tried to decrement ${itemId}, but quantity was ${currentQuantity}`);
        return currentInventory; // Return unchanged map if no decrement happened
    });
}

/**
* Increments the quantity of an item in the inventory by one.
* Adds the item with quantity 1 if it doesn't exist.
* @param itemId - The ID of the item to increment.
*/
export function incrementInventoryItem(itemId: string) {
    inventory.update(currentInventory => {
        const currentQuantity = currentInventory.get(itemId) || 0;
        // No need to create a new Map
        currentInventory.set(itemId, currentQuantity + 1);
        console.log(`Inventory: Incremented ${itemId} to ${currentQuantity + 1}`);
        return currentInventory; // Return the mutated map
    });
}

/**
* Adds a specified quantity of an item to the inventory.
* Adds the item with the specified quantity if it doesn't exist.
* @param itemId - The ID of the item to add.
* @param quantity - The quantity of the item to add (default is 1).
*/
export function addInventoryItem(itemId: string, quantity: number = 1) {
    inventory.update(currentInventory => {
        const currentQuantity = currentInventory.get(itemId) || 0;
        // No need to create a new Map
        currentInventory.set(itemId, currentQuantity + quantity);
        // console.log(`Inventory: Added ${quantity} of ${itemId}. New total: ${currentInventory.get(itemId)}`);
        return currentInventory; // Return the mutated map
    });
}