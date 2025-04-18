<script lang="ts">
    import { selectedAction, availablePlants, availableDecor, type SelectedAction,
        heldItem, isDraggingItem, type HeldItemInfo, selectedObjectInfo } from './stores'; // Import new stores
    import { get } from 'svelte/store'; // Import get
    import { inventory, getInventoryItemQuantity } from './inventory';

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
            selectedObjectInfo.set(null);
            // Toggle tool selection
            return JSON.stringify(current) === JSON.stringify(newAction) ? null : newAction;
        });
    }

    // --- Pointer Down Handler for Items ---
    function handleItemPointerDown(event: PointerEvent, itemInfo: HeldItemInfo) {
        // --- Check inventory quantity ---
        const quantity = getInventoryItemQuantity(itemInfo.typeId);
        if (quantity <= 0) {
            console.log(`Cannot pick up ${itemInfo.typeId}, inventory empty.`);
            // Optional: Add visual feedback like a brief shake or color flash
            return; // Prevent drag if out of stock
        }
        // --- End Inventory Check ---

        // Prevent default actions like text selection or browser drag behavior
        event.preventDefault();

        // Clear any selected tool when starting to drag an item
        selectedAction.set(null);
        selectedObjectInfo.set(null);

        // Set the item being held and the dragging state
        heldItem.set(itemInfo);
        isDraggingItem.set(true);

        const targetElement = event.target as HTMLElement; // Capture target element
        targetElement.setPointerCapture(event.pointerId);
        targetElement.classList.add('grabbing');

        // --- releaseAndReset only handles UI cleanup ---
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

    // Helper function to format growth progress
    function formatGrowth(progress: number | undefined): string {
        if (progress === undefined) return '';
        return `${(progress * 100).toFixed(0)}% Grown`;
    }
</script>

<div class="ui-panel">
    <h3>Toolbox</h3>

    <!-- Item Selection -->
    <h4>Plants:</h4>
    <div class="item-list">
        {#each availablePlants as plant}
            {@const quantity = $inventory.get(plant.id) || 0}
            <div
                class="item"
                class:out-of-stock={quantity <= 0}
                role="button" tabindex="0"
                aria-label={`Pick up ${plant.name}${quantity <= 0 ? ' (Out of stock)' : ''}`}
                aria-disabled={quantity <= 0}
                on:pointerdown={(event) => handleItemPointerDown(event, { objectType: 'plant', typeId: plant.id })}
                style="touch-action: none;"
            >{plant.name} ({quantity})</div>
        {/each}
    </div>
    <h4>Decor:</h4>
    <div class="item-list">
        {#each availableDecor as decor}
            {@const quantity = $inventory.get(decor.id) || 0}
            <div
                class="item"
                class:out-of-stock={quantity <= 0}
                role="button" tabindex="0"
                aria-label={`Pick up ${decor.name}${quantity <= 0 ? ' (Out of stock)' : ''}`}
                aria-disabled={quantity <= 0}
                on:pointerdown={(event) => handleItemPointerDown(event, { objectType: 'decor', typeId: decor.id })}
                style="touch-action: none;"
            >{decor.name} ({quantity})</div>
        {/each}
    </div>

    <!-- Tool Selection -->
    <h4>Tools:</h4>
    <button on:click={() => selectTool('water')} class:selected={isSelected({ type: 'tool', toolType: 'water' })}>
        Watering Can {@html isSelected({ type: 'tool', toolType: 'water' }) ? ' (Selected)' : ''}
    </button>
    <button on:click={() => selectTool('remove')} class:selected={isSelected({ type: 'tool', toolType: 'remove' })}>
        Shovel {@html isSelected({ type: 'tool', toolType: 'remove' }) ? ' (Selected)' : ''}
    </button>

    <!-- Drag Controls Info -->
    {#if $heldItem}
        <div class="info-section drag-info">
            <h4>Dragging: {$heldItem.typeId}</h4>
            <p>Move to grid & release to place.</p>
            <p>Press Q/E or scroll to rotate.</p>
        </div>
    {/if}

    <!-- NEW: Selected Object Info Display -->
    {#if $selectedObjectInfo && !$heldItem && !currentAction}
        <div class="info-section selection-info">
            <h4>Selection:</h4>
            <p><strong>{$selectedObjectInfo.name}</strong> ({$selectedObjectInfo.objectType})</p>
            <p>Status: {$selectedObjectInfo.status}</p>
            {#if $selectedObjectInfo.objectType === 'plant'}
                <p>{formatGrowth($selectedObjectInfo.growthProgress)}</p>
            {/if}
            <p style="font-size: 0.7em; color: #666;">@ [{$selectedObjectInfo.gridPos.row}, {$selectedObjectInfo.gridPos.col}]</p>
        </div>
    {/if}
</div>

<style>
    .ui-panel {
        position: absolute;
        top: 10px;
        left: 10px;
        background-color: rgba(255, 255, 255, 0.85); /* Slightly less transparent */
        padding: 15px;
        border-radius: 8px;
        border: 1px solid #ccc;
        z-index: 10;
        font-family: sans-serif;
        width: 220px; /* Give it a fixed width? */
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    }
    button {
        display: block;
        width: 100%; /* Make buttons fill width */
        box-sizing: border-box; /* Include padding/border in width */
        margin: 8px 0; /* Increased margin */
        padding: 10px 12px; /* Slightly bigger padding */
        cursor: pointer;
        border: 1px solid #aaa;
        border-radius: 4px;
        background-color: #eee;
        text-align: left; /* Align text left */
        font-size: 0.9em;
    }
    button:hover {
        background-color: #ddd;
    }
    button.selected {
        background-color: #aaddaa;
        border-color: #585;
        font-weight: bold;
    }
    h3, h4 {
        margin-top: 10px; /* Add margin above headers */
        margin-bottom: 8px; /* Increased margin below headers */
        border-bottom: 1px solid #eee; /* Separator */
        padding-bottom: 4px;
    }
    h3:first-child {
        margin-top: 0; /* No top margin for the very first header */
    }
    p {
        font-size: 0.9em; /* Slightly larger base text */
        color: #333; /* Darker text */
        margin: 4px 0;
    }

    .item-list {
        display: flex;
        flex-wrap: wrap; /* Allow items to wrap */
        gap: 8px; /* Slightly reduced gap */
        margin-bottom: 15px; /* Increased margin */
    }

    .item {
        padding: 6px 10px; /* Adjusted padding */
        border: 1px solid #888;
        border-radius: 5px;
        background-color: #e0e0e0; /* Lighter item background */
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        font-size: 0.85em;
        transition: background-color 0.2s ease; /* Smooth hover */
    }
    .item:hover {
        background-color: #ccc;
    }
    .info-section {
        margin-top: 15px;
        padding-top: 10px;
        border-top: 1px dashed #ccc; /* Separator */
    }
    .info-section h4 {
        margin-top: 0;
        margin-bottom: 5px;
        border-bottom: none; /* Remove double border */
        font-size: 0.95em;
    }
    .info-section p {
        font-size: 0.85em;
        margin: 2px 0;
    }
    .item.out-of-stock {
        color: #999;
        background-color: #f0f0f0;
        cursor: not-allowed;
        pointer-events: none; /* Disable pointer events entirely */
        opacity: 0.6;
    }
    .selection-info strong {
        color: #0056b3; /* Highlight name */
    }

</style>