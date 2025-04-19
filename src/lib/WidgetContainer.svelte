<script lang="ts">
    import { widgetStore, type WidgetConfig } from './stores';
    import { onDestroy } from 'svelte';

    // --- Widget Component Mapping ---
    // This map is crucial. It links the 'componentName' string stored in
    // WidgetConfig to the actual Svelte component constructor.
    // You need to import your actual widget components here.
    import ClockWidget from './widgets/ClockWidget.svelte'; // Example: Assuming you create this later
    // import WeatherWidget from './widgets/WeatherWidget.svelte'; // Example

    const widgetComponentMap: Record<string, any> = {
        ClockWidget: ClockWidget,
        // WeatherWidget: WeatherWidget,
        // Add other widget components here as you create them
    };
    // --- End Widget Component Mapping ---

    // Define the grid dimensions (adjust as needed)
    // These should match the grid you'll use for editing later.
    const GRID_ROWS = 8;
    const GRID_COLS = 12;

    let widgets: WidgetConfig[] = [];
    const unsubscribe = widgetStore.subscribe(value => {
        widgets = value;
    });

    onDestroy(unsubscribe);

    // Helper function to calculate grid-column-end and grid-row-end
    function getGridStyle(widget: WidgetConfig): string {
        const rowEnd = widget.gridRowStart + widget.gridRowSpan;
        const colEnd = widget.gridColumnStart + widget.gridColumnSpan;
        return `
            grid-row-start: ${widget.gridRowStart};
            grid-column-start: ${widget.gridColumnStart};
            grid-row-end: ${rowEnd};
            grid-column-end: ${colEnd};
        `;
        // Alternative using span:
        // return `
        //  grid-row: ${widget.gridRowStart} / span ${widget.gridRowSpan};
        //  grid-column: ${widget.gridColumnStart} / span ${widget.gridColumnSpan};
        // `;
    }
</script>

<!-- This container defines the grid layout -->
<div
    class="widget-grid-container"
    style="--grid-rows: {GRID_ROWS}; --grid-cols: {GRID_COLS};"
>
    {#each widgets as widget (widget.id)}
        {@const component = widgetComponentMap[widget.componentName]}
        {#if component}
            <!-- Each widget wrapper is placed onto the grid -->
            <div class="widget-wrapper" style={getGridStyle(widget)}>
                <!-- Dynamically render the correct widget component -->
                <svelte:component this={component} settings={widget.settings} />
            </div>
        {:else}
             <!-- Optional: Display a placeholder or error if component not found -->
             <div class="widget-wrapper widget-error" style={getGridStyle(widget)}>
                <p>Error: Widget '{widget.componentName}' not found.</p>
                <p>(ID: {widget.id})</p>
            </div>
        {/if}
    {/each}
</div>

<style>
    .widget-grid-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        /* Use CSS variables defined inline for grid dimensions */
        display: grid;
        grid-template-rows: repeat(var(--grid-rows, 8), 1fr);    /* Default fallback */
        grid-template-columns: repeat(var(--grid-cols, 12), 1fr); /* Default fallback */
        gap: 10px; /* Adjust gap between widgets */
        box-sizing: border-box;
        pointer-events: none; /* Allow clicks to pass through to the canvas initially */
        z-index: 5; /* Position it above the canvas (z=0) but below the main UI (z=10) */
    }

    .widget-wrapper {
        /* Allow widgets inside to be interactive */
        pointer-events: auto;
        background-color: rgba(255, 255, 255, 0.6); /* Example background */
        border-radius: 8px;
        padding: 10px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        overflow: hidden; /* Prevent content spilling out */
        display: flex; /* Use flexbox for content alignment */
        flex-direction: column;
        justify-content: center; /* Center content vertically */
        align-items: center; /* Center content horizontally */
        box-sizing: border-box;
    }

     .widget-error {
        background-color: rgba(255, 180, 180, 0.7);
        border: 1px solid red;
        color: darkred;
        font-size: 0.8em;
        align-items: flex-start; /* Align error text top-left */
        justify-content: flex-start;
    }
    .widget-error p {
        margin: 2px 0;
    }
</style>