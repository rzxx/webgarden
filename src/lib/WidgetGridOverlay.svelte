<script lang="ts">
    import { widgetStore, updateWidget, removeWidget, type WidgetConfig, uiMode } from './stores';
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { openSettingsModal } from './modalStore';
	import { GRID_ROWS, GRID_COLS, GRID_GAP } from './stores';

	let widgets: WidgetConfig[] = [];
	const unsubscribeWidgetStore = widgetStore.subscribe((value) => {
		widgets = value;
	});
	onDestroy(unsubscribeWidgetStore);

	// --- DOM Elements ---
	let gridOverlayElement: HTMLElement;

	// --- Drag State ---
	let draggingWidgetId: string | null = null;
	let draggedElement: HTMLElement | null = null; // The placeholder element that initiated the drag
	let originalWidgetConfig: WidgetConfig | null = null;
	// --- State: Current snapped grid position during drag ---
	let currentDragSnapRow: number = 0;
	let currentDragSnapCol: number = 0;
	let cellPlusGapWidth: number = 0;
	let cellPlusGapHeight: number = 0;
	let gridPositionChangedDuringDrag = false; // Tracks if snap position changed from start
	let pointerOffsetWithinElement = { x: 0, y: 0 }; // Click offset inside the element

	// --- Resize Observer ---
	let resizeObserver: ResizeObserver | null = null;

    // --- Helper Functions ---
    function getGridStyle(widget: WidgetConfig): string {
        let displayRowStart: number;
        let displayColStart: number;
        let extraStyles = ''; // For dragging visuals

        // If this widget is the one being dragged, use the temporary snapped position
		if (widget.id === draggingWidgetId) {
            displayRowStart = currentDragSnapRow;
            displayColStart = currentDragSnapCol;
            // Add visual styles for the element being dragged
            extraStyles = `
                opacity: 0.65;
                transform: scale(1.02); /* Slight lift effect */
                z-index: 1000; /* Ensure it's above others */
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                border-style: solid; /* Make border more prominent */
                transition: transform 0.1s ease-out, opacity 0.1s ease-out, box-shadow 0.1s ease-out; /* Smooth appearance changes */
                pointer-events: none; /* Ignore pointer events on itself while dragging */
            `;
		} else {
            // Otherwise, use its stored position from the store
            displayRowStart = widget.gridRowStart;
            displayColStart = widget.gridColumnStart;
            // Ensure non-dragged items don't have lingering drag styles/transitions
            extraStyles = `
                opacity: 1;
                transform: scale(1);
                z-index: 1;
                box-shadow: none;
                border-style: dashed; /* Or your default style */
                transition: none; /* Prevent transitions unless specifically hovering */
                pointer-events: auto; /* Make sure non-dragged are interactive */
            `;
        }

        // Calculate end positions based on the display start and span
        const rowEnd = displayRowStart + widget.gridRowSpan;
		const colEnd = displayColStart + widget.gridColumnSpan;

		// Combine grid placement and dynamic styles
		return `
            grid-area: ${displayRowStart} / ${displayColStart} / ${rowEnd} / ${colEnd};
            ${extraStyles}
        `;
	}

    // --- Grid Calculation ---
    function updateCellDimensions() {
		if (!gridOverlayElement) return;
		const overlayRect = gridOverlayElement.getBoundingClientRect();
		if (overlayRect.width <= 0 || overlayRect.height <= 0) {
			console.warn('Overlay zero dimensions.'); cellPlusGapWidth = 1; cellPlusGapHeight = 1; return;
		}
		const gridAreaWidth = overlayRect.width; const gridAreaHeight = overlayRect.height;
		const totalGapWidth = (GRID_COLS - 1) * GRID_GAP; const totalGapHeight = (GRID_ROWS - 1) * GRID_GAP;
		const cellWidth = Math.max(0, (gridAreaWidth - totalGapWidth) / GRID_COLS);
		const cellHeight = Math.max(0, (gridAreaHeight - totalGapHeight) / GRID_ROWS);
		cellPlusGapWidth = cellWidth + GRID_GAP; cellPlusGapHeight = cellHeight + GRID_GAP;
		if (cellPlusGapWidth <= 0) cellPlusGapWidth = 1; if (cellPlusGapHeight <= 0) cellPlusGapHeight = 1;
	}

    onMount(() => {
		requestAnimationFrame(() => {
			updateCellDimensions();
			resizeObserver = new ResizeObserver(updateCellDimensions);
			if (gridOverlayElement) { resizeObserver.observe(gridOverlayElement); }
		});
	});

    // Correct placement for onDestroy for observer
	onDestroy(() => {
		resizeObserver?.disconnect();
	});

    // --- Pointer Event Handlers ---
	function handlePointerDown(event: PointerEvent, widget: WidgetConfig) {
		if (event.button !== 0 || !event.isPrimary) return;
		event.preventDefault();
		event.stopPropagation();

		updateCellDimensions();
		if (cellPlusGapWidth <= 1 || cellPlusGapHeight <= 1) return;

		draggingWidgetId = widget.id;
		originalWidgetConfig = { ...widget };
		draggedElement = event.currentTarget as HTMLElement; // Element that received the event

		const elementRect = draggedElement.getBoundingClientRect();

		// 1. Calculate pointer offset WITHIN the clicked element
		pointerOffsetWithinElement = {
			x: event.clientX - elementRect.left,
			y: event.clientY - elementRect.top
		};

		// 2. Initialize the drag state's snapped position to the widget's current position
		currentDragSnapRow = widget.gridRowStart;
		currentDragSnapCol = widget.gridColumnStart;
		gridPositionChangedDuringDrag = false;

        // 3. Set cursor style on the element that triggered the drag
        draggedElement.style.cursor = 'grabbing';

        // 4. Trigger reactivity to apply initial dragging styles via getGridStyle
        // This will make the element slightly transparent, scaled, etc.
        widgets = [...widgets];

		// 5. Capture pointer and add listeners
		try { draggedElement.setPointerCapture(event.pointerId); }
        catch (e) { console.warn('Could not set pointer capture:', e); }

		window.addEventListener('pointermove', handlePointerMove, { passive: false });
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('pointercancel', handlePointerUp);
		window.addEventListener('lostpointercapture', handlePointerUp);
		console.log(`Pointer Down (Grid Snap): ${widget.id} at [${currentDragSnapRow}, ${currentDragSnapCol}]`);
	}

    function handlePointerMove(event: PointerEvent) {
		if (!draggingWidgetId || !originalWidgetConfig || !draggedElement || cellPlusGapWidth <= 1 || cellPlusGapHeight <= 1) return;
		event.preventDefault(); // Prevent scroll/selection

		const overlayRect = gridOverlayElement.getBoundingClientRect();

		// 1. Current pointer relative to overlay
		const pointerXRelativeToOverlay = event.clientX - overlayRect.left;
		const pointerYRelativeToOverlay = event.clientY - overlayRect.top;

		// 2. Calculate where the element's TOP-LEFT corner *would ideally be* based on pointer & offset
		const desiredVisualTopLeftX = pointerXRelativeToOverlay - pointerOffsetWithinElement.x;
		const desiredVisualTopLeftY = pointerYRelativeToOverlay - pointerOffsetWithinElement.y;

		// 3. Calculate the target grid cell based on this desired top-left position
		const calculatedTargetCol = Math.floor(desiredVisualTopLeftX / cellPlusGapWidth) + 1;
		const calculatedTargetRow = Math.floor(desiredVisualTopLeftY / cellPlusGapHeight) + 1;

		// 4. Clamp this calculated target cell to grid boundaries
		const clampedTargetCol = Math.max(1, Math.min(calculatedTargetCol, GRID_COLS - originalWidgetConfig.gridColumnSpan + 1));
		const clampedTargetRow = Math.max(1, Math.min(calculatedTargetRow, GRID_ROWS - originalWidgetConfig.gridRowSpan + 1));

		// 5. Check if the *clamped* target cell is different from the current *snapped* position state
		if (clampedTargetRow !== currentDragSnapRow || clampedTargetCol !== currentDragSnapCol) {
			// Update the state storing the current snapped position
            currentDragSnapRow = clampedTargetRow;
			currentDragSnapCol = clampedTargetCol;
			gridPositionChangedDuringDrag = true;

            // console.log(`Grid Snap Move: Target [${currentDragSnapRow}, ${currentDragSnapCol}]`); // Debug

			// --- CRITICAL: Trigger Svelte reactivity ---
            // This forces getGridStyle to re-run for the dragging widget, updating its
            // grid-area property and making it visually jump to the new snapped cell.
			widgets = [...widgets];
		}
	}

    function handlePointerUp(event: PointerEvent) {
		// Capture state before clearing
		const elementInitiatingDrag = draggedElement; // The element we set cursor/capture on
		const endedDragWidgetId = draggingWidgetId;
		const originalConfig = originalWidgetConfig;

		if (!endedDragWidgetId || !originalConfig || !elementInitiatingDrag) {
            // Cleanup listeners if drag didn't start properly
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
            window.removeEventListener('lostpointercapture', handlePointerUp);
            return;
        }

		event.preventDefault();
		console.log(`Pointer Up (Grid Snap): ${endedDragWidgetId}. Final Snap: [${currentDragSnapRow}, ${currentDragSnapCol}]`);

		// --- Final Position is the last snapped state ---
		const finalDropRow = currentDragSnapRow;
		const finalDropCol = currentDragSnapCol;

		// Determine if the final position is different from the start
		const positionChanged = (finalDropRow !== originalConfig.gridRowStart || finalDropCol !== originalConfig.gridColumnStart);

		// --- Cleanup ---
		// Release capture
		if (event.pointerId && elementInitiatingDrag.hasPointerCapture(event.pointerId)) {
			try { elementInitiatingDrag.releasePointerCapture(event.pointerId); }
            catch (e) { console.warn('Could not release pointer capture:', e); }
		}
        // Reset cursor on the element that initiated drag
        elementInitiatingDrag.style.cursor = '';


		// Clear state variables AFTER use
		draggingWidgetId = null; // This is crucial for getGridStyle to stop applying drag styles
		originalWidgetConfig = null;
		draggedElement = null;
		gridPositionChangedDuringDrag = false;
		pointerOffsetWithinElement = { x: 0, y: 0 };
        currentDragSnapRow = 0; // Reset snap state
        currentDragSnapCol = 0;

		// Remove global listeners
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		window.removeEventListener('pointercancel', handlePointerUp);
		window.removeEventListener('lostpointercapture', handlePointerUp);


		// --- Update Store and Trigger Final Style Reset ---
		if (positionChanged) {
			console.log(`Updating widget ${endedDragWidgetId} to [${finalDropRow}, ${finalDropCol}]`);
            const latestConfig = get(widgetStore).find(w => w.id === endedDragWidgetId) || originalConfig;
			updateWidget({
				...latestConfig,
				gridRowStart: finalDropRow,
				gridColumnStart: finalDropCol
			});
            // Store update triggers reactivity, which will call getGridStyle.
            // Since draggingWidgetId is now null, it will get normal styles.
		} else {
			console.log(`Widget ${endedDragWidgetId} position unchanged.`);
			// Need to trigger reactivity manually ONLY IF position didn't change,
            // to ensure getGridStyle runs and removes the drag styles.
            // Use the latest store state to be safe.
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
        position: absolute; /* Needs to overlay the container */
        top: 0; left: 0; width: 100%; height: 100%;
        display: grid;
        grid-template-rows: repeat(var(--grid-rows, 8), 1fr);
        grid-template-columns: repeat(var(--grid-cols, 12), 1fr);
        gap: var(--grid-gap);
        box-sizing: border-box;
        z-index: 6; /* Above widget container */
        pointer-events: none; /* Overlay bg doesn't block */
    }

    .widget-placeholder {
        background-color: rgba(100, 150, 255, 0.7);
        border: 1px dashed rgba(0, 0, 150, 0.7);
        box-sizing: border-box;
        cursor: grab; /* Default cursor */
        display: flex; /* Use flex or grid as needed for content */
        align-items: center;
        justify-content: center;
        text-align: center;
        font-size: 0.8em;
        color: #fff;
        text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        user-select: none; -webkit-user-select: none; touch-action: none;
        position: relative; /* For buttons */
        transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        pointer-events: auto; /* Allow clicking */
    }

    /* Apply hover only when not dragging (checked via styles in getGridStyle) */
    .widget-placeholder:hover {
         background-color: rgba(120, 170, 255, 0.8);
         border-style: solid;
         border-color: rgba(0, 0, 150, 0.9);
         transform: scale(1.01); /* Subtle hover grow */
         box-shadow: 0 3px 8px rgba(0,0,0,0.15);
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