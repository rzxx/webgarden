<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import type { WidgetSizeOption } from '../stores'; // Import the type

    export let settings: Record<string, any> | undefined = {};

    // --- NEW: Define available sizes for this widget ---
    export const sizeOptions: WidgetSizeOption[] = [
        { rows: 1, cols: 2, label: 'Compact (1x2)' },
        { rows: 2, cols: 2, label: 'Square (2x2)' },
        { rows: 2, cols: 3, label: 'Medium (2x3)' },
    ];
    // --- End Size Definition ---

    let currentTime = new Date();
    let intervalId: number;

    onMount(() => {
        intervalId = window.setInterval(() => {
            currentTime = new Date();
        }, 1000); // Update every second
    });

    onDestroy(() => {
        if (intervalId) {
            clearInterval(intervalId);
        }
    });

    $: timeString = currentTime.toLocaleTimeString();
</script>

<div class="clock-widget">
    <!-- Use settings if needed, e.g., display title -->
    {#if settings?.title}<h4>{settings.title}</h4>{/if}
    <h2>{timeString}</h2>
</div>

<style>
    .clock-widget {
        text-align: center;
        font-family: sans-serif;
        color: #333;
    }
    h2 {
        margin: 0;
        font-size: 1.5em; /* Adjust size as needed */
        font-weight: normal;
    }
    h4 {
        margin: 0 0 5px 0;
        font-size: 0.8em;
        font-weight: bold;
        color: #555;
    }
</style>