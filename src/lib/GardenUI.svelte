<script lang="ts">
    import { onMount } from 'svelte';
    // --- Import stores ---
    import { selectedAction, availablePlants, availableDecor, type SelectedAction,
        heldItem, isDraggingItem, type HeldItemInfo, selectedObjectInfo, uiMode, type UIMode,
        // --- Import widget store and add function ---
        widgetStore, addWidget, type WidgetConfig,
        // --- Import Grid Dimensions ---
        GRID_ROWS,
        GRID_COLS,
    } from './stores';
    import { plantConfigs, decorConfigs } from './objectConfigs';
    // --- Import default sizes/settings from registry ---
    import { defaultWidgetSettings, defaultWidgetSize } from './widgetRegistry';
    import { get } from 'svelte/store';
    import { inventory, getInventoryItemQuantity, addInventoryItem } from './inventory';
    import ObjectIconRenderer from './ObjectIconRenderer.svelte';

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
        const currentWidgets = get(widgetStore); // Get widgets currently in the store

        // --- Get default size from registry ---
        const defaultSize = defaultWidgetSize[componentName] || { rows: 2, cols: 2 }; // Fallback size
        const newWidgetRowSpan = defaultSize.rows;
        const newWidgetColSpan = defaultSize.cols;
        // --- End Default Size ---

        let foundSpot = false;
        let targetRow = 1;
        let targetCol = 1;

        // Iterate through possible top-left starting positions (r, c)
        for (let r = 1; r <= GRID_ROWS; r++) {
            for (let c = 1; c <= GRID_COLS; c++) {

                // --- 1. Check if the widget FITS within grid boundaries ---
                const fitsHorizontally = (c + newWidgetColSpan - 1 <= GRID_COLS);
                const fitsVertically = (r + newWidgetRowSpan - 1 <= GRID_ROWS);

                if (fitsHorizontally && fitsVertically) {
                    // --- 2. Check for OVERLAP with existing widgets ---
                    let overlaps = false;
                    const potentialRowEnd = r + newWidgetRowSpan - 1;
                    const potentialColEnd = c + newWidgetColSpan - 1;

                    for (const existingWidget of currentWidgets) {
                        const existingRowEnd = existingWidget.gridRowStart + existingWidget.gridRowSpan - 1;
                        const existingColEnd = existingWidget.gridColumnStart + existingWidget.gridColumnSpan - 1;

                        // Check for rectangle intersection (if they *don't* not overlap, they overlap)
                        const horizontalOverlap = !(potentialColEnd < existingWidget.gridColumnStart || c > existingColEnd);
                        const verticalOverlap = !(potentialRowEnd < existingWidget.gridRowStart || r > existingRowEnd);

                        if (horizontalOverlap && verticalOverlap) {
                            overlaps = true;
                            break; // Found an overlap, no need to check further for this (r, c)
                        }
                    }
                    // --- End Overlap Check ---

                    // --- 3. If it fits AND does not overlap, we found a spot! ---
                    if (!overlaps) {
                        targetRow = r;
                        targetCol = c;
                        foundSpot = true;
                        break; // Exit the inner (column) loop
                    }
                }
            } // End column loop
            if (foundSpot) {
                break; // Exit the outer (row) loop if spot found
            }
        } // End row loop

        // --- 4. Handle if no spot was found ---
        if (!foundSpot) {
            console.error(`Could not find an empty spot for a ${newWidgetRowSpan}x${newWidgetColSpan} widget.`);
            alert("No available space on the grid for this widget!"); // User feedback
            return;
        }

        // --- 5. Create and add the new widget ---
        const newWidget: WidgetConfig = {
            id: `widget-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            componentName: componentName,
            gridRowStart: targetRow,
            gridColumnStart: targetCol,
            gridRowSpan: newWidgetRowSpan, // Use determined default
            gridColumnSpan: newWidgetColSpan, // Use determined default
            // Use default settings from registry (deep copy needed)
            settings: JSON.parse(JSON.stringify(defaultWidgetSettings[componentName] || {})),
        };

        addWidget(newWidget); // Add to the store
        console.log(`Added ${componentName} widget with ID ${newWidget.id} at [${targetRow}, ${targetCol}]`);
    }
    // --- End Add Widget Function ---

    function handleRemoveAllWidgets() {
        widgetStore.set([]); // Clear all widgets
        console.log("All widgets removed.");
    }

    // Helper function to determine the unique key for the icon renderer
    function getIconKey(info: typeof $selectedObjectInfo): string | null {
        if (!info) return null; // Return null if no info, key block won't render

        let modelPath: string | null = null;
        const { typeId, objectType, growthProgress, rotationY } = info;
        const rotationKeyPart = `::rot${rotationY ?? 0}`; // Add rotation to the key

        if (objectType === 'plant') {
            const config = plantConfigs[typeId]; // Don't use default here initially
            if (!config) {
                console.warn(`Parent Key Calc: Plant config not found for ID "${typeId}".`);
                // Fallback strategy? Use typeId itself or a generic key?
                return `${typeId}-config-missing`; // Use typeId as part of the key
            }
            if (!config.growthStages || config.growthStages.length === 0) {
                console.error(`Parent Key Calc: Plant config for "${typeId}" has no growthStages.`);
                return `${typeId}-no-stages`;
            }

            const clampedGrowth = Math.max(0, Math.min(1, growthProgress ?? 1.0));
            const sortedStages = [...config.growthStages].sort((a, b) => a.maxGrowth - b.maxGrowth);
            const stage = sortedStages.find(s => clampedGrowth <= s.maxGrowth) ?? sortedStages[sortedStages.length - 1];

            modelPath = stage?.modelPath ?? null;
            if (!modelPath) return `${typeId}-no-model`; // Handle missing model path

            // Combine typeId and modelPath for uniqueness, especially if different plants share a seed model
            return `${typeId}::${modelPath}::${rotationKeyPart}`;

        } else if (objectType === 'decor') {
            const config = decorConfigs[typeId];
             if (!config?.modelPath) {
                console.warn(`Parent Key Calc: Decor config/modelPath missing for "${typeId}".`);
                return `${typeId}-decor-missing`; // Use typeId as key
            }
            modelPath = config.modelPath;
            // For decor, typeId is usually sufficient as the model doesn't change
            // But using the modelPath is safer if configs could change
             return `${typeId}::${modelPath}::${rotationKeyPart}`;
        }

        return 'unknown-type'; // Fallback for unexpected objectType
    }

    // Helper to check if an action is currently selected
    function isSelected(action: SelectedAction): boolean {
        // Use $selectedAction directly instead of currentAction
        if (!$selectedAction) return false;
        // Make sure the action passed in is not null/undefined if comparing strings
        // Though in your template usage, it's always a defined object.
        return JSON.stringify($selectedAction) === JSON.stringify(action);
    }
    $: isSelectionInfoVisible = $uiMode === 'edit' && $selectedObjectInfo && !$heldItem && !$selectedAction;

    // Helper function to format growth progress
    function formatGrowth(progress: number | undefined): string {
        if (progress === undefined) return '';
        return `${(progress * 100).toFixed(0)}% Grown`;
    }

    
</script>

<div>
    <!-- Right Bottom Corner Buttons: Watering and uiMode Changer -->
    <div class="absolute xl:bottom-2 bottom-4 xl:right-4 right-6 flex items-end gap-2">
        <button class="bg-brighterblack text-white data-[selected=true]:bg-white data-[selected=true]:text-brighterblack
        data-[selected=true]:border-2 data-[selected=true]:border-brighterblack transition duration-75 ease-out
        data-[selected=true]:hover:bg-darkerwhite hover:bg-brightblack hover:scale-105 data-[visible=false]:translate-y-24
        rounded-full size-16 text-4xl flex items-center justify-center" on:click={() => selectTool('water')}
            data-selected={isSelected({ type: 'tool', toolType: 'water' })} data-visible={$uiMode==='view'}>
            <span class="material-symbols-outlined" style="font-size: 2rem;">
                water_drop
            </span>
        </button>

        <button class="bg-brighterblack text-white data-[selected=true]:bg-white data-[selected=true]:text-brighterblack
        data-[selected=true]:border-2 data-[selected=true]:border-brighterblack transition duration-75
        data-[selected=true]:hover:bg-darkerwhite hover:bg-brightblack hover:scale-105 data-[selected=true]:-translate-y-16 xl:data-[selected=true]:translate-y-0
        rounded-full size-8 text-4xl flex items-center justify-center" data-selected={$uiMode==='edit'} on:click={toggleUIMode}>
            <span class="material-symbols-outlined"style="font-size: 1.5rem;">
                settings
            </span>
        </button>
    </div>

    <div class="absolute left-1/2 -translate-x-1/2 bottom-2 flex
    bg-white rounded-lg p-2
    transition duration-150 data-[visible=false]:translate-y-28" data-visible={$uiMode==='edit'}>
        <!-- Items List -->
        <div class="xl:hidden flex gap-2 mr-4">
            <!-- Items List -->
            {#each availablePlants as plant}
                <!-- Item -->
                {@const quantity = $inventory.get(plant.id) || 0}
                <div class="bg-darkerwhite rounded-lg relative hover:scale-105 hover:brightness-95 transition duration-75">
                    <div class="data-[instock=false]:saturate-0" data-instock={quantity>0}
                        role="button" tabindex="0"
                        aria-label={`Pick up ${plant.name}${quantity <= 0 ? ' (Out of stock)' : ''}`}
                        aria-disabled={quantity <= 0}
                        on:pointerdown={(event) => handleItemPointerDown(event, { objectType: 'plant', typeId: plant.id })}
                        style="touch-action: none;">
                        <ObjectIconRenderer
                            name={plant.id}
                            objectType={'plant'}
                            size={48}
                        />
                    </div>
                    <div class="absolute -bottom-2 -right-2 bg-brighterblack rounded-lg px-2 flex justify-center items-center">
                        <p class="text-white">{quantity}</p>
                    </div>
                </div>
            {/each}
            {#each availableDecor as decor}
                <!-- Item -->
                {@const quantity = $inventory.get(decor.id) || 0}
                <div class="bg-darkerwhite rounded-lg relative hover:scale-105 hover:brightness-95 transition duration-75">
                    <div class="data-[instock=false]:saturate-0" data-instock={quantity>0}
                        role="button" tabindex="0"
                        aria-label={`Pick up ${decor.name}${quantity <= 0 ? ' (Out of stock)' : ''}`}
                        aria-disabled={quantity <= 0}
                        on:pointerdown={(event) => handleItemPointerDown(event, { objectType: 'decor', typeId: decor.id })}
                        style="touch-action: none;">
                        <ObjectIconRenderer
                            name={decor.id}
                            objectType={'decor'}
                            size={48}
                        />
                    </div>
                    <div class="absolute -bottom-2 -right-2 bg-brighterblack rounded-lg px-2 flex justify-center items-center">
                        <p class="text-white">{quantity}</p>
                    </div>
                </div>
            {/each}
        </div>
        <div class="xl:flex hidden gap-4 mr-8">
            <!-- Items List -->
            {#each availablePlants as plant}
                <!-- Item -->
                {@const quantity = $inventory.get(plant.id) || 0}
                <div class="bg-darkerwhite rounded-lg relative hover:scale-105 hover:brightness-95 transition duration-75">
                    <div class="data-[instock=false]:saturate-0" data-instock={quantity>0}
                        role="button" tabindex="0"
                        aria-label={`Pick up ${plant.name}${quantity <= 0 ? ' (Out of stock)' : ''}`}
                        aria-disabled={quantity <= 0}
                        on:pointerdown={(event) => handleItemPointerDown(event, { objectType: 'plant', typeId: plant.id })}
                        style="touch-action: none;">
                        <ObjectIconRenderer
                            name={plant.id}
                            objectType={'plant'}
                            size={64}
                        />
                    </div>
                    <div class="absolute -bottom-2 -right-2 bg-brighterblack rounded-lg px-2 flex justify-center items-center">
                        <p class="text-white">{quantity}</p>
                    </div>
                </div>
            {/each}
            {#each availableDecor as decor}
                <!-- Item -->
                {@const quantity = $inventory.get(decor.id) || 0}
                <div class="bg-darkerwhite rounded-lg relative hover:scale-105 hover:brightness-95 transition duration-75">
                    <div class="data-[instock=false]:saturate-0" data-instock={quantity>0}
                        role="button" tabindex="0"
                        aria-label={`Pick up ${decor.name}${quantity <= 0 ? ' (Out of stock)' : ''}`}
                        aria-disabled={quantity <= 0}
                        on:pointerdown={(event) => handleItemPointerDown(event, { objectType: 'decor', typeId: decor.id })}
                        style="touch-action: none;">
                        <ObjectIconRenderer
                            name={decor.id}
                            objectType={'decor'}
                            size={64}
                        />
                    </div>
                    <div class="absolute -bottom-2 -right-2 bg-brighterblack rounded-lg px-2 flex justify-center items-center">
                        <p class="text-white">{quantity}</p>
                    </div>
                </div>
            {/each}
        </div>
        <!-- Instruments -->
        <div class="xl:hidden flex gap-2">
            <!-- Water Tool -->
            <button class="bg-brighterblack text-white data-[selected=true]:bg-white data-[selected=true]:text-brighterblack
            data-[selected=true]:border-2 data-[selected=true]:border-brighterblack transition duration-75 ease-out
            data-[selected=true]:hover:bg-darkerwhite hover:bg-brightblack hover:scale-105
            rounded-full size-12 text-4xl flex items-center justify-center" on:click={() => selectTool('water')}
                data-selected={isSelected({ type: 'tool', toolType: 'water' })}>
                <span class="material-symbols-outlined" style="font-size: 2rem;">
                    water_drop
                </span>
            </button>
            <!-- Remove Tool -->
            <button class="bg-brighterblack text-white data-[selected=true]:bg-red data-[selected=true]:text-brighterblack
            data-[selected=true]:border-2 data-[selected=true]:border-brighterblack transition duration-75 ease-out
            data-[selected=true]:hover:bg-darkerred hover:bg-brightblack hover:scale-105
            rounded-full size-12 text-4xl flex items-center justify-center" on:click={() => selectTool('remove')}
                data-selected={isSelected({ type: 'tool', toolType: 'remove' })}>
                <span class="material-symbols-outlined" style="font-size: 2rem;">
                    delete
                </span>
            </button>
        </div>
        <div class="xl:flex hidden gap-2">
            <!-- Water Tool -->
            <button class="bg-brighterblack text-white data-[selected=true]:bg-white data-[selected=true]:text-brighterblack
            data-[selected=true]:border-2 data-[selected=true]:border-brighterblack transition duration-75 ease-out
            data-[selected=true]:hover:bg-darkerwhite hover:bg-brightblack hover:scale-105
            rounded-full size-16 text-4xl flex items-center justify-center" on:click={() => selectTool('water')}
                data-selected={isSelected({ type: 'tool', toolType: 'water' })}>
                <span class="material-symbols-outlined" style="font-size: 2rem;">
                    water_drop
                </span>
            </button>
            <!-- Remove Tool -->
            <button class="bg-brighterblack text-white data-[selected=true]:bg-red data-[selected=true]:text-brighterblack
            data-[selected=true]:border-2 data-[selected=true]:border-brighterblack transition duration-75 ease-out
            data-[selected=true]:hover:bg-darkerred hover:bg-brightblack hover:scale-105
            rounded-full size-16 text-4xl flex items-center justify-center" on:click={() => selectTool('remove')}
                data-selected={isSelected({ type: 'tool', toolType: 'remove' })}>
                <span class="material-symbols-outlined" style="font-size: 2rem;">
                    delete
                </span>
            </button>
        </div>
    </div>
    <!-- Widgets -->
    <div class="hidden xl:flex absolute right-14 bottom-2 flex-col
    bg-brighterblack rounded-lg px-4 py-2 gap-4
    transition duration-150 data-[visible=false]:translate-y-40" data-visible={$uiMode==='edit'}>
        <p class='text-white mx-auto font-bold text-lg'>Widgets</p>
        <button class="rounded-lg bg-white hover:bg-darkerwhite hover:scale-105 transition duration-75 text-black font-semibold px-3 py-1 flex justify-between items-center gap-4" on:click={() => handleAddWidget('ClockDateWidget')}>
            <p>Add Clock and Date Widget</p>
            <span class="material-symbols-outlined -mb-1">
                add
            </span>
        </button>
        <button class="rounded-lg bg-red hover:bg-darkerred hover:scale-105 transition duration-75 text-black font-semibold px-3 py-1 flex justify-between items-center" on:click={handleRemoveAllWidgets}>
            <p>Remove All Widgets</p>
            <span class="material-symbols-outlined -mb-1">
                close
            </span>
        </button>
    </div>
    <!-- Selected Object -->
    <div class="absolute left-1/2 -translate-x-1/2 top-2 flex items-center gap-4
    bg-white rounded-lg p-2
    transition duration-150 data-[visible=false]:-translate-y-16 data-[visible=false]:scale-0" data-visible={isSelectionInfoVisible || false}>
    {#if $selectedObjectInfo}
        {@const iconKey = getIconKey($selectedObjectInfo)}
        {#if iconKey}
            <div class="text-sm">
                <p class="font-bold">{$selectedObjectInfo.name} ({$selectedObjectInfo.objectType})</p>
                <p>Status: {$selectedObjectInfo.status}</p>
                {#if $selectedObjectInfo.objectType === 'plant'}
                    <p>{formatGrowth($selectedObjectInfo.growthProgress)}</p>
                {/if}
            </div>
            {#key iconKey}
                <div class="flex flex-col items-center">
                    <ObjectIconRenderer
                        name={$selectedObjectInfo.typeId}
                        objectType={$selectedObjectInfo.objectType}
                        growth={$selectedObjectInfo.growthProgress}
                        size={64}
                        rotationY={$selectedObjectInfo.rotationY}
                    />
                </div>
            {/key}
        {/if}
    {:else}
        <div class="text-sm">
            <p class="font-bold">No object is selected.</p>
            <p>Status: No status</p>
        </div>
        <div class="flex flex-col items-center">
            <div class="w-16 h-16 flex items-center justify-center">
                <span class="material-symbols-outlined text-brightblack" style="font-size: 3rem;">
                    image
                </span>
            </div>
        </div>
    {/if}
    </div>
</div>