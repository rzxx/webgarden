import { writable, get } from 'svelte/store';

// Type for the inventory store: Map<itemId, quantity>
export type Inventory = Map<string, number>;

// The inventory store
export const inventory = writable<Inventory>(new Map());

/**
* Sets the initial quantities for items in the inventory.
* @param initialItems - An object where keys are item IDs and values are quantities.
*/
export function initializeInventory(initialItems: Record<string, number>) {
    inventory.update(currentInventory => {
        const newInventory = new Map(currentInventory); // Start with existing or empty
        for (const [itemId, quantity] of Object.entries(initialItems)) {
            newInventory.set(itemId, quantity);
        }
        console.log("Inventory initialized:", newInventory);
        return newInventory;
    });
}

/**
* Gets the current quantity of a specific item in the inventory.
* Returns 0 if the item is not found.
* @param itemId - The ID of the item (e.g., 'fern', 'streetLamp').
* @returns The quantity of the item.
*/
export function getInventoryItemQuantity(itemId: string): number {
    const currentInventory = get(inventory);
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
            const newInventory = new Map(currentInventory);
            newInventory.set(itemId, currentQuantity - 1);
            console.log(`Inventory: Decremented ${itemId} to ${currentQuantity - 1}`);
            return newInventory;
        }
        // If item not found or quantity is 0, return the original map
        console.warn(`Inventory: Tried to decrement ${itemId}, but quantity was ${currentQuantity}`);
        return currentInventory;
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
        const newInventory = new Map(currentInventory);
        newInventory.set(itemId, currentQuantity + 1);
         console.log(`Inventory: Incremented ${itemId} to ${currentQuantity + 1}`);
        return newInventory;
    });
}