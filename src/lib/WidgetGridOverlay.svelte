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

        // If this widget is the one being dragged, use the temporary snapped position
		if (widget.id === draggingWidgetId) {
            displayRowStart = currentDragSnapRow;
            displayColStart = currentDragSnapCol;
		} else {
            // Otherwise, use its stored position from the store
            displayRowStart = widget.gridRowStart;
            displayColStart = widget.gridColumnStart;
        }

        // Calculate end positions based on the display start and span
        const rowEnd = displayRowStart + widget.gridRowSpan;
		const colEnd = displayColStart + widget.gridColumnSpan;

		// Combine grid placement
		return `
            grid-area: ${displayRowStart} / ${displayColStart} / ${rowEnd} / ${colEnd};
        `;
	}

    // --- Grid Calculation ---
    function updateCellDimensions() {
		if (!gridOverlayElement) return;

        if (gridOverlayElement.offsetParent === null) {
            console.warn('WidgetGridOverlay is hidden, skipping dimension calculation.');
            cellPlusGapWidth = 1; // Prevent potential division by zero later
            cellPlusGapHeight = 1;
            return;
        }
        
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
			if (gridOverlayElement && gridOverlayElement.offsetParent !== null) {
                updateCellDimensions(); // Initial calculation
                resizeObserver = new ResizeObserver(updateCellDimensions);
                resizeObserver.observe(gridOverlayElement);
            } else if (gridOverlayElement) {
                 console.log("WidgetGridOverlay initially hidden, ResizeObserver not attached.");
                 // Consider adding logic here to attach the observer if/when it becomes visible,
                 // e.g., using another ResizeObserver on a parent or a store subscription.
            }
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

        // 4. Trigger reactivity
        // TODO: check if needed with tailwind styles rewrite
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
            class="box-border overflow-hidden rounded-xl flex flex-col justify-between p-2
            cursor-move select-none touch-none pointer-events-auto
            bg-whitealpha hover:bg-darkerwhitealpha data-[dragged=true]:bg-white transition duration-150
            font-outfit"
            data-dragged={widget.id === draggingWidgetId}
            on:pointerdown={(e) => handlePointerDown(e, widget)}
            draggable="false"
            data-widget-id={widget.id}
            style={getGridStyle(widget)}
        >
            <!-- Content of the widget placeholder -->
            {#if widget.gridRowSpan < widget.gridColumnSpan}
                <div class="flex justify-between items-start">
                    <div class="-mt-1">
                        <p class="text-brighterblack">{widget.componentName}</p>
                        <p class="text-xs text-brightblack font-light">{widget.gridRowSpan}x{widget.gridColumnSpan}</p>
                    </div>
                    <button class="bg-red hover:bg-darkerred transition duration-150 cursor-pointer rounded-xl px-1
                    flex justify-center items-center w-fit h-fit" title="Remove Widget"
                    on:click={(e) => handleRemoveWidget(e, widget.id)} on:pointerdown|stopPropagation>
                        <span class="material-symbols-outlined text-brighterblack" style="font-size: 1rem;">
                            close
                        </span>
                    </button>
                </div>
                <div class="self-end">
                    <button
                        class="bg-brightblack hover:bg-brighterblack transition duration-150 cursor-pointer rounded-xl px-2
                        flex justify-center items-center" title="Widget Settings"
                        on:click={(e) => handleOpenSettings(e, widget.id, widget.componentName)}
                        on:pointerdown|stopPropagation>
                        <p class="text-darkerwhite font-light">Open Settings</p>
                    </button>
                </div>
            {:else}
                <div class="flex flex-col">
                    <button class="bg-red hover:bg-darkerred transition duration-150 cursor-pointer rounded-xl px-2
                    flex justify-center items-center w-fit h-fit self-end" title="Remove Widget"
                    on:click={(e) => handleRemoveWidget(e, widget.id)} on:pointerdown|stopPropagation>
                        <span class="material-symbols-outlined text-brighterblack" style="font-size: 1rem;">
                            close
                        </span>
                    </button>
                    <div class='self-center text-center mt-1'>
                        <p class="text-brighterblack text-sm">{widget.componentName}</p>
                        <p class="text-xs text-brightblack font-light">{widget.gridRowSpan}x{widget.gridColumnSpan}</p>
                    </div>
                </div>
                <div class="self-center w-full">
                    <button
                        class="bg-brightblack hover:bg-brighterblack transition duration-150 cursor-pointer rounded-xl
                        flex justify-center items-center w-full" title="Widget Settings"
                        on:click={(e) => handleOpenSettings(e, widget.id, widget.componentName)}
                        on:pointerdown|stopPropagation>
                        <p class="text-darkerwhite font-light text-sm">Open Settings</p>
                    </button>
                </div>
            {/if}
            
			
            <!-- End Edit Mode Buttons -->
        </div>
    {/each}
</div>

<style>
    .widget-grid-overlay {
        position: absolute; /* Needs to overlay the container */
        top: 0; left: 0; width: 100%; height: 100%;
        display: none;
        @media (width >= 80rem /* 1280px */) {
            display: grid;
        }
        grid-template-rows: repeat(var(--grid-rows, 8), 1fr);
        grid-template-columns: repeat(var(--grid-cols, 12), 1fr);
        gap: var(--grid-gap);
        box-sizing: border-box;
        z-index: 6; /* Above widget container */
        pointer-events: none; /* Overlay bg doesn't block */
        padding: 16px;
    }
</style>