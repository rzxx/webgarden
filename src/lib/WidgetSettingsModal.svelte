<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { modalStore, closeSettingsModal } from './modalStore';
    import { widgetStore, updateWidget, type WidgetConfig, type WidgetSizeOption } from './stores';
    // --- Import centralized module map ---
    import { widgetComponentModules } from './widgetRegistry'; // Correctly imported
    // --- End Import ---
    import { get } from 'svelte/store';

    interface SettingDefinition {
        setting: string;
        label: string; // User-friendly label
        type: 'select' | 'number' | 'string' | 'boolean'; // Allowed types
        options?: Array<{ value: any; label: string }>; // Required only for type: 'select'
        placeholder?: string; // Optional for text inputs
        step?: number | string; // Optional for number inputs
        min?: number | string; // Optional for number inputs
        max?: number | string; // Optional for number inputs
    }

    let isOpen = false;
    let widgetId: string | null = null;
    let componentName: string | null = null;
    let currentWidget: WidgetConfig | null = null;
    let localSettings: Record<string, any> = {}; // Local copy for editing

    // --- Local state for selected size ---
    let availableSizes: WidgetSizeOption[] = [];
    let settingsOptions: SettingDefinition[] = [];
    let selectedSizeKey: string = '';
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
            // Create a deep copy for local editing, ensuring defaults are merged
            const componentModule = widgetComponentModules[componentName];
            const defaultSettings = componentModule?.defaultSettings || {};
            const currentSettings = currentWidget?.settings || {};
            // Merge defaults with current settings for the local copy
            localSettings = JSON.parse(JSON.stringify({ ...defaultSettings, ...currentSettings }));

            availableSizes = componentModule?.sizeOptions || [];
            settingsOptions = componentModule?.SettingsOptions || []; // Get the structured settings

            if (currentWidget) {
                selectedRowSpan = currentWidget.gridRowSpan;
                selectedColSpan = currentWidget.gridColumnSpan;
                selectedSizeKey = `${selectedRowSpan}-${selectedColSpan}`;
            } else {
                availableSizes = [];
                settingsOptions = [];
                selectedRowSpan = 1;
                selectedColSpan = 1;
                selectedSizeKey = '1-1';
            }

        } else {
            currentWidget = null;
            localSettings = {};
            availableSizes = [];
            settingsOptions = [];
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
            // Ensure numbers are saved as numbers, not strings from input fields
            settingsOptions.forEach(opt => {
                if (opt.type === 'number' && typeof localSettings[opt.setting] === 'string') {
                    localSettings[opt.setting] = parseFloat(localSettings[opt.setting]);
                    // Handle potential NaN if parsing fails, maybe revert to default or show error
                    if (isNaN(localSettings[opt.setting])) {
                        const componentModule = widgetComponentModules[componentName!]; // We know componentName is set here
                        localSettings[opt.setting] = componentModule?.defaultSettings?.[opt.setting] ?? 0; // Fallback to default or 0
                    }
                }
            });

            const updatedWidget: WidgetConfig = {
                ...currentWidget,
                // Save the potentially type-corrected local settings
                settings: localSettings,
                gridRowSpan: selectedRowSpan,
                gridColumnSpan: selectedColSpan,
            };
            updateWidget(updatedWidget);
        }
        closeSettingsModal();
    }

    function handleCancel() {
        closeSettingsModal(); // Just close without saving
    }

    // Handle Escape key to close
    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            handleCancel();
        }
    }

    function handleOverlayKeydown(event: KeyboardEvent) {
        // Trigger cancel ONLY if Enter is pressed directly on the overlay element itself
        if (event.target === event.currentTarget && (event.key === 'Enter')) {
            // Check if the event target is the same as the element the listener is attached to
            console.log("Enterpressed directly on overlay, cancelling."); // For debugging
            event.preventDefault(); // Prevent any default action for Enter on the overlay div
            handleCancel();
        }
    }

    onMount(() => {
        // Add keydown listener when modal is potentially open
        window.addEventListener('keydown', handleKeydown);
        return () => {
            window.removeEventListener('keydown', handleKeydown);
        };
    });

    function getInputId(settingKey: string): string {
        return `setting-${widgetId}-${settingKey}`;
    }
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
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            class="modal-content"
            on:click|stopPropagation
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            tabindex="-1"
        >
            <h3 id="modal-title" class="modal-header">Settings: {componentName}</h3>
            <!-- <p><small>ID: {widgetId}</small></p> -->

            <hr />

            <!-- Dynamic Settings Form Area -->
            <form on:submit|preventDefault={handleSave}>
                {#if settingsOptions.length > 0}
                    <h4>Widget Settings</h4>
                    {#each settingsOptions as settingOpt (settingOpt.setting)}
                        {@const inputId = getInputId(settingOpt.setting)}
                        <div class="form-group">
                            {#if settingOpt.type === 'boolean'}
                                <!-- Special layout for boolean (checkbox) -->
                                <div class="checkbox-group">
                                    <input
                                        type="checkbox"
                                        id={inputId}
                                        bind:checked={localSettings[settingOpt.setting]}
                                    />
                                    <label for={inputId}>{settingOpt.label}</label>
                                </div>
                            {:else}
                                <!-- Standard layout for other types -->
                                <label for={inputId}>{settingOpt.label}:</label>
                                {#if settingOpt.type === 'select'}
                                    <select
                                        id={inputId}
                                        bind:value={localSettings[settingOpt.setting]}
                                        class="input-field"
                                    >
                                        {#each settingOpt.options || [] as opt}
                                            <option value={opt.value}>{opt.label}</option>
                                        {/each}
                                    </select>
                                {:else if settingOpt.type === 'number'}
                                    <input
                                        type="number"
                                        id={inputId}
                                        bind:value={localSettings[settingOpt.setting]}
                                        step={settingOpt.step || 'any'}
                                        min={settingOpt.min}
                                        max={settingOpt.max}
                                        class="input-field"
                                        placeholder={settingOpt.placeholder || ''}
                                    />
                                {:else if settingOpt.type === 'string'}
                                    <input
                                        type="text"
                                        id={inputId}
                                        bind:value={localSettings[settingOpt.setting]}
                                        placeholder={settingOpt.placeholder || ''}
                                        class="input-field"
                                    />
                                {:else}
                                    <!-- Fallback for unknown type (or treat as string) -->
                                     <input
                                        type="text"
                                        id={inputId}
                                        bind:value={localSettings[settingOpt.setting]}
                                        class="input-field"
                                        placeholder="Unknown setting type"
                                    />
                                {/if}
                            {/if}
                        </div>
                    {/each}
                    <hr />
                {/if}


                <!-- Size Selection Dropdown -->
                <h4>Widget Size</h4>
                {#if availableSizes.length > 0}
                    <div class="form-group">
                        <label for="widget-size">Size:</label>
                        <select id="widget-size" bind:value={selectedSizeKey} class="input-field">
                            {#each availableSizes as sizeOpt (sizeOpt.label)}
                                <option value="{sizeOpt.rows}-{sizeOpt.cols}">
                                    {sizeOpt.label} ({sizeOpt.rows}x{sizeOpt.cols})
                                </option>
                            {/each}
                        </select>
                    </div>
                {:else if componentName}
                    <p><em>(No predefined sizes available for {componentName})</em></p>
                {/if}

                <!-- Optional: Display raw settings for debugging -->
                <!--
                <details>
                    <summary>Raw Settings</summary>
                    <pre>{JSON.stringify(localSettings, null, 2)}</pre>
                </details>
                -->

                <hr />

                <div class="modal-actions">
                    <button type="button" on:click={handleCancel} class="button secondary">Cancel</button>
                    <button type="submit" class="button primary">Save Settings</button>
                </div>
            </form> <!-- End Form -->
        </div>
    </div>
{/if}

<svelte:window on:keydown={handleKeydown} />

<style>
    .modal-overlay {
        position: fixed;
        inset: 0; /* top, left, right, bottom */
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        padding: 20px; /* Add padding for smaller screens */
    }
    .modal-content {
        background-color: white;
        padding: 20px 25px;
        border-radius: 8px;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        min-width: 300px;
        max-width: 500px;
        width: 90%; /* Responsive width */
        z-index: 1001;
        max-height: 90vh; /* Prevent modal becoming too tall */
        overflow-y: auto; /* Allow scrolling if content overflows */
        color: #333; /* Darker text for better readability */
    }
    .modal-header {
        margin-top: 0;
        margin-bottom: 15px;
        font-size: 1.4em;
        color: #111;
    }
    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 25px;
        padding-top: 15px;
        border-top: 1px solid #eee; /* Separator line */
    }
    .form-group {
        margin-bottom: 18px; /* Increased spacing */
    }
    label {
        display: block;
        margin-bottom: 6px;
        font-weight: 500; /* Slightly bolder labels */
        font-size: 0.95em;
    }
    .input-field {
        display: block; /* Ensure inputs take full block width */
        width: 100%;
        padding: 10px 12px; /* More padding */
        box-sizing: border-box;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 1em;
        background-color: #f9f9f9; /* Slightly off-white background */
    }
    .input-field:focus {
         border-color: #007bff;
         outline: none;
         box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
         background-color: #fff;
    }

    /* Styles for checkbox */
    .checkbox-group {
        display: flex;
        align-items: center;
        gap: 8px; /* Space between checkbox and label */
    }
    .checkbox-group input[type="checkbox"] {
       width: auto; /* Override width: 100% */
       margin: 0;
       /* Optional: Style checkbox appearance */
       accent-color: #007bff; /* Color the checkmark */
       transform: scale(1.1); /* Slightly larger checkbox */
    }
    .checkbox-group label {
        margin-bottom: 0; /* Remove bottom margin for inline label */
        font-weight: normal; /* Normal weight for checkbox label */
    }

    h4 {
        margin-top: 20px;
        margin-bottom: 10px;
        font-size: 1.1em;
        color: #444;
        border-bottom: 1px solid #eee;
        padding-bottom: 5px;
    }

    hr {
        margin: 20px 0;
        border: none;
        border-top: 1px solid #eee;
    }
    .button {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.95em;
        transition: background-color 0.2s ease;
    }
    .button.primary {
        background-color: #007bff;
        color: white;
    }
     .button.primary:hover {
        background-color: #0056b3;
    }
    .button.secondary {
        background-color: #f0f0f0;
        color: #333;
        border: 1px solid #ccc;
    }
    .button.secondary:hover {
         background-color: #e0e0e0;
    }

    /* Optional: Add visual focus indicator for the overlay */
    .modal-overlay:focus-visible {
        outline: 3px solid dodgerblue;
        outline-offset: 3px;
    }
    .modal-content:focus {
        outline: none; /* Usually remove outline here as focus is managed internally */
    }
</style>