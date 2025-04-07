<script lang="ts">
    import { selectedAction, availablePlants, type SelectedAction } from './stores';

    function selectPlant(plantType: string) {
        selectedAction.update(current => {
        const newAction: SelectedAction = { type: 'plant', plantType: plantType };
        // Toggle: If already selected, deselect, otherwise select
        return JSON.stringify(current) === JSON.stringify(newAction) ? null : newAction;
        });
    }

    function selectTool(toolType: 'water' | 'remove') {
        selectedAction.update(current => {
        const newAction: SelectedAction = { type: 'tool', toolType: toolType };
        return JSON.stringify(current) === JSON.stringify(newAction) ? null : newAction;
        });
    }

    // Function to handle drag start
    function dragStart(event: DragEvent, plantType: string) {
        if (event.dataTransfer) {
        event.dataTransfer.setData('plantType', plantType); // Store plant type
        event.dataTransfer.effectAllowed = 'copyMove'; // Indicate what operations are allowed
        }
    }

    // Function to handle drag end (optional: for visual feedback)
    function dragEnd(event: DragEvent) {
        // You can add logic here to provide visual feedback after the drag ends
        // For example, reset the appearance of the dragged element
    }

    // Reactive declaration to get the current value for styling
    let currentAction: SelectedAction;
    selectedAction.subscribe(value => {
        currentAction = value;
    });

    // Helper to check if an action is currently selected
    function isSelected(action: SelectedAction): boolean {
        return JSON.stringify(currentAction) === JSON.stringify(action);
    }

</script>

<div class="ui-panel">
    <h3>Tools & Plants</h3>

    <!-- Plant Selection (Draggable) -->
    <h4>Plants:</h4>
    <div class="plant-list">
        {#each availablePlants as plant}
        <div
            class="plant-item"
            draggable="true"
            role="button"
            tabindex="0"
            aria-label={`Drag ${plant.name}`}
            on:dragstart={(event) => dragStart(event, plant.id)}
            on:dragend={dragEnd}
        >
            {plant.name}
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
        <p>Selected: {JSON.stringify(currentAction)}</p>
    {:else}
        <p>Selected: None</p>
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

    .plant-list {
        display: flex;
        flex-direction: row;
        gap: 10px;
        margin-bottom: 10px;
    }

    .plant-item {
        padding: 5px 10px;
        border: 1px solid #888;
        border-radius: 5px;
        background-color: #ddd;
        cursor: grab; /* Change cursor to grab icon */
    }

    .plant-item:hover {
        background-color: #ccc;
    }
</style>