<script lang="ts">
    import { widgetStore, updateWidget, removeWidget, type WidgetConfig } from './stores';
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
	let currentDragSnapRow: number = 0;
	let currentDragSnapCol: number = 0;
	let pointerOffsetWithinElement = { x: 0, y: 0 }; // Click offset inside the element
    let gridPositionChangedDuringDrag = false; // Tracks if snap position changed *at all* during the move sequence
    let dragWasInitiatedOnWidget = false;

    // --- Grid Calculation State ---
	let cellPlusGapWidth: number = 0;
	let cellPlusGapHeight: number = 0;

	// --- Resize Observer ---
	let resizeObserver: ResizeObserver | null = null;

    // --- Helper Functions ---
    function getGridStyle(widget: WidgetConfig): string {
        // Use temporary snapped position if dragging, otherwise use store position
        const displayRowStart = widget.id === draggingWidgetId ? currentDragSnapRow : widget.gridRowStart;
        const displayColStart = widget.id === draggingWidgetId ? currentDragSnapCol : widget.gridColumnStart;
        const rowEnd = displayRowStart + widget.gridRowSpan;
		const colEnd = displayColStart + widget.gridColumnSpan;

		return `grid-area: ${displayRowStart} / ${displayColStart} / ${rowEnd} / ${colEnd};`;
	}

    // --- Grid Calculation ---
    function updateCellDimensions() {
		if (!gridOverlayElement) return;
        // Check visibility more robustly
        if (!gridOverlayElement.offsetParent) {
            // console.warn('WidgetGridOverlay is hidden, skipping dimension calculation.');
            cellPlusGapWidth = 1; // Prevent potential division by zero later
            cellPlusGapHeight = 1;
            return;
        }

		const overlayRect = gridOverlayElement.getBoundingClientRect();
		// Use offsetWidth/Height as they are less likely to be zero during layout shifts
		const gridAreaWidth = gridOverlayElement.offsetWidth;
        const gridAreaHeight = gridOverlayElement.offsetHeight;

		if (gridAreaWidth <= 0 || gridAreaHeight <= 0) {
			// console.warn('Overlay zero dimensions.');
            cellPlusGapWidth = 1;
            cellPlusGapHeight = 1;
            return;
		}

		const totalGapWidth = (GRID_COLS - 1) * GRID_GAP;
        const totalGapHeight = (GRID_ROWS - 1) * GRID_GAP;
		const cellWidth = Math.max(0, (gridAreaWidth - totalGapWidth) / GRID_COLS);
		const cellHeight = Math.max(0, (gridAreaHeight - totalGapHeight) / GRID_ROWS);
		cellPlusGapWidth = cellWidth + GRID_GAP;
        cellPlusGapHeight = cellHeight + GRID_GAP;

		// Ensure non-zero/negative values after calculation
		if (cellPlusGapWidth <= 0) cellPlusGapWidth = 1;
        if (cellPlusGapHeight <= 0) cellPlusGapHeight = 1;
	}

    onMount(() => {
        // Use requestAnimationFrame to ensure layout is stable
		requestAnimationFrame(() => {
			if (gridOverlayElement && gridOverlayElement.offsetParent !== null) {
                updateCellDimensions(); // Initial calculation
                resizeObserver = new ResizeObserver(updateCellDimensions);
                resizeObserver.observe(gridOverlayElement);
            } else if (gridOverlayElement) {
                // Element exists but isn't visible yet, observer will be attached if it becomes visible later
                // (Or we could add a mutation observer on the parent if needed, but often ResizeObserver handles this implicitly when attached)
                // Initial calculation might fail here, updateCellDimensions handles this.
                updateCellDimensions();
            }
		});
	});

    // Correct placement for onDestroy for observer
	onDestroy(() => {
		resizeObserver?.disconnect();
        // Clean up potential dangling listeners if component is destroyed mid-drag
        window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		window.removeEventListener('pointercancel', handlePointerUp);
		window.removeEventListener('lostpointercapture', handlePointerUp);
	});

    // --- Pointer Event Handlers ---
	function handlePointerDown(event: PointerEvent, widget: WidgetConfig) {
        // Only handle primary button (left mouse, touch, pen)
		if (event.button !== 0 || !event.isPrimary) return;
        // If event target is one of the buttons, the stopPropagation on them should have already prevented this,
        // but double check just in case. If the target IS a button, do nothing here.
        if ((event.target as HTMLElement)?.closest('button')) {
            return;
        }

		event.preventDefault(); // Prevent text selection/default drag behavior
		event.stopPropagation(); // Stop bubbling up further

		updateCellDimensions(); // Ensure dimensions are current before calculations
		if (cellPlusGapWidth <= 1 || cellPlusGapHeight <= 1) {
            console.warn("Cannot start drag, cell dimensions are invalid.");
            return; // Avoid division by zero or weird behavior
        }

		draggingWidgetId = widget.id;
		originalWidgetConfig = { ...widget };
		draggedElement = event.currentTarget as HTMLElement;

		const elementRect = draggedElement.getBoundingClientRect();
		pointerOffsetWithinElement = {
			x: event.clientX - elementRect.left,
			y: event.clientY - elementRect.top
		};

		// Initialize drag state
		currentDragSnapRow = widget.gridRowStart;
		currentDragSnapCol = widget.gridColumnStart;
		gridPositionChangedDuringDrag = false; // Reset flag
        dragWasInitiatedOnWidget = true; // *** IMPORTANT: Set flag indicating drag started on widget ***

		// Capture pointer and add listeners
		try {
            draggedElement.setPointerCapture(event.pointerId);
            // Add listeners *after* successful capture if possible
            window.addEventListener('pointermove', handlePointerMove, { passive: false }); // passive:false needed for preventDefault
            window.addEventListener('pointerup', handlePointerUp);
            window.addEventListener('pointercancel', handlePointerUp);
            window.addEventListener('lostpointercapture', handlePointerUp);
        } catch (e) {
            console.warn('Could not set pointer capture:', e);
            // If capture fails, maybe clear drag state? Or proceed cautiously.
            // For now, we proceed, but drag might be jerky or interrupted.
             window.addEventListener('pointermove', handlePointerMove, { passive: false });
             window.addEventListener('pointerup', handlePointerUp);
             window.addEventListener('pointercancel', handlePointerUp);
            // No lostpointercapture listener if capture failed.
        }

		// console.log(`Pointer Down (Grid Snap): ${widget.id} at [${currentDragSnapRow}, ${currentDragSnapCol}]`);
	}

    function handlePointerMove(event: PointerEvent) {
		if (!draggingWidgetId || !originalWidgetConfig || !draggedElement || cellPlusGapWidth <= 1 || cellPlusGapHeight <= 1) return;
		event.preventDefault(); // Prevent scroll/selection during drag

		const overlayRect = gridOverlayElement.getBoundingClientRect();
		const pointerXRelativeToOverlay = event.clientX - overlayRect.left;
		const pointerYRelativeToOverlay = event.clientY - overlayRect.top;
		const desiredVisualTopLeftX = pointerXRelativeToOverlay - pointerOffsetWithinElement.x;
		const desiredVisualTopLeftY = pointerYRelativeToOverlay - pointerOffsetWithinElement.y;

        // Calculate target grid cell index (0-based) then convert to 1-based
		const calculatedTargetColIndex = Math.floor(desiredVisualTopLeftX / cellPlusGapWidth);
		const calculatedTargetRowIndex = Math.floor(desiredVisualTopLeftY / cellPlusGapHeight);
        const calculatedTargetCol = calculatedTargetColIndex + 1;
        const calculatedTargetRow = calculatedTargetRowIndex + 1;

		// Clamp target cell to grid boundaries, considering widget span
		const maxCol = GRID_COLS - originalWidgetConfig.gridColumnSpan + 1;
        const maxRow = GRID_ROWS - originalWidgetConfig.gridRowSpan + 1;
		const clampedTargetCol = Math.max(1, Math.min(calculatedTargetCol, maxCol));
		const clampedTargetRow = Math.max(1, Math.min(calculatedTargetRow, maxRow));

		// Update snapped position state *only if it changed*
		if (clampedTargetRow !== currentDragSnapRow || clampedTargetCol !== currentDragSnapCol) {
            currentDragSnapRow = clampedTargetRow;
			currentDragSnapCol = clampedTargetCol;
			gridPositionChangedDuringDrag = true; // Mark that position *did* change at some point

			// *** CRITICAL: Trigger Svelte reactivity to update style ***
            // This forces getGridStyle to re-run for the dragging widget.
			widgets = [...widgets]; // Re-assign to trigger update
		}
	}

    function handlePointerUp(event: PointerEvent) {
		// Capture state *before* clearing it
		const elementThatInitiatedDrag = draggedElement; // Needed for releasing capture
		const endedDragWidgetId = draggingWidgetId;
		const originalConfig = originalWidgetConfig;
        const wasDragStartedOnWidget = dragWasInitiatedOnWidget; // Capture the flag state
        const finalDropRow = currentDragSnapRow; // Use the last snapped position
		const finalDropCol = currentDragSnapCol;

        // --- Cleanup ---
        // Must happen *before* potentially modifying the store or triggering reactivity
        // that relies on the drag state being cleared.

        // 1. Release Pointer Capture
		if (elementThatInitiatedDrag && elementThatInitiatedDrag.hasPointerCapture(event.pointerId)) {
			try { elementThatInitiatedDrag.releasePointerCapture(event.pointerId); }
            catch (e) { console.warn('Could not release pointer capture:', e); }
		}

        // 2. Remove Global Listeners
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		window.removeEventListener('pointercancel', handlePointerUp);
		window.removeEventListener('lostpointercapture', handlePointerUp);

        // 3. Clear Drag State Variables
		draggingWidgetId = null; // Crucial for getGridStyle to use store position
		originalWidgetConfig = null;
		draggedElement = null;
        dragWasInitiatedOnWidget = false; // Reset the flag
        // Keep gridPositionChangedDuringDrag until after the update logic
        // Resetting visual snap state isn't strictly necessary but good practice
        // pointerOffsetWithinElement = { x: 0, y: 0 };
		// currentDragSnapRow = 0;
		// currentDragSnapCol = 0;


        // Exit if drag didn't actually start meaningfully
        if (!endedDragWidgetId || !originalConfig) {
            // Ensure reactivity update if something went wrong mid-way but state was partially set
            widgets = [...get(widgetStore)];
            return;
        }

		// console.log(`Pointer Up (Grid Snap): ${endedDragWidgetId}. Final Snap: [${finalDropRow}, ${finalDropCol}]`);

        // *** NEW CLICK SUPPRESSION LOGIC ***
        // If the drag sequence was started by pointerdown on the widget background
        // (not directly on a button), suppress the upcoming click event.
        if (wasDragStartedOnWidget) {
            const suppressClickHandler = (clickEvent: MouseEvent) => {
                clickEvent.stopPropagation();
                clickEvent.preventDefault();
                // console.log("Suppressed click because drag was initiated on widget background.");
            };
            // Add a one-time listener in the capture phase to stop the click *before* it reaches buttons
            window.addEventListener('click', suppressClickHandler, { capture: true, once: true });
        }


		// --- Update Store and Trigger Final Style Reset ---
		const positionActuallyChanged = (finalDropRow !== originalConfig.gridRowStart || finalDropCol !== originalConfig.gridColumnStart);

		if (positionActuallyChanged) {
			// console.log(`Updating widget ${endedDragWidgetId} to [${finalDropRow}, ${finalDropCol}]`);
            // Fetch latest config in case other properties changed via settings modal etc. during drag
            const latestConfig = get(widgetStore).find(w => w.id === endedDragWidgetId) || originalConfig;
			updateWidget({
				...latestConfig, // Spread latest config first
				gridRowStart: finalDropRow, // Apply new position
				gridColumnStart: finalDropCol
			});
            // The store update will trigger reactivity, calling getGridStyle.
            // Since draggingWidgetId is now null, it will get the final updated position.
		} else {
			// console.log(`Widget ${endedDragWidgetId} position unchanged.`);
			// Position didn't change, but we were visually dragging (scale, bg color).
            // We need to force a reactive update so getGridStyle runs again
            // with draggingWidgetId = null to reset the style to its original state.
            // Use the *current* store state, as no position update is needed.
			widgets = [...get(widgetStore)];
		}

        // Reset this flag *after* use in the update logic
        gridPositionChangedDuringDrag = false;
	}

    // --- Handler for Remove Button ---
    function handleRemoveWidget(event: MouseEvent, widgetId: string) {
        // Stop propagation prevents the click from potentially reaching other handlers
        // AND crucially, stopPropagation on the pointerdown prevents drag initiation.
        event.stopPropagation();
        removeWidget(widgetId);
    }

    function handleOpenSettings(event: MouseEvent, widgetId: string, componentName: string) {
        event.stopPropagation();
        openSettingsModal(widgetId, componentName);
    }
</script>

<div
    class="absolute top-0 left-0 w-full h-full hidden xl:grid z-[6] pointer-events-none box-border p-4"
    style="grid-template-rows: repeat({GRID_ROWS}, 1fr); grid-template-columns: repeat({GRID_COLS}, 1fr); gap: {GRID_GAP}px;"
    bind:this={gridOverlayElement}
    on:pointerdown|self={(e) => { e.preventDefault(); }}
>
    {#each widgets as widget (widget.id)}
        <div
            class="box-border overflow-hidden rounded-xl flex flex-col justify-between p-2
            cursor-move select-none touch-none pointer-events-auto
            bg-white/70 hover:bg-darkerwhite/70 data-[dragged=true]:bg-white transition duration-150
            data-[dragged=true]:scale-105 data-[dragged=true]:z-7
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
                    <div class="-mt-1 flex-shrink">
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

