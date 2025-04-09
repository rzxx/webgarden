<script lang="ts">
    import { selectedAction, availablePlants, availableDecor, type SelectedAction, heldItem, isDraggingItem, type HeldItemInfo } from './stores'; // Import new stores
    import { get } from 'svelte/store'; // Import get

    function selectTool(toolType: 'water' | 'remove') {
        selectedAction.update(current => {
            const newAction: SelectedAction = { type: 'tool', toolType: toolType };
             // If dragging, cancel drag first
            if (get(isDraggingItem)) {
                heldItem.set(null);
                isDraggingItem.set(false);
                 // Optionally release pointer capture if held by an item
                 // This might require tracking the target element
            }
            // Toggle tool selection
            return JSON.stringify(current) === JSON.stringify(newAction) ? null : newAction;
        });
    }

    // --- NEW: Pointer Down Handler for Items ---
    function handleItemPointerDown(event: PointerEvent, itemInfo: HeldItemInfo) {
        // Prevent default actions like text selection or browser drag behavior
        event.preventDefault();

        // Clear any selected tool when starting to drag an item
        selectedAction.set(null);

        // Set the item being held and the dragging state
        heldItem.set(itemInfo);
        isDraggingItem.set(true);

        const targetElement = event.target as HTMLElement; // Capture target element
        targetElement.setPointerCapture(event.pointerId);
        targetElement.classList.add('grabbing');

        // --- MODIFIED: releaseAndReset only handles UI cleanup ---
        const releaseAndReset = (e: PointerEvent) => {
            // Only act on the specific pointer that was captured by this element
            if (e.pointerId === event.pointerId) {
                console.log(`UI Item (${itemInfo.typeId}): Releasing pointer capture (${e.type})`);
                targetElement.releasePointerCapture(event.pointerId);
                targetElement.classList.remove('grabbing');
                // Remove these temporary listeners attached TO THIS ELEMENT
                targetElement.removeEventListener('pointerup', releaseAndReset);
                targetElement.removeEventListener('pointercancel', releaseAndReset);
                targetElement.removeEventListener('lostpointercapture', releaseAndReset);

                // --- DO NOT CLEAR heldItem or isDraggingItem here ---
                // Let the GardenCanvas handle the global state cleanup after placement attempt.
            }
        };
        // --- End Modification ---

        targetElement.addEventListener('pointerup', releaseAndReset);
        targetElement.addEventListener('pointercancel', releaseAndReset);
        targetElement.addEventListener('lostpointercapture', releaseAndReset);

        console.log("Pointer down on item:", itemInfo.typeId, " Capturing pointerId:", event.pointerId);
    }
    // --- End Pointer Down Handler ---


    // Reactive declaration to get the current value for styling
    let currentAction: SelectedAction | null = null;
    selectedAction.subscribe(value => {
        currentAction = value;
    });

    // Helper to check if an action is currently selected
    function isSelected(action: SelectedAction): boolean {
        if (!currentAction) return false;
        return JSON.stringify(currentAction) === JSON.stringify(action);
    }
</script>

<div class="ui-panel">
    <h3>Toolbox</h3>

    <!-- Plant Selection (Draggable) -->
    <h4>Plants:</h4>
    <div class="item-list">
        {#each availablePlants as plant}
        <div
            class="item"
            role="button"
            tabindex="0"
            aria-label={`Pick up ${plant.name}`}
            on:pointerdown={(event) => handleItemPointerDown(event, { objectType: 'plant', typeId: plant.id })}
            style="touch-action: none;"
        >
            {plant.name}
        </div>
        {/each}
    </div>

    <!-- Decor Selection (Draggable) -->
    <h4>Decor:</h4>
    <div class="item-list">
        {#each availableDecor as decor}
        <div
            class="item"
            role="button"
            tabindex="0"
            aria-label={`Pick up ${decor.name}`}
            on:pointerdown={(event) => handleItemPointerDown(event, { objectType: 'decor', typeId: decor.id })}
            style="touch-action: none;"
        >
            {decor.name}
        </div>
        {/each}
    </div>

    <!-- Tool Selection -->
    <h4>Tools:</h4>
    <button
        on:click={() => selectTool('water')}
        class:selected={isSelected({ type: 'tool', toolType: 'water' })}
    >
        Watering Can
    </button>
    <button
        on:click={() => selectTool('remove')}
        class:selected={isSelected({ type: 'tool', toolType: 'remove' })}
    >
        Shovel
    </button>

    <!-- Display current selection for debugging -->
    {#if currentAction}
        <p>Tool: {JSON.stringify(currentAction)}</p>
    {:else}
        <p>Tool: None</p>
    {/if}
    {#if $heldItem}
        <p>Holding: {$heldItem.objectType} - {$heldItem.typeId}</p>
    {/if}
</div>

<style>
    .ui-panel {
        position: absolute;
        top: 10px;
        left: 10px;
        background-color: rgba(255, 255, 255, 0.8);
        padding: 15px;
        border-radius: 8px;
        border: 1px solid #ccc;
        z-index: 10; /* Ensure it's above the canvas */
        font-family: sans-serif;
    }
    button {
        display: block;
        margin: 5px 0;
        padding: 8px 12px;
        cursor: pointer;
        border: 1px solid #aaa;
        border-radius: 4px;
        background-color: #eee;
    }
    button:hover {
        background-color: #ddd;
    }
    button.selected {
        background-color: #aaddaa; /* Highlight selected */
        border-color: #585;
        font-weight: bold;
    }
    h3, h4 {
        margin-top: 0;
        margin-bottom: 5px;
    }
    p {
        font-size: 0.8em;
        color: #555;
    }

    .item-list {
        display: flex;
        flex-direction: row;
        gap: 10px;
        margin-bottom: 10px;
    }

    .item {
        padding: 5px 10px;
        border: 1px solid #888;
        border-radius: 5px;
        background-color: #ddd;
        cursor: grab; /* Use grab cursor */
        user-select: none; /* Prevent text selection */
        -webkit-user-select: none; /* Safari */
        -moz-user-select: none; /* Firefox */
        -ms-user-select: none; /* IE */
    }

    .item:hover {
        background-color: #ccc;
    }
</style>