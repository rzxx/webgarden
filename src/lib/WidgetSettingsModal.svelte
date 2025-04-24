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
        class="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-6 font-outfit text-black"
        on:click={handleCancel}
        on:keydown={handleOverlayKeydown}
        role="button"
        tabindex="0"
        aria-label="Close settings modal"
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            class="bg-white p-6 rounded-xl w-1/3 max-h-[80dvh] overflow-y-auto shadow-2xl shadow-black"
            on:click|stopPropagation
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            tabindex="-1"
        >
            <h3 id="modal-title" class="text-2xl font-semibold mt-6 mb-12">Settings: {componentName}</h3>
            <!-- <p><small>ID: {widgetId}</small></p> -->

            <!-- Dynamic Settings Form Area -->
            <form on:submit|preventDefault={handleSave}>
                {#if settingsOptions.length > 0}
                    {#each settingsOptions as settingOpt (settingOpt.setting)}
                        {@const inputId = getInputId(settingOpt.setting)}
                        <div class="mb-4">
                            {#if settingOpt.type === 'boolean'}
                                <!-- Special layout for boolean (checkbox) -->
                                <div class="flex gap-2 has-checked:text-brighterblack text-black accent-brighterblack">
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
                                        class="block mt-1 w-full px-4 py-2 bg-brighterblack rounded-lg text-white focus:bg-brightblack focus:outline-0"
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
                                        class="block mt-1 w-full px-4 py-2 bg-darkerwhite rounded-lg text-brighterblack focus:bg-darkwhite focus:outline-0 border-2 border-darkwhite"
                                        placeholder={settingOpt.placeholder || ''}
                                    />
                                {:else if settingOpt.type === 'string'}
                                    <input
                                        type="text"
                                        id={inputId}
                                        bind:value={localSettings[settingOpt.setting]}
                                        placeholder={settingOpt.placeholder || ''}
                                        class="block mt-1 w-full px-4 py-2 bg-darkerwhite rounded-lg text-brighterblack focus:bg-darkwhite focus:outline-0 border-2 border-darkwhite"
                                    />
                                {:else}
                                    <!-- Fallback for unknown type (or treat as string) -->
                                     <input
                                        type="text"
                                        id={inputId}
                                        bind:value={localSettings[settingOpt.setting]}
                                        class="block mt-1 w-full px-4 py-2 bg-darkerwhite rounded-lg text-brighterblack focus:bg-darkwhite focus:outline-0 border-2 border-darkwhite"
                                        placeholder="Unknown setting type"
                                    />
                                {/if}
                            {/if}
                        </div>
                    {/each}
                {/if}


                <!-- Size Selection Dropdown -->
                {#if availableSizes.length > 0}
                    <div class="mt-6">
                        <label for="widget-size">Widget Size:</label>
                        <select id="widget-size" bind:value={selectedSizeKey} class="block mt-1 w-full px-4 py-2 bg-brighterblack rounded-lg text-white focus:bg-brightblack focus:outline-0">
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

                <div class="flex justify-end gap-4 mt-12">
                    <button type="button" on:click={handleCancel} class="cursor-pointer bg-darkwhite hover:bg-darkerwhite transition duration-150 text-brighterblack px-4 py-2 rounded-lg font-light">Cancel</button>
                    <button type="submit" class="cursor-pointer bg-brighterblack hover:bg-brightblack transition duration-150 text-white px-4 py-2 rounded-lg font-semibold">Save Settings</button>
                </div>
            </form> <!-- End Form -->
        </div>
    </div>
{/if}

<svelte:window on:keydown={handleKeydown} />