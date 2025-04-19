<script lang="ts">
    import { onMount } from 'svelte';
    // --- Import stores ---
    import { selectedAction, availablePlants, availableDecor, type SelectedAction,
        heldItem, isDraggingItem, type HeldItemInfo, selectedObjectInfo, uiMode, type UIMode,
        // --- NEW: Import widget store and add function ---
        widgetStore, addWidget, type WidgetConfig,
        // --- Import Grid Dimensions ---
        GRID_ROWS,
        GRID_COLS,
        // --- End Import ---
    } from './stores';
    // --- Import default sizes/settings from registry ---
    import { defaultWidgetSettings, defaultWidgetSize } from './widgetRegistry';
    // --- End Import ---
    import { get } from 'svelte/store';
    import { inventory, getInventoryItemQuantity, addInventoryItem } from './inventory';

    const DAILY_ITEM_COUNT = 5;
    const LAST_DAILY_REWARD_KEY = 'lastDailyRewardDate';

    onMount(() => {
        const today = new Date().toDateString(); // Get date string (YYYY-MM-DD)
        const lastRewardDate = localStorage.getItem(LAST_DAILY_REWARD_KEY);

        if (lastRewardDate !== today) {
            console.log("Granting daily items...");
            const allAvailableItems = [
                ...availablePlants.map(p => ({ id: p.id, type: 'plant' })),
                ...availableDecor.map(d => ({ id: d.id, type: 'decor' }))
            ];

            if (allAvailableItems.length > 0) {
                for (let i = 0; i < DAILY_ITEM_COUNT; i++) {
                    const randomIndex = Math.floor(Math.random() * allAvailableItems.length);
                    const randomItem = allAvailableItems[randomIndex];
                    addInventoryItem(randomItem.id, 1); // Add 1 of the random item
                    console.log(`Granted daily item: ${randomItem.id}`);
                }
                localStorage.setItem(LAST_DAILY_REWARD_KEY, today); // Update last reward date
                console.log(`Daily items granted for ${today}.`);
            } else {
                console.warn("No available items to grant for daily reward.");
            }
        } else {
            console.log("Daily items already granted today.");
        }
    });

    // --- Update toggle function to use the store ---
    function toggleUIMode() {
        uiMode.update(currentMode => {
            const newMode = currentMode === 'view' ? 'edit' : 'view';
            // Deselect tool/item when switching modes
            selectedAction.set(null);
            heldItem.set(null);
            isDraggingItem.set(false);
            selectedObjectInfo.set(null); // Also clear selection info
            console.log(`Switched UI mode to: ${newMode}`);
            return newMode;
        });
    }
    // --- End Update ---

    function selectTool(toolType: 'water' | 'remove') {
        // --- Use store value for check ---
        if (toolType === 'remove' && get(uiMode) !== 'edit') { // Use get(uiMode)
            console.warn("Cannot select remove tool in view mode.");
            return;
        }
        // --- End Check ---

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
        // --- Use store value for check ---
        if (get(uiMode) !== 'edit') { // Use get(uiMode)
            console.warn("Cannot pick up items in view mode.");
            return;
        }
        // --- End Check ---

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

    // --- NEW: Function to add a default widget ---
    function handleAddWidget(componentName: string) {
        const currentWidgets = get(widgetStore);
        // --- Use default size from registry ---
        const defaultSize = defaultWidgetSize[componentName] || { rows: 2, cols: 2 }; // Fallback size
        const defaultRowSpan = defaultSize.rows;
        const defaultColSpan = defaultSize.cols;
        // --- End Default Size ---

        let foundSpot = false;
        let targetRow = 1;
        let targetCol = 1;

        // Use imported GRID_ROWS / GRID_COLS in the loops and checks
        for (let r = 1; r <= GRID_ROWS; r++) {
            for (let c = 1; c <= GRID_COLS; c++) {
                if (r + defaultRowSpan - 1 <= GRID_ROWS && c + defaultColSpan - 1 <= GRID_COLS) {
                    // ... overlap check logic (uses defaultRowSpan/defaultColSpan) ...
                }
            }
            // ...
        }
        // ...

        if (!foundSpot) {
            // ... error handling ...
            return;
        }

        const newWidget: WidgetConfig = {
            id: `widget-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            componentName: componentName,
            gridRowStart: targetRow,
            gridColumnStart: targetCol,
            gridRowSpan: defaultRowSpan, // Use determined default
            gridColumnSpan: defaultColSpan, // Use determined default
            // --- Use default settings from registry ---
            settings: JSON.parse(JSON.stringify(defaultWidgetSettings[componentName] || {})), // Deep copy
        };
        addWidget(newWidget);
        console.log(`Added ${componentName} at [${targetRow}, ${targetCol}]`);
    }
    // --- End Add Widget Function ---

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

<!-- Use $uiMode store subscription in the template -->
<div class="ui-panel">
    <h3>Toolbox</h3>

    <button on:click={toggleUIMode} class="mode-toggle">
        {$uiMode === 'view' ? 'Switch to Edit Mode' : 'Switch to View Mode'}
    </button>

    {#if $uiMode === 'edit'}
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

        <!-- NEW: Widget Management Section (Edit Mode Only) -->
        <h4>Widgets:</h4>
        <div class="widget-controls">
             <button on:click={() => handleAddWidget('ClockWidget')}>
                Add Clock Widget
            </button>
            <!-- Add buttons for other widget types here -->
            <!-- <button on:click={() => handleAddWidget('WeatherWidget')}>Add Weather</button> -->
        </div>
        <!-- End Widget Management Section -->

    {/if} <!-- End Edit Mode Item Selection -->

    <h4>Tools:</h4>
    <button on:click={() => selectTool('water')} class:selected={isSelected({ type: 'tool', toolType: 'water' })}>
        Watering Can {@html isSelected({ type: 'tool', toolType: 'water' }) ? ' (Selected)' : ''}
    </button>
    {#if $uiMode === 'edit'}
        <button on:click={() => selectTool('remove')} class:selected={isSelected({ type: 'tool', toolType: 'remove' })}>
            Shovel {@html isSelected({ type: 'tool', toolType: 'remove' }) ? ' (Selected)' : ''}
        </button>
    {/if}

    {#if $uiMode === 'edit' && $heldItem}
        <div class="info-section drag-info">
            <h4>Dragging: {$heldItem.typeId}</h4>
            <p>Move to grid & release to place.</p>
            <p>Press Q/E or scroll to rotate.</p>
        </div>
    {/if}

    {#if $uiMode === 'edit' && $selectedObjectInfo && !$heldItem && !currentAction}
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

    /* Style for the mode toggle button */
    .mode-toggle {
        background-color: #d0e0f0; /* Light blue background */
        border-color: #a0c0e0;
        margin-bottom: 15px; /* Add space below */
        text-align: center; /* Center text */
        font-weight: bold;
    }
    .mode-toggle:hover {
        background-color: #b0d0f0;
    }

    /* NEW: Styles for widget controls */
    .widget-controls {
        margin-bottom: 15px; /* Add space below */
    }
    .widget-controls button {
        background-color: #e0d0f0; /* Light purple background */
        border-color: #c0a0e0;
        font-size: 0.85em; /* Slightly smaller */
        padding: 8px 10px;
    }
     .widget-controls button:hover {
        background-color: #d0b0e8;
    }
    /* --- End Widget Control Styles --- */
</style>