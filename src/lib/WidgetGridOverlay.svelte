<script lang="ts">
	import { widgetStore, updateWidget, type WidgetConfig } from './stores';
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';

	// --- Grid Configuration ---
	const GRID_ROWS = 8;
	const GRID_COLS = 12;
	const GRID_GAP = 10;

	let widgets: WidgetConfig[] = [];
	const unsubscribe = widgetStore.subscribe((value) => {
		widgets = value;
	});

	onDestroy(unsubscribe);

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

	// --- Helper Functions ---
	function getGridStyle(widget: WidgetConfig): string {
		// Determine the effective row/col to use for styling
        const displayRow = (widget.id === draggingWidgetId) ? currentDragRow : widget.gridRowStart;
        const displayCol = (widget.id === draggingWidgetId) ? currentDragCol : widget.gridColumnStart;

        const rowEnd = displayRow + widget.gridRowSpan;
		const colEnd = displayCol + widget.gridColumnSpan;

        // Base styles
        let style = `
            grid-row: ${displayRow} / ${rowEnd};
            grid-column: ${displayCol} / ${colEnd};
        `;

        // Add dragging-specific styles dynamically
        if (widget.id === draggingWidgetId) {
             style += `
                opacity: 0.65;
                transform: scale(1.02);
                z-index: 1000;
                pointer-events: none;
                transition: transform 0.1s ease-out, opacity 0.1s ease-out;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3); /* Add shadow for lift effect */
                border-style: solid; /* Make border solid while dragging */
             `;
        } else {
            // Ensure non-dragged items don't have lingering transitions/styles
            style += `
                transition: none;
                opacity: 1;
                transform: scale(1);
                z-index: 1;
                pointer-events: auto;
                box-shadow: none;
                border-style: dashed; /* Or original style */
            `;
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
            const resizeObserver = new ResizeObserver(updateCellDimensions);
            if (gridOverlayElement) {
                 resizeObserver.observe(gridOverlayElement);
            }
             onDestroy(() => resizeObserver.disconnect());
        });
	});

	// --- Pointer Event Handlers ---
	function handlePointerDown(event: PointerEvent, widget: WidgetConfig) {
		event.preventDefault();
		event.stopPropagation();

		updateCellDimensions(); // Ensure dimensions are current
		if (cellPlusGapWidth <= 1 || cellPlusGapHeight <= 1) { // Use 1 check due to fallback value
            console.error("Cannot start drag: Invalid cell dimensions.");
            return;
        }

		draggingWidgetId = widget.id;
		originalWidgetConfig = { ...widget };
		draggedElement = event.currentTarget as HTMLElement;

		// --- Calculate pointer offset WITHIN the element ---
		const elementRect = draggedElement.getBoundingClientRect();
		pointerOffsetWithinElement = {
			x: event.clientX - elementRect.left,
			y: event.clientY - elementRect.top
		};

		currentDragRow = widget.gridRowStart;
		currentDragCol = widget.gridColumnStart;
		gridPositionChangedDuringDrag = false;

		// Force style update for initial drag appearance
		widgets = [...widgets];

		try {
			draggedElement.setPointerCapture(event.pointerId);
			draggedElement.style.cursor = 'grabbing';
		} catch (e) {
			console.warn("Could not set pointer capture:", e);
		}

		window.addEventListener('pointermove', handlePointerMove, { passive: false }); // Allow preventDefault
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('pointercancel', handlePointerUp);
		window.addEventListener('lostpointercapture', handlePointerUp);

		console.log(`Pointer Down: ${widget.id} at [${currentDragRow}, ${currentDragCol}], offset [${pointerOffsetWithinElement.x.toFixed(0)}, ${pointerOffsetWithinElement.y.toFixed(0)}]`);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!draggingWidgetId || !originalWidgetConfig || cellPlusGapWidth <= 1 || cellPlusGapHeight <= 1) return;
		// Prevent scrolling page during drag on touch devices
		event.preventDefault();

		const overlayRect = gridOverlayElement.getBoundingClientRect();

		// Current pointer relative to overlay
		const currentPointerX = event.clientX - overlayRect.left;
		const currentPointerY = event.clientY - overlayRect.top;

		// --- Calculate desired TOP-LEFT position of the widget ---
		const desiredElementTopLeftX = currentPointerX - pointerOffsetWithinElement.x;
		const desiredElementTopLeftY = currentPointerY - pointerOffsetWithinElement.y;

		// Calculate target grid cell based on the WIDGET'S DESIRED TOP-LEFT position
		let targetCol = Math.floor(desiredElementTopLeftX / cellPlusGapWidth) + 1;
		let targetRow = Math.floor(desiredElementTopLeftY / cellPlusGapHeight) + 1;

		// Clamp based on widget size to keep it within bounds
		targetCol = Math.max(1, Math.min(targetCol, GRID_COLS - originalWidgetConfig.gridColumnSpan + 1));
		targetRow = Math.max(1, Math.min(targetRow, GRID_ROWS - originalWidgetConfig.gridRowSpan + 1));

		// Update temporary position if changed
		if (targetRow !== currentDragRow || targetCol !== currentDragCol) {
			currentDragRow = targetRow;
			currentDragCol = targetCol;
			gridPositionChangedDuringDrag = true;

			// Trigger style update
			widgets = [...widgets];
		}
	}

	function handlePointerUp(event: PointerEvent) {
		if (!draggingWidgetId || !originalWidgetConfig || !draggedElement) return;
		event.preventDefault(); // Prevent clicks after drag, etc.

		console.log(`Pointer Up: ${draggingWidgetId}. Final Target: [${currentDragRow}, ${currentDragCol}]`);

		// --- Update Store ---
		if (gridPositionChangedDuringDrag &&
            (currentDragRow !== originalWidgetConfig.gridRowStart || currentDragCol !== originalWidgetConfig.gridColumnStart))
        {
			console.log(`Updating store: ${draggingWidgetId} to [${currentDragRow}, ${currentDragCol}]`);
			updateWidget({
				...originalWidgetConfig,
				gridRowStart: currentDragRow,
				gridColumnStart: currentDragCol,
			});
		} else {
            console.log(`Position unchanged or returned to start.`);
        }

		// --- Cleanup ---
		try {
			draggedElement.releasePointerCapture(event.pointerId);
			draggedElement.style.cursor = '';
		} catch (e) {
			console.warn("Could not release pointer capture:", e);
		}

		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		window.removeEventListener('pointercancel', handlePointerUp);
		window.removeEventListener('lostpointercapture', handlePointerUp);

		const wasDraggingId = draggingWidgetId; // Keep track for final update
		draggingWidgetId = null;
		originalWidgetConfig = null;
		draggedElement = null;
		gridPositionChangedDuringDrag = false;
        pointerOffsetWithinElement = { x: 0, y: 0 }; // Reset offset

		// Force final style reset for the element that was just dragged
		// We need to ensure its styles revert *after* the store update might have triggered a change
        // Find the widget in the current store state (it might have updated position)
        const finalWidgetState = get(widgetStore).find(w => w.id === wasDraggingId);
        if (finalWidgetState) {
             // Directly trigger reactivity on the widgets array using the latest data
             widgets = get(widgetStore);
        } else {
             // Fallback if widget somehow disappeared (less likely)
             widgets = [...widgets];
        }
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
		>
			<div class="placeholder-content">
				{widget.componentName} ({widget.gridRowSpan}x{widget.gridColumnSpan})
				<small>{widget.id.substring(0, 6)}</small>
			</div>
		</div>
	{/each}
</div>

<style>
	.widget-grid-overlay {
		position: absolute;
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
		pointer-events: none;
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
        transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease, opacity 0.2s ease, box-shadow 0.2s ease;
	}

    .widget-placeholder:not([style*="opacity: 0.65"]):hover {
        /* Apply hover ONLY if not currently being dragged (using opacity as a proxy) */
        /* This selector is a bit fragile, but avoids needing a separate class */
         background-color: rgba(120, 170, 255, 0.8);
		 border-style: solid;
		 border-color: rgba(0, 0, 150, 0.9);
         transform: scale(1.01); /* Slight grow on hover */
    }


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