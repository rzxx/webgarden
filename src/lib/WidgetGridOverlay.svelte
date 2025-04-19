<script lang="ts">
    import { widgetStore, updateWidget, removeWidget, type WidgetConfig, uiMode } from './stores';
    import { onDestroy, onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { openSettingsModal } from './modalStore';
    // --- Import Grid Dimensions ---
    import { GRID_ROWS, GRID_COLS, GRID_GAP } from './stores';
    // --- End Import ---

    let widgets: WidgetConfig[] = [];
    const unsubscribeWidgetStore = widgetStore.subscribe((value) => { // Renamed for clarity
        widgets = value;
    });
    onDestroy(unsubscribeWidgetStore); // Correctly placed

    // --- DOM Elements ---
    let gridOverlayElement: HTMLElement;

    // --- Drag State ---
    let draggingWidgetId: string | null = null;
    let draggedElement: HTMLElement | null = null;
    let originalWidgetConfig: WidgetConfig | null = null;
    let currentDragRow: number = 0;
    let currentDragCol: number = 0;
    let cellPlusGapWidth: number = 0;
    let cellPlusGapHeight: number = 0;
    let gridPositionChangedDuringDrag = false;
    let pointerOffsetWithinElement = { x: 0, y: 0 };

    // --- Resize Observer ---
    let resizeObserver: ResizeObserver | null = null; // Initialize as null

    // --- Helper Functions ---
    function getGridStyle(widget: WidgetConfig): string {
        const rowEnd = widget.gridRowStart + widget.gridRowSpan;
        const colEnd = widget.gridColumnStart + widget.gridColumnSpan;
        let style = `grid-area: ${widget.gridRowStart} / ${widget.gridColumnStart} / ${rowEnd} / ${colEnd};`;

        // Apply visual styles ONLY when dragging
        if (widget.id === draggingWidgetId) {
            // Make it float above, slightly transparent, ignore its own pointer events while dragging
            // Position/transform are handled directly on the element style during drag
            style += ` z-index: 10; opacity: 0.65; pointer-events: none;`;
        }
        return style;
    }

    // --- Grid Calculation ---
    function updateCellDimensions() {
        if (!gridOverlayElement) return;
        const overlayRect = gridOverlayElement.getBoundingClientRect();

        // Check for invalid dimensions (can happen during initial render or if hidden)
        if (overlayRect.width <= 0 || overlayRect.height <= 0) {
            console.warn("Overlay has zero dimensions. Skipping cell calculation.");
            cellPlusGapWidth = 1; // Avoid division by zero
            cellPlusGapHeight = 1;
            return;
        }

        // Calculate usable grid area (full overlay size, assuming border-box)
        const gridAreaWidth = overlayRect.width;
        const gridAreaHeight = overlayRect.height;

        // Calculate size of a cell + gap
        const totalGapWidth = (GRID_COLS - 1) * GRID_GAP;
        const totalGapHeight = (GRID_ROWS - 1) * GRID_GAP;
        // Ensure we don't get negative cell sizes if gap is too large for container
        const cellWidth = Math.max(0, (gridAreaWidth - totalGapWidth) / GRID_COLS);
        const cellHeight = Math.max(0, (gridAreaHeight - totalGapHeight) / GRID_ROWS);

        cellPlusGapWidth = cellWidth + GRID_GAP;
        cellPlusGapHeight = cellHeight + GRID_GAP;

        // Handle edge case where dimensions might be zero
        if (cellPlusGapWidth <= 0) cellPlusGapWidth = 1;
        if (cellPlusGapHeight <= 0) cellPlusGapHeight = 1;
    }

    onMount(() => {
        // Defer initial calculation slightly to ensure layout is stable
        requestAnimationFrame(() => {
            updateCellDimensions();
            // --- FIX: Initialize ResizeObserver here ---
            resizeObserver = new ResizeObserver(updateCellDimensions);
            if (gridOverlayElement) {
                resizeObserver.observe(gridOverlayElement);
            }
        });
    });

    // --- FIX: Call onDestroy for the observer at the top level ---
    onDestroy(() => {
        resizeObserver?.disconnect(); // Use optional chaining
    });
    // --- End Fix ---

    // --- Pointer Event Handlers ---
    function handlePointerDown(event: PointerEvent, widget: WidgetConfig) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        updateCellDimensions();
        if (cellPlusGapWidth <= 1 || cellPlusGapHeight <= 1) {
            console.warn('Invalid cell dimensions, aborting drag start.');
            return;
        }

        draggingWidgetId = widget.id;
        originalWidgetConfig = { ...widget };
        draggedElement = event.currentTarget as HTMLElement;

        const elementRect = draggedElement.getBoundingClientRect();
        const overlayRect = gridOverlayElement.getBoundingClientRect();

        pointerOffsetWithinElement = {
            x: event.clientX - elementRect.left,
            y: event.clientY - elementRect.top,
        };

        // Calculate initial grid position and corresponding pixel offset
        currentDragRow = widget.gridRowStart;
        currentDragCol = widget.gridColumnStart;
        const initialTranslateX = elementRect.left - overlayRect.left;
        const initialTranslateY = elementRect.top - overlayRect.top;

        gridPositionChangedDuringDrag = false;

        // Apply initial dragging styles
        draggedElement.style.cursor = 'grabbing';
        draggedElement.style.position = 'absolute'; // Take out of grid flow
        draggedElement.style.left = '0px'; // Position relative to overlay
        draggedElement.style.top = '0px';
        draggedElement.style.width = `${elementRect.width}px`; // Maintain size
        draggedElement.style.height = `${elementRect.height}px`;
        // Set initial transform to match its starting grid cell
        draggedElement.style.transform = `translate(${initialTranslateX}px, ${initialTranslateY}px)`;

        // Force style update via reactivity for opacity/z-index from getGridStyle
        widgets = [...widgets];

        try {
            draggedElement.setPointerCapture(event.pointerId);
        } catch (e) { console.warn("Could not set pointer capture:", e); }

        // Add window listeners
        window.addEventListener('pointermove', handlePointerMove, { passive: false });
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
        window.addEventListener('lostpointercapture', handlePointerUp);
    }

    function handlePointerMove(event: PointerEvent) {
        if (!draggingWidgetId || !originalWidgetConfig || !draggedElement || cellPlusGapWidth <= 1 || cellPlusGapHeight <= 1) return;
        event.preventDefault();

        const overlayRect = gridOverlayElement.getBoundingClientRect();
        // Calculate pointer position relative to the grid overlay
        const currentPointerX = event.clientX - overlayRect.left;
        const currentPointerY = event.clientY - overlayRect.top;

        // Snap to closest grid cell
        let targetCol = Math.round(currentPointerX / cellPlusGapWidth) + 1;
        let targetRow = Math.round(currentPointerY / cellPlusGapHeight) + 1;

        // Clamp based on widget size to prevent dragging off-grid
        targetCol = Math.max(1, Math.min(targetCol, GRID_COLS - originalWidgetConfig.gridColumnSpan + 1));
        targetRow = Math.max(1, Math.min(targetRow, GRID_ROWS - originalWidgetConfig.gridRowSpan + 1));

        // Only update if changed
        if (targetRow !== currentDragRow || targetCol !== currentDragCol) {
            currentDragRow = targetRow;
            currentDragCol = targetCol;
            gridPositionChangedDuringDrag = true;
        }

        // Move the element to the snapped grid cell
        const newLeft = (currentDragCol - 1) * cellPlusGapWidth;
        const newTop = (currentDragRow - 1) * cellPlusGapHeight;
        draggedElement.style.left = `${newLeft}px`;
        draggedElement.style.top = `${newTop}px`;
    }

    function handlePointerUp(event: PointerEvent) {
        if (!draggingWidgetId || !originalWidgetConfig) return;
        event.preventDefault();

        const wasDraggingId = draggingWidgetId;
        const finalTargetRow = currentDragRow;
        const finalTargetCol = currentDragCol;
        const positionChanged = gridPositionChangedDuringDrag &&
            (finalTargetRow !== originalWidgetConfig.gridRowStart || finalTargetCol !== originalWidgetConfig.gridColumnStart);

        const elementToReset = gridOverlayElement.querySelector(`[data-widget-id="${wasDraggingId}"]`) as HTMLElement | null;

        if (elementToReset) {
            if (event.pointerId && elementToReset.hasPointerCapture(event.pointerId)) {
                try {
                    elementToReset.releasePointerCapture(event.pointerId);
                } catch (e) { console.warn("Could not release pointer capture:", e); }
            }
            // Reset styles
            elementToReset.style.cursor = '';
            elementToReset.style.transform = '';
            elementToReset.style.position = '';
            elementToReset.style.left = '';
            elementToReset.style.top = '';
            elementToReset.style.width = '';
            elementToReset.style.height = '';
            elementToReset.style.zIndex = '';
            elementToReset.style.opacity = '';
            elementToReset.style.pointerEvents = '';
        }

        draggingWidgetId = null;
        originalWidgetConfig = null;
        draggedElement = null;
        gridPositionChangedDuringDrag = false;
        pointerOffsetWithinElement = { x: 0, y: 0 };

        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
        window.removeEventListener('lostpointercapture', handlePointerUp);

        if (positionChanged) {
            const widgetToUpdate = get(widgetStore).find(w => w.id === wasDraggingId);
            if (widgetToUpdate) {
                updateWidget({
                    ...widgetToUpdate,
                    gridRowStart: finalTargetRow,
                    gridColumnStart: finalTargetCol,
                });
            } else {
                widgets = [...get(widgetStore)];
            }
        } else {
            widgets = [...get(widgetStore)];
        }
    }

    // --- NEW: Handler for Remove Button ---
    function handleRemoveWidget(event: MouseEvent, widgetId: string) {
        event.stopPropagation(); // Prevent triggering drag start
        console.log("Requesting removal of widget:", widgetId);
        removeWidget(widgetId);
    }

    // --- UPDATED: Handler for Settings Button ---
    function handleOpenSettings(event: MouseEvent, widgetId: string, componentName: string) {
        event.stopPropagation(); // Prevent triggering drag start
        openSettingsModal(widgetId, componentName); // Use the store function
        // console.log(`Opening settings for ${componentName} (ID: ${widgetId})`); // Keep for debug if needed
        // alert(`Settings for ${componentName} (ID: ${widgetId}) - UI not implemented yet.`); // Remove alert
    }
</script>

<div
    class="widget-grid-overlay"
    style="--grid-rows: {GRID_ROWS}; --grid-cols: {GRID_COLS}; --grid-gap: {GRID_GAP}px;"
    bind:this={gridOverlayElement}
    on:pointerdown|self={(e) => { e.preventDefault(); }}
>
    {#each widgets as widget (widget.id)}
        <div
            class="widget-placeholder"
            style="{getGridStyle(widget)}"
            on:pointerdown={(e) => handlePointerDown(e, widget)}
            draggable="false"
            data-widget-id={widget.id}
        >
            <!-- Content of the placeholder -->
            <div class="placeholder-content">
                {widget.componentName} ({widget.gridRowSpan}x{widget.gridColumnSpan})
                <small>{widget.id.substring(0, 6)}</small>
            </div>

			<div class="placeholder-buttons">
				<button
					class="placeholder-button settings-button"
					title="Widget Settings"
					on:click={(e) => handleOpenSettings(e, widget.id, widget.componentName)}
					on:pointerdown|stopPropagation
				>⚙️</button>
				<button
					class="placeholder-button remove-button"
					title="Remove Widget"
					on:click={(e) => handleRemoveWidget(e, widget.id)}
					on:pointerdown|stopPropagation
				>❌</button>
			</div>
            <!-- End Edit Mode Buttons -->
        </div>
    {/each}
</div>

<style>
    .widget-grid-overlay {
        position: relative;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: grid;
        grid-template-rows: repeat(var(--grid-rows, 8), 1fr);
        grid-template-columns: repeat(var(--grid-cols, 12), 1fr);
        gap: var(--grid-gap);
        box-sizing: border-box; /* Still important for the overlay itself */
        z-index: 5;
        pointer-events: auto;
    }

    .widget-placeholder {
        /* Base styles applied always */
        background-color: rgba(100, 150, 255, 0.7);
        border: 1px dashed rgba(0, 0, 150, 0.7);
        box-sizing: border-box;
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-size: 0.8em;
        color: #fff;
        text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        position: relative; /* For z-index */
        will-change: transform, opacity, grid-column, grid-row; /* Hint browser about changes */

        /* Default transitions for hover (when not dragging) */
        transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
        /* Ensure pointer events are enabled for children when needed */
        pointer-events: auto;
    }

    .widget-placeholder[style*="opacity: 0.65"] {
        /* Override hover effect when dragging */
        transform: none !important; /* Prevent hover scale during drag */
    }

    .widget-placeholder:not([style*="opacity: 0.65"]):hover {
        /* Apply hover ONLY if not currently being dragged (using opacity as a proxy) */
        /* This selector is a bit fragile, but avoids needing a separate class */
         background-color: rgba(120, 170, 255, 0.8);
         border-style: solid;
         border-color: rgba(0, 0, 150, 0.9);
         transform: scale(1.01); /* Slight grow on hover */
    }

    /* --- Styles for Placeholder Buttons --- */
    .placeholder-buttons {
        position: absolute;
        top: 2px;
        right: 2px;
        display: flex;
        gap: 3px;
        z-index: 10; /* Above placeholder content */
        pointer-events: auto; /* Ensure buttons are clickable */
    }

    .placeholder-button {
        background-color: rgba(255, 255, 255, 0.7);
        border: 1px solid rgba(0, 0, 0, 0.3);
        border-radius: 4px;
        padding: 1px 4px;
        cursor: pointer;
        font-size: 0.8em;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto; /* Explicitly enable */
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }
    .placeholder-button:hover {
        background-color: rgba(255, 255, 255, 0.9);
        border-color: rgba(0, 0, 0, 0.5);
    }
    .placeholder-button.remove-button:hover {
        background-color: rgba(255, 200, 200, 0.9);
    }
     .placeholder-button.settings-button:hover {
        background-color: rgba(200, 220, 255, 0.9);
    }
    /* --- End Placeholder Button Styles --- */

    .placeholder-content {
        padding: 5px;
        display: flex;
        flex-direction: column;
        pointer-events: none;
    }
    .placeholder-content small {
        font-size: 0.7em;
        opacity: 0.8;
        margin-top: 3px;
    }
</style>