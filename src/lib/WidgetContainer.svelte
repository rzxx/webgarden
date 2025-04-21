<script lang="ts">
    import { widgetStore, type WidgetConfig } from './stores';
    import { onDestroy } from 'svelte';
    // --- Import centralized map and dimensions ---
    import { widgetComponentMap } from './widgetRegistry';
    import { GRID_ROWS, GRID_COLS, GRID_GAP } from './stores';
    // --- End Import ---

    let widgets: WidgetConfig[] = [];
    const unsubscribe = widgetStore.subscribe(value => {
        widgets = value;
    });

    onDestroy(unsubscribe);

    function getGridStyle(widget: WidgetConfig): string {
        const rowEnd = widget.gridRowStart + widget.gridRowSpan;
        const colEnd = widget.gridColumnStart + widget.gridColumnSpan;
        return `grid-area: ${widget.gridRowStart} / ${widget.gridColumnStart} / ${rowEnd} / ${colEnd};`;
    }
</script>

<div
    class="widget-grid-container"
    style="--grid-rows: {GRID_ROWS}; --grid-cols: {GRID_COLS}; --grid-gap: {GRID_GAP}px;"
>
    {#each widgets as widget (widget.id)}
        {@const Component = widgetComponentMap[widget.componentName]}
        {#if Component}
            <div class="widget-wrapper hidden xl:grid" style="{getGridStyle(widget)}">
                <svelte:component this={Component} settings={widget.settings} />
            </div>
        {:else}
            <div class="widget-wrapper error" style="{getGridStyle(widget)}">
                Unknown Widget: {widget.componentName}
            </div>
        {/if}
    {/each}
</div>

<style>
    .widget-grid-container {
        padding: 16px;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        /* Use CSS variables defined inline for grid dimensions */
        display: none;
        @media (width >= 80rem /* 1280px */) {
            display: grid;
        }
        grid-template-rows: repeat(var(--grid-rows, 8), 1fr);    /* Default fallback */
        grid-template-columns: repeat(var(--grid-cols, 12), 1fr); /* Default fallback */
        gap: var(--grid-gap, 10px); /* Adjust gap between widgets */
        box-sizing: border-box;
        pointer-events: none; /* Allow clicks to pass through to the canvas initially */
        z-index: 5; /* Position it above the canvas (z=0) but below the main UI (z=10) */
    }

    .widget-wrapper {
        /* Allow widgets inside to be interactive */
        pointer-events: auto;
    }

    .widget-wrapper.error {
        background-color: lightcoral;
        color: white;
        align-items: center;
        justify-content: center;
        font-weight: bold;
    }
</style>