<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { modalStore, closeSettingsModal } from './modalStore';
    import { widgetStore, updateWidget, type WidgetConfig, type WidgetSizeOption } from './stores';
    // --- Import centralized module map ---
    import { widgetComponentModules } from './widgetRegistry'; // Correctly imported
    // --- End Import ---
    import { get } from 'svelte/store';

    let isOpen = false;
    let widgetId: string | null = null;
    let componentName: string | null = null;
    let currentWidget: WidgetConfig | null = null;
    let localSettings: Record<string, any> = {}; // Local copy for editing

    // --- NEW: Local state for selected size ---
    let availableSizes: WidgetSizeOption[] = [];
    let selectedSizeKey: string = ''; // Store as "rows-cols" string key
    let selectedRowSpan: number = 1;
    let selectedColSpan: number = 1;
    // --- End Size State ---

    const unsubscribeModal = modalStore.subscribe(($modalStore) => {
        isOpen = $modalStore.isOpen;
        widgetId = $modalStore.widgetId;
        componentName = $modalStore.componentName;

        if (isOpen && widgetId && componentName) {
            const allWidgets = get(widgetStore);
            currentWidget = allWidgets.find((w) => w.id === widgetId) || null;
            // Create a deep copy for local editing to avoid modifying the store directly
            localSettings = currentWidget ? JSON.parse(JSON.stringify(currentWidget.settings || {})) : {};

            // --- FIX: Get size options from the specific widget component module ---
            const componentModule = widgetComponentModules[componentName];
            availableSizes = componentModule?.sizeOptions || []; // Access exported const from the module
            // --- End Fix ---

            if (currentWidget) {
                selectedRowSpan = currentWidget.gridRowSpan;
                selectedColSpan = currentWidget.gridColumnSpan;
                selectedSizeKey = `${selectedRowSpan}-${selectedColSpan}`; // Set initial dropdown value
            } else {
                // Default if something went wrong or no sizes defined
                availableSizes = [];
                selectedRowSpan = 1;
                selectedColSpan = 1;
                selectedSizeKey = '1-1';
            }

        } else {
            currentWidget = null;
            localSettings = {};
            availableSizes = []; // Reset sizes when closed
            selectedSizeKey = '';
        }
    });

    onDestroy(unsubscribeModal);

    // --- NEW: Update local row/col span when dropdown changes ---
    $: {
        if (selectedSizeKey) {
            const [rowsStr, colsStr] = selectedSizeKey.split('-');
            selectedRowSpan = parseInt(rowsStr, 10);
            selectedColSpan = parseInt(colsStr, 10);
        }
    }
    // --- End Size Update ---

    function handleSave() {
        if (currentWidget) {
            // Create the updated widget config with new settings
            const updatedWidget: WidgetConfig = {
                ...currentWidget,
                settings: localSettings, // Use the locally edited settings
                gridRowSpan: selectedRowSpan, // Use selected size
                gridColumnSpan: selectedColSpan, // Use selected size
            };
            updateWidget(updatedWidget); // Update the store
        }
        closeSettingsModal(); // Close the modal
    }

    function handleCancel() {
        closeSettingsModal(); // Just close without saving
    }

    // --- Basic Settings Field Example ---
    // In a real app, you'd generate fields based on componentName or a settings schema
    let settingTitle = localSettings['title'] || '';
    $: localSettings['title'] = settingTitle; // Keep localSettings updated

    // Handle Escape key to close
    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            handleCancel();
        }
    }

    // --- NEW: Keyboard handler for overlay click ---
    function handleOverlayKeydown(event: KeyboardEvent) {
        // Trigger cancel if Enter or Space is pressed on the overlay
        if (event.key === 'Enter' || event.key === ' ') {
            handleCancel();
        }
    }
    // --- End Overlay Keydown Handler ---

    onMount(() => {
        // Add keydown listener when modal is potentially open
        window.addEventListener('keydown', handleKeydown);
        return () => {
            window.removeEventListener('keydown', handleKeydown);
        };
    });
</script>

{#if isOpen && currentWidget}
    <div
        class="modal-overlay"
        on:click={handleCancel}
        on:keydown={handleOverlayKeydown}
        role="button"
        tabindex="0"
        aria-label="Close settings modal"
    >
        <div
            class="modal-content"
            on:click|stopPropagation
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            tabindex="-1"
        >
            <h3 id="modal-title">Settings: {componentName}</h3>
            <p><small>ID: {widgetId}</small></p>

            <hr />

            <!-- Dynamic Settings Form Area (Basic Example) -->
            <div class="form-group">
                <label for="widget-title">Title:</label>
                <input type="text" id="widget-title" bind:value={settingTitle} />
            </div>

            <!-- NEW: Size Selection Dropdown -->
            {#if availableSizes.length > 0}
                <div class="form-group">
                    <label for="widget-size">Size:</label>
                    <select id="widget-size" bind:value={selectedSizeKey}>
                        {#each availableSizes as sizeOpt (sizeOpt.label)}
                            <option value="{sizeOpt.rows}-{sizeOpt.cols}">
                                {sizeOpt.label} ({sizeOpt.rows} Rows x {sizeOpt.cols} Cols)
                            </option>
                        {/each}
                    </select>
                </div>
            {:else if componentName}
                <p><em>(No predefined sizes available for {componentName})</em></p>
            {/if}
            <!-- End Size Selection -->

            <!-- Add more setting fields here based on widget type -->
            {#if componentName === 'ClockWidget'}
                <!-- Example: Add clock-specific settings if needed -->
                <p><em>(No specific settings for Clock yet)</em></p>
            {/if}

            <!-- Display raw settings for debugging -->
            <details>
                <summary>Raw Settings</summary>
                <pre>{JSON.stringify(localSettings, null, 2)}</pre>
            </details>

            <hr />

            <div class="modal-actions">
                <button on:click={handleCancel}>Cancel</button>
                <button on:click={handleSave} class="primary">Save Settings</button>
            </div>
        </div>
    </div>
{/if}

<svelte:window on:keydown={handleKeydown} />

<style>
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000; /* Ensure it's on top */
    }
    .modal-content {
        background-color: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        min-width: 300px;
        max-width: 500px;
        z-index: 1001;
    }
    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 20px;
    }
    .form-group {
        margin-bottom: 15px;
    }
    label {
        display: block;
        margin-bottom: 5px;
    }
    input[type='text'] {
        width: 100%;
        padding: 8px;
        box-sizing: border-box;
    }
    button.primary {
        background-color: #007bff;
        color: white;
    }
    hr {
        margin: 15px 0;
        border: none;
        border-top: 1px solid #eee;
    }
    pre {
        background-color: #f5f5f5;
        padding: 5px;
        border-radius: 4px;
        font-size: 0.9em;
        max-height: 100px;
        overflow-y: auto;
    }
    select {
        width: 100%;
        padding: 8px;
        box-sizing: border-box;
    }
    .modal-overlay:focus {
        /* Optional: Add visual focus indicator for the overlay */
        outline: 2px solid dodgerblue;
        outline-offset: 2px;
    }
    .modal-content:focus {
        /* Optional: Add focus style if needed when programmatically focused */
        outline: none;
    }
</style>