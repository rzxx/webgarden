<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    // REMOVED: Three.js, loaders, configs imports (handled by generator)
    import { generateIconDataUrl } from './iconGenerator'; // Import the new service

    // --- Props ---
    /** The ID of the plant or decor object (e.g., "fern", "streetLamp") */
    export let name: string;
    /** The type of object to determine which config to use */
    export let objectType: 'plant' | 'decor';
    /** Optional: The growth progress (0.0 to 1.0) for plants. Defaults to 1.0 (fully grown) if undefined. */
    export let growth: number | undefined = undefined;
    /** Desired size (width & height) of the icon canvas in pixels */
    export let size: number = 64; // Default size
    /** Optional: The Y-axis rotation in radians. Defaults to 0. */
    export let rotationY: number | undefined = undefined;

    // --- Internal State ---
    let container: HTMLDivElement; // Keep container ref if needed for styling/layout
    let isLoading = true;
    let error: string | null = null;
    let imageDataUrl: string | null = null; // Still needed to display the result

    let isMounted = false;
    let generationPromise: Promise<void> | null = null; // Track the generation process

    // --- Reactive Logic ---
    // Use $: block to react to prop changes
    $: if (isMounted && name && objectType && size) {
        // Trigger generation when relevant props change *after* mount
        triggerIconGeneration();
    }

    async function triggerIconGeneration() {
        // Avoid concurrent generations for the same component instance if props change rapidly
        if (generationPromise) {
            // Optionally cancel previous logic if possible, or just let it run and overwrite
            console.log(`Icon Renderer (${name}): New generation request while previous one might be running.`);
        }

        isLoading = true;
        error = null;
        imageDataUrl = null; // Clear previous image

        const currentGeneration = generateIconDataUrl(objectType, name, size, growth, rotationY)
            .then(dataUrl => {
                // Check if the component is still mounted and this promise is the current one
                if (isMounted && generationPromise === currentGeneration) {
                    imageDataUrl = dataUrl;
                    error = null;
                }
            })
            .catch(err => {
                 if (isMounted && generationPromise === currentGeneration) {
                    console.error(`Icon Renderer (${name}): Error generating icon:`, err);
                    error = typeof err === 'string' ? err : "Generation failed";
                    imageDataUrl = null;
                 }
            })
            .finally(() => {
                 if (isMounted && generationPromise === currentGeneration) {
                    isLoading = false;
                    generationPromise = null; // Clear the promise tracker
                 }
            });

        generationPromise = currentGeneration; // Store the current promise
    }

    onMount(() => {
        isMounted = true;
        triggerIconGeneration(); // Initial generation on mount
    });

    onDestroy(() => {
        isMounted = false;
        generationPromise = null; // Ensure we don't try to update state after unmount
    });

</script>

<!-- Keep the outer div and conditional rendering logic -->
<div bind:this={container} class="icon-container" style:width="{size}px" style:height="{size}px">
    {#if isLoading}
        <div class="w-full h-full flex justify-center items-center text-brighterblack">
            <span class="material-symbols-outlined animate-pulse" style="font-size: 2rem;">
                hourglass_top
            </span>
        </div>
    {:else if error}
        <div class="w-full h-full flex flex-col justify-center items-center text-red">
            <span class="material-symbols-outlined" style="font-size: 2rem;">
                error
            </span>
        </div>
    {:else if imageDataUrl}
        <img
            src={imageDataUrl}
            alt="{name} icon"
            width={size}
            height={size}
            class="block"
            loading="lazy"
        />
    {/if}
</div>